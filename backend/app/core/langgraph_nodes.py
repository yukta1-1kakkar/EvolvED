from typing import Any, Dict
import base64
from html import escape
import logging
import json
import re
import asyncio

from pydantic import ValidationError

from app.core import models
from app.ai.factory import get_provider
from app.ai.router import ModelRouter
from app.core.chroma_client import ChromaClient
from app.core.config import settings
from uuid import uuid4


provider = get_provider()
chroma = ChromaClient()
logger = logging.getLogger(__name__)


def lesson_embedding_collection() -> str:
    dimension = settings.titan_embedding_dimensions or "default"
    return f"lessons_{dimension}"


async def _call_layer(layer: str, messages: list[Dict[str, str]], **kwargs):
    primary = ModelRouter.get_model(layer)
    try:
        response = await provider.call_chat_model(messages, model=primary, **kwargs)
        response["model"] = primary
        return response
    except Exception as exc:
        fallback = settings.reasoning_model
        if fallback == primary:
            raise
        logger.warning("%s model unavailable: %s; retrying with fallback %s: %s", layer, primary, fallback, exc)
        try:
            response = await provider.call_chat_model(messages, model=fallback, **kwargs)
            response["model"] = fallback
            return response
        except Exception as fallback_exc:
            logger.error("%s fallback model unavailable: %s: %s", layer, fallback, fallback_exc)
            raise


async def _persist_lesson_embedding(blueprint: models.LessonBlueprint, learner_id: str, topic: str):
    try:
        embedding_payload = {
            "topic": blueprint.topic,
            "learning_objective": blueprint.learning_objective,
            "lesson_summary": blueprint.lesson_summary,
            "sections": [
                {
                    "title": section.get("title", ""),
                    "explanation": str(section.get("explanation", ""))[:1200],
                    "example": str(section.get("example", ""))[:600],
                }
                for section in blueprint.lesson_structure
            ],
        }
        document = json.dumps(embedding_payload, ensure_ascii=False)
        if len(document.encode("utf-8")) > 12000:
            document = document.encode("utf-8")[:12000].decode("utf-8", errors="ignore")
        docs = [document]
        metas = [{"learner_id": learner_id, "topic": topic}]
        await chroma.add_documents(lesson_embedding_collection(), docs, metas, ids=[blueprint.lesson_id])
    except Exception as exc:
        logger.exception("Lesson embedding persistence failed: %s", exc)


def _json_from_model_text(text: str) -> Dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    def _load_with_missing_commas(candidate: str) -> Dict[str, Any]:
        repaired = candidate
        repairs = 0
        while repairs < 32:
            try:
                payload = json.loads(repaired)
                if repairs:
                    logger.warning("Repaired %s missing JSON comma(s) in model response", repairs)
                return payload
            except json.JSONDecodeError as exc:
                if exc.msg != "Expecting ',' delimiter":
                    raise
                repaired = f"{repaired[:exc.pos]},{repaired[exc.pos:]}"
                repairs += 1
        raise json.JSONDecodeError("Too many missing JSON delimiters", repaired, 0)

    def _escape_embedded_string_content(candidate: str) -> str:
        def _starts_object_key(quote_index: int) -> bool:
            closing_index = quote_index + 1
            escaped_key_char = False
            while closing_index < len(candidate):
                key_char = candidate[closing_index]
                if escaped_key_char:
                    escaped_key_char = False
                elif key_char == "\\":
                    escaped_key_char = True
                elif key_char == '"':
                    after_key = closing_index + 1
                    while after_key < len(candidate) and candidate[after_key].isspace():
                        after_key += 1
                    return after_key < len(candidate) and candidate[after_key] == ":"
                closing_index += 1
            return False

        output: list[str] = []
        containers: list[str] = []
        in_string = False
        string_is_key = False
        escaped = False
        previous_significant = ""

        for index, char in enumerate(candidate):
            if not in_string:
                output.append(char)
                if char == '"':
                    in_string = True
                    escaped = False
                    string_is_key = bool(
                        containers
                        and containers[-1] == "object"
                        and _starts_object_key(index)
                    )
                elif char == "{":
                    containers.append("object")
                    previous_significant = char
                elif char == "[":
                    containers.append("array")
                    previous_significant = char
                elif char in "}]":
                    if containers:
                        containers.pop()
                    previous_significant = char
                elif not char.isspace():
                    previous_significant = char
                continue

            if escaped:
                output.append(char)
                escaped = False
                continue
            if char == "\\":
                output.append(char)
                escaped = True
                continue
            if char in {"\n", "\r", "\t"}:
                output.append({"\n": "\\n", "\r": "\\r", "\t": "\\t"}[char])
                continue
            if char != '"':
                output.append(char)
                continue

            next_index = index + 1
            while next_index < len(candidate) and candidate[next_index].isspace():
                next_index += 1
            next_char = candidate[next_index] if next_index < len(candidate) else ""
            valid_closers = {":"} if string_is_key else {",", "}", "]", ""}
            missing_comma_boundary = (
                not string_is_key
                and next_char == '"'
                and (
                    (containers and containers[-1] == "array")
                    or (containers and containers[-1] == "object" and _starts_object_key(next_index))
                )
            )
            if next_char in valid_closers or missing_comma_boundary:
                output.append(char)
                in_string = False
                previous_significant = char
            else:
                output.append('\\"')

        return "".join(output)

    def _loads_lenient_json(candidate: str) -> Dict[str, Any]:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError as original_exc:
            escaped_backslashes = re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", candidate)
            try:
                return _load_with_missing_commas(escaped_backslashes)
            except json.JSONDecodeError:
                sanitized = _escape_embedded_string_content(escaped_backslashes)
                if sanitized != escaped_backslashes:
                    try:
                        payload = _load_with_missing_commas(sanitized)
                        logger.warning("Repaired embedded quotes or control characters in model JSON response")
                        return payload
                    except json.JSONDecodeError:
                        pass
            raise original_exc

    try:
        return _loads_lenient_json(cleaned)
    except Exception:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return _loads_lenient_json(cleaned[start : end + 1])
        raise


async def learner_agent(profile_or_state: Any) -> models.LearnerState:
    if isinstance(profile_or_state, models.LearnerState):
        return profile_or_state
    profile = profile_or_state
    state = models.LearnerState(
        learner_id=profile.learner_id,
        knowledge_level=profile.topic_familiarity or "novice",
        preferred_modalities=profile.preferred_modality,
    )
    return state


async def pedagogy_agent(state: Dict[str, Any]) -> models.TeachingStrategy:
    system = (
        "You are an expert pedagogical reasoning agent. Given the learner state and topic context,"
        " decide teaching strategy: select strategy_type, recommended_modalities, difficulty_level, pacing_strategy, and interaction_density."
        " Output JSON only with keys matching the TeachingStrategy model."
    )

    user_msg = f"State: {state}"
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]

    try:
        resp = await _call_layer("pedagogy", messages, temperature=0.0)
        text = resp["choices"][0]["message"]["content"]
    except Exception as exc:
        logger.warning("Pedagogy model unavailable: %s", exc)
        raise RuntimeError(f"Pedagogy model unavailable: {exc}") from exc

    try:
        payload = _json_from_model_text(text)
        normalized = {
            "strategy_type": payload.get("strategy_type") or payload.get("strategyType"),
            "recommended_modalities": payload.get("recommended_modalities") or payload.get("recommendedModalities"),
            "difficulty_level": payload.get("difficulty_level") or payload.get("difficultyLevel"),
            "pacing_strategy": payload.get("pacing_strategy") or payload.get("pacingStrategy"),
            "interaction_density": payload.get("interaction_density") or payload.get("interactionDensity"),
        }

        return models.TeachingStrategy(**normalized)
    except (ValueError, TypeError, ValidationError) as exc:
        raise RuntimeError(f"Pedagogy agent returned invalid JSON: {exc}") from exc


def _lesson_style_key(learning_style: str) -> str:
    style = learning_style.lower()
    if "visual" in style:
        return "visual"
    if "auditory" in style or "audio" in style or "listen" in style:
        return "auditory"
    if "reading" in style or "writing" in style or "written" in style:
        return "reading_writing"
    if "kinesthetic" in style or "hands-on" in style or "practice" in style:
        return "kinesthetic"
    return "mixed"


def _lesson_style_contract(learning_style: str) -> str:
    contracts = {
        "visual": (
            "Teach visually throughout. visualAssets must contain useful text-based graphs, diagrams, charts, "
            "flowcharts, concept maps, comparisons, timelines, or process visualizations. For mathematics include a "
            "function graph or equation visualization; for science include a process/system flow; for programming "
            "include architecture/data/execution flow; for history include a timeline or event map. Explanations must "
            "describe spatial or graphical relationships. Examples must "
            "walk through what the learner would see, and guided practice must ask the learner to draw, sketch, map, "
            "compare, or interpret a graph or diagram."
        ),
        "auditory": (
            "Teach like a conversational tutor speaking directly to the learner. audioScript must be a complete "
            "narration using a spoken walkthrough, story, dialogue, and verbal analogy. Examples must sound natural "
            "when read aloud. Reflection questions must work as discussion prompts, and practiceQuestions must include "
            "explain-it-back, say-it-aloud, discussion, or verbal reasoning activities."
        ),
        "reading_writing": (
            "Teach as high-quality textbook study material. explanation must be longer and detailed. coreConcepts must "
            "provide precise definitions, important terminology, and structured notes. Examples must show detailed "
            "written reasoning. keyTakeaways must form a written summary, and practiceQuestions must require writing, "
            "summarizing, defining, outlining, or comparing in words."
        ),
        "kinesthetic": (
            "Teach through action before abstraction and keep passive explanation brief. Every core concept must pair "
            "by index with a practiceQuestion. guidedActivities must contain exactly three substantial activities "
            "labelled Easy, Medium, and Hard. Use learn -> apply -> feedback. At least 40 percent of lesson words must "
            "be in practiceQuestions and guidedActivities, emphasizing solving, building, testing, simulations, moving, "
            "measuring, experimenting, and real-world application."
        ),
        "mixed": (
            "Populate every modality: visualAssets with a graph/diagram/chart, audioScript with tutor narration, "
            "coreConcepts/explanation with structured written notes and definitions, and guidedActivities with hands-on "
            "practice. Examples and practiceQuestions must alternate between seeing, explaining aloud, writing, and "
            "doing rather than relying on one method."
        ),
    }
    return contracts[_lesson_style_key(learning_style)]


def _visual_asset_image_url(asset: Dict[str, Any]) -> str:
    title = escape(str(asset["title"]))
    description = escape(str(asset["description"]))
    asset_type = str(asset["type"]).lower()
    data = asset["data"]
    width, height = 800, 450
    background = '<rect width="800" height="450" rx="24" fill="#faf7ff"/>'
    heading = f'<text x="40" y="48" font-family="Arial" font-size="24" font-weight="700" fill="#30263b">{title}</text>'
    body = ""

    if asset_type == "graph":
        points = [(float(item["x"]), float(item["y"])) for item in data]
        xs, ys = [point[0] for point in points], [point[1] for point in points]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        x_span = x_max - x_min or 1
        y_span = y_max - y_min or 1
        plotted = [
            (90 + ((x - x_min) / x_span) * 640, 360 - ((y - y_min) / y_span) * 250)
            for x, y in points
        ]
        polyline = " ".join(f"{x:.1f},{y:.1f}" for x, y in plotted)
        dots = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="#7c3aed"/>' for x, y in plotted)
        body = (
            '<line x1="90" y1="360" x2="730" y2="360" stroke="#65566f" stroke-width="2"/>'
            '<line x1="90" y1="90" x2="90" y2="360" stroke="#65566f" stroke-width="2"/>'
            f'<polyline points="{polyline}" fill="none" stroke="#7c3aed" stroke-width="4"/>{dots}'
            f'<text x="90" y="390" font-family="Arial" font-size="14" fill="#65566f">x: {x_min:g} to {x_max:g}</text>'
            f'<text x="570" y="390" font-family="Arial" font-size="14" fill="#65566f">y: {y_min:g} to {y_max:g}</text>'
        )
    else:
        count = max(len(data), 1)
        box_width = min(180, 660 / count)
        gap = (680 - box_width * count) / max(count - 1, 1)
        boxes = []
        for index, label in enumerate(data):
            x = 60 + index * (box_width + gap)
            if index:
                boxes.append(f'<line x1="{x - gap + 4:.1f}" y1="220" x2="{x - 8:.1f}" y2="220" stroke="#7c3aed" stroke-width="3" marker-end="url(#arrow)"/>')
            boxes.append(f'<rect x="{x:.1f}" y="170" width="{box_width:.1f}" height="100" rx="16" fill="#ede9fe" stroke="#7c3aed"/>')
            boxes.append(f'<text x="{x + box_width / 2:.1f}" y="225" text-anchor="middle" font-family="Arial" font-size="14" fill="#30263b">{escape(str(label)[:28])}</text>')
        body = '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#7c3aed"/></marker></defs>' + "".join(boxes)

    footer = f'<text x="40" y="425" font-family="Arial" font-size="13" fill="#65566f">{description[:110]}</text>'
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">{background}{heading}{body}{footer}</svg>'
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def _numeric_coordinate(value: Any, path: str) -> float | int:
    if isinstance(value, bool):
        raise ValueError(f"{path} must be numeric")
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        normalized = value.strip().replace("−", "-")
        try:
            parsed = float(normalized)
        except ValueError as exc:
            raise ValueError(f"{path} must be numeric") from exc
        return int(parsed) if parsed.is_integer() else parsed
    raise ValueError(f"{path} must be numeric")


def _normalize_graph_data(data: Any, asset_index: int) -> list[Dict[str, float | int]]:
    if not isinstance(data, list) or not data:
        raise ValueError(f"visualAssets[{asset_index}] graph data must be a non-empty array")
    logger.info("Graph normalization request: asset_index=%s raw_graph_data=%r", asset_index, data)
    normalized = []
    for point_index, point in enumerate(data):
        path = f"visualAssets[{asset_index}].data[{point_index}]"
        if isinstance(point, str):
            coordinate = point.replace("−", "-")
            parts = coordinate.split(",")
            if len(parts) != 2:
                raise ValueError(f"{path} must contain exactly one x,y coordinate pair")
            x_value, y_value = parts
        elif isinstance(point, dict):
            if "x" not in point or "y" not in point:
                raise ValueError(f"{path} must contain x and y")
            x_value, y_value = point["x"], point["y"]
        else:
            raise ValueError(f"{path} must be an object with numeric x and y")
        normalized.append({
            "x": _numeric_coordinate(x_value, f"{path}.x"),
            "y": _numeric_coordinate(y_value, f"{path}.y"),
        })
    logger.info("Graph normalization response: asset_index=%s normalized_graph_data=%r", asset_index, normalized)
    return normalized


def _normalize_visual_assets(raw_assets: list[Any]) -> list[Any]:
    normalized_assets = []
    for index, raw in enumerate(raw_assets):
        if not isinstance(raw, dict):
            normalized_assets.append(raw)
            continue
        asset = dict(raw)
        if str(asset.get("type") or "").lower().strip() == "graph":
            asset["data"] = _normalize_graph_data(asset.get("data"), index)
        normalized_assets.append(asset)
    return normalized_assets


def _prepare_visual_assets(raw_assets: list[Any]) -> list[Dict[str, Any]]:
    logger.info("Visual generation request: asset_count=%s", len(raw_assets))
    prepared = []
    supported_types = {"graph", "diagram", "flowchart", "concept_map", "timeline", "illustration", "process"}
    for index, raw in enumerate(_normalize_visual_assets(raw_assets)):
        if not isinstance(raw, dict):
            raise ValueError(f"visualAssets[{index}] must be an object")
        missing = {"title", "description", "type", "data"}.difference(raw)
        if missing:
            raise ValueError(f"visualAssets[{index}] is missing {sorted(missing)}")
        asset_type = str(raw["type"]).lower().strip()
        data = raw["data"]
        if asset_type not in supported_types:
            raise ValueError(f"visualAssets[{index}] has unsupported type {asset_type}")
        if asset_type == "graph":
            if len(data) < 2:
                raise ValueError(f"visualAssets[{index}] graph data must contain at least two points")
            for point_index, point in enumerate(data):
                if not isinstance(point, dict) or "x" not in point or "y" not in point:
                    raise ValueError(f"visualAssets[{index}].data[{point_index}] must contain x and y")
                if isinstance(point["x"], bool) or not isinstance(point["x"], (int, float)):
                    raise ValueError(f"visualAssets[{index}].data[{point_index}].x must be numeric")
                if isinstance(point["y"], bool) or not isinstance(point["y"], (int, float)):
                    raise ValueError(f"visualAssets[{index}].data[{point_index}].y must be numeric")
            logger.info("Graph validation result: asset_index=%s valid=true points=%s", index, len(data))
        elif not isinstance(data, list) or len(data) < 2 or any(not isinstance(item, str) or not item.strip() for item in data):
            raise ValueError(f"visualAssets[{index}].data must contain at least two strings")
        asset = {
            "id": f"visual-{index + 1}",
            "title": str(raw["title"]).strip(),
            "description": str(raw["description"]).strip(),
            "type": asset_type,
            "data": data,
        }
        if not asset["title"] or not asset["description"]:
            raise ValueError(f"visualAssets[{index}] title and description are required")
        asset["imageUrl"] = _visual_asset_image_url(asset)
        logger.info(
            "Visual generation response: id=%s type=%s data_count=%s image_url_bytes=%s",
            asset["id"],
            asset["type"],
            len(asset["data"]),
            len(asset["imageUrl"].encode("utf-8")),
        )
        prepared.append(asset)
    return prepared


def _lesson_generation_prompt(
    req: models.GenerateLessonRequest,
    learner_state: models.LearnerState,
    teaching_strategy: models.TeachingStrategy,
    selected_lesson: Dict[str, Any],
    lesson_title: str,
    lesson_objectives: list[Any],
    learning_style: str,
) -> str:
    constraints = req.constraints or {}
    learner_profile = constraints.get("learner_profile", {})
    return (
        f"Create a complete learner-facing lesson for learner {req.learner_id}.\n"
        f"Learning goal: {learner_profile.get('learning_goal')}\n"
        f"Topic: {req.topic}\n"
        f"Current knowledge level: {learner_state.knowledge_level}\n"
        f"Learning style: {learning_style}\n"
        f"Preferred difficulty: {constraints.get('preferred_difficulty') or teaching_strategy.difficulty_level}\n"
        f"Strong areas: {json.dumps(learner_state.strong_topics)}\n"
        f"Weak areas: {json.dumps(learner_state.weak_topics)}\n"
        f"Progress history: {json.dumps(learner_state.adaptation_history)}\n"
        f"Roadmap stage context: {json.dumps(selected_lesson)}\n"
        f"Roadmap objectives: {json.dumps(lesson_objectives)}\n"
        f"Complete learner profile: {json.dumps(learner_profile)}\n"
        f"Learner state: {learner_state.model_dump_json()}\n"
        f"Teaching strategy: {teaching_strategy.model_dump_json()}\n"
        f"Additional constraints: {json.dumps(constraints)}\n\n"
        "Use the selected roadmap stage as the lesson's sole curricular scope.\n\n"
        "Return ONLY a valid JSON object.\n"
        "Do not wrap in markdown.\n"
        "Do not use code fences.\n"
        "Do not include commentary.\n"
        "Do not include text before or after the JSON object.\n"
        "Use exactly these fourteen top-level fields and no others:\n"
        "title (string), overview (string), learningStyle (string), learningObjectives (array of strings), "
        "coreConcepts (array of strings), explanation (string), visualAssets (array of objects), audioScript (string), "
        "examples (array of strings), practiceQuestions (array of strings), guidedActivities (array of strings), "
        "reflectionQuestions (array of strings), keyTakeaways (array of strings), nextSteps (array of strings).\n"
        "All arrays except visualAssets must contain strings only. Each visualAssets object must contain exactly: "
        "title (string), description (string), type (graph, diagram, flowchart, concept_map, timeline, illustration, "
        "or process), and data (array). For graph visualizations, return graph points as structured objects with numeric "
        "x and y fields. Correct: [{\"x\":0,\"y\":0},{\"x\":1,\"y\":2}]. Incorrect: [\"0,0\",\"1,2\"]. "
        "Never use string coordinates or comma-separated graph values. Graph data must contain 4 to 12 points. "
        "For diagrams, flows, maps, timelines, and processes, data must be 2 to 6 ordered string node labels. "
        "Do not generate imageUrl; the verified renderer creates it after validation.\n"
        "Return exactly 4 coreConcepts, 4 examples, 4 practiceQuestions, 2 learningObjectives, 2 reflectionQuestions, "
        "2 keyTakeaways, and 2 nextSteps. visualAssets may be empty only for non-visual/non-mixed lessons; audioScript "
        "may be empty only for non-auditory/non-mixed lessons; guidedActivities may be empty only for non-kinesthetic/"
        "non-mixed lessons. Respect these word limits: title 12 words; overview 50 to 80 words; each learning objective "
        "at most 20 words; each core concept 40 to 70 words; explanation 80 to 160 words (220 to 300 for Reading/Writing; "
        "60 to 90 for Kinesthetic); each example 40 to 70 words; each practice question 25 to 50 words; each reflection question "
        "at most 30 words; each key takeaway 20 to 35 words; each next step 20 to 35 words. For Visual/Mixed return "
        "2 to 4 visualAssets. For Auditory/Mixed return an audioScript of 120 to 180 words. "
        "For Kinesthetic return exactly 3 guidedActivities of 90 to 120 words each, labelled Easy, Medium, and Hard. "
        "Keep the entire response under "
        "1,400 words. Use one paragraph per string, with no decorative headings or repeated explanations.\n\n"
        "Teaching quality requirements:\n"
        "- Act as an expert adaptive educator.\n"
        "- Generate the lesson using the teaching methodology most effective for the specified learning style. "
        "Do not simply change wording. Change the structure, content, activities, and presentation of the lesson "
        "according to the learning style.\n"
        "- Generate the lesson using teaching strategies specifically optimized for the learner's learning style. "
        "The lesson structure, examples, explanations, activities, and practice questions must reflect that learning "
        "style throughout the lesson.\n"
        f"- Learning-style teaching contract: {_lesson_style_contract(learning_style)}\n"
        "- The lesson must be directly studyable by a person. It should explain, demonstrate, coach practice, "
        "and check understanding without relying on a human teacher to fill gaps.\n"
        "- Use a concrete throughline example that fits the topic. Reuse it across sections, then add a fresh "
        "practice case near the end.\n"
        "- Start from intuition and vocabulary, then move to procedure, then interpretation, then independent practice.\n"
        "- Name common misconceptions and show how to avoid them.\n"
        "- Use plain language first, then introduce notation or formal terms after the idea is clear.\n"
        "- If the topic is mathematical, include symbols, units or quantities, and at least one worked example with "
        "numbered steps and a final interpretation.\n"
        "- If the topic is not mathematical, include a realistic scenario, decision points, and an applied example.\n"
        "- Adapt difficulty, pacing, examples, and cognitive load to education level, familiarity, learning style, "
        "availability, and accessibility needs.\n\n"
        "Hard constraints: Do not use projects, project goals, applied projects, or project context. Never emit "
        "placeholders such as [Topic], [Concept], TODO, or template text. Do not tell the learner to 'state the "
        "central idea' unless the central idea has already been taught in the lesson."
    )




def _parse_lesson_json(text: str) -> tuple[Dict[str, Any], str, str | None]:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise json.JSONDecodeError("Lesson response does not contain a complete JSON object", text, max(start, 0))
    candidate = text[start : end + 1]
    try:
        return json.loads(candidate), candidate, None
    except json.JSONDecodeError as parse_error:
        try:
            repaired_payload = _json_from_model_text(candidate)
        except (json.JSONDecodeError, ValueError, TypeError):
            raise parse_error
        repaired = json.dumps(repaired_payload, ensure_ascii=False)
        return repaired_payload, candidate, repaired


def _validate_lesson_payload(payload: Dict[str, Any]) -> None:
    required = {
        "title", "overview", "learningStyle", "learningObjectives", "coreConcepts", "explanation", "visualAssets",
        "audioScript", "examples", "practiceQuestions", "guidedActivities", "reflectionQuestions", "keyTakeaways", "nextSteps",
    }
    errors: list[str] = []
    missing = sorted(required.difference(payload))
    unexpected = sorted(set(payload).difference(required))
    if missing:
        errors.append(f"missing fields: {missing}")
    if unexpected:
        errors.append(f"unexpected fields: {unexpected}")
    for field in ("title", "overview", "learningStyle", "explanation"):
        if field in payload and (not isinstance(payload[field], str) or not payload[field].strip()):
            errors.append(f"{field} must be a non-empty string")
    if "audioScript" in payload and not isinstance(payload["audioScript"], str):
        errors.append("audioScript must be a string")
    array_fields = required.difference({"title", "overview", "learningStyle", "explanation", "audioScript"})
    mandatory_arrays = array_fields.difference({"visualAssets", "guidedActivities"})
    for field in sorted(array_fields):
        value = payload.get(field)
        if not isinstance(value, list):
            errors.append(f"{field} must be an array of strings")
        elif field in mandatory_arrays and not value:
            errors.append(f"{field} must be a non-empty array of strings")
        elif field != "visualAssets" and any(not isinstance(item, str) or not item.strip() for item in value):
            errors.append(f"{field} must contain only non-empty strings")
    if isinstance(payload.get("visualAssets"), list) and payload["visualAssets"]:
        try:
            payload["visualAssets"] = _normalize_visual_assets(payload["visualAssets"])
            _prepare_visual_assets(payload["visualAssets"])
        except ValueError as exc:
            errors.append(str(exc))
    for field in ("coreConcepts", "examples", "practiceQuestions"):
        value = payload.get(field)
        if isinstance(value, list) and len(value) != 4:
            errors.append(f"{field} must contain exactly 4 items; received {len(value)}")
    for index, concept in enumerate(payload.get("coreConcepts") or []):
        if isinstance(concept, str) and len(concept.strip()) < 80:
            errors.append(f"coreConcepts[{index}] must contain a complete explanation")
    for index, example in enumerate(payload.get("examples") or []):
        if isinstance(example, str) and len(example.strip()) < 60:
            errors.append(f"examples[{index}] must contain a complete worked example")
    for index, practice in enumerate(payload.get("practiceQuestions") or []):
        if isinstance(practice, str) and len(practice.strip()) < 30:
            errors.append(f"practiceQuestions[{index}] must be an answerable activity")
    if errors:
        raise ValueError("; ".join(errors))


def _validate_lesson_style(payload: Dict[str, Any], learning_style: str, topic: str) -> None:
    style_key = _lesson_style_key(learning_style)
    declared_style = _lesson_style_key(payload["learningStyle"])
    if declared_style != style_key:
        raise ValueError(f"learningStyle must match {learning_style}; received {payload['learningStyle']}")
    visual_assets = _prepare_visual_assets(payload["visualAssets"]) if payload["visualAssets"] else []
    visual_text = " ".join(
        f"{asset['title']} {asset['description']} {asset['type']} {json.dumps(asset['data'])}"
        for asset in visual_assets
    ).lower()
    audio_text = payload["audioScript"].lower()
    teaching_text = " ".join([payload["explanation"], *payload["coreConcepts"], *payload["examples"]]).lower()
    practice_text = " ".join([*payload["practiceQuestions"], *payload["guidedActivities"]]).lower()

    evidence = {
        "visual": (
            (visual_text, ("diagram", "flowchart", "concept map", "table", "graph", "chart", "timeline", "->", "→")),
            (teaching_text, ("visual", "see", "graph", "curve", "diagram", "map", "table", "spatial")),
            (practice_text, ("draw", "sketch", "map", "graph", "diagram", "compare", "visualize")),
        ),
        "auditory": (
            (audio_text, ("conversation", "story", "dialogue", "listen", "aloud", "spoken", "verbal", "imagine")),
            (teaching_text, ("say", "hear", "spoken", "verbal", "story", "conversation", "sounds")),
            (practice_text, ("aloud", "explain it back", "teach back", "discuss", "verbal", "listen", "tell")),
        ),
        "reading_writing": (
            (teaching_text, ("definition", "terminology", "notes", "summary", "textbook", "written", "key term")),
            (teaching_text, ("definition", "term", "paragraph", "notes", "written", "means", "notation")),
            (practice_text, ("write", "summarize", "define", "outline", "compare in words", "notes")),
        ),
        "kinesthetic": (
            (practice_text, ("hands-on", "activity", "experiment", "real-world", "practice-first", "try", "do")),
            (teaching_text, ("action", "perform", "measure", "test", "solve", "try", "do", "apply")),
            (practice_text, ("solve", "build", "test", "measure", "experiment", "try", "perform", "act")),
        ),
    }
    if style_key == "mixed":
        if not payload["visualAssets"] or not payload["audioScript"].strip() or not payload["guidedActivities"]:
            raise ValueError("mixed/adaptive lesson must populate visualAssets, audioScript, and guidedActivities")
        if len(payload["audioScript"].split()) < 100:
            raise ValueError("mixed/adaptive lesson requires at least 100 words of audio narration")
        if len(payload["explanation"].split()) < 100:
            raise ValueError("mixed/adaptive lesson requires at least 100 words of structured written explanation")
        if len(payload["guidedActivities"]) < 2:
            raise ValueError("mixed/adaptive lesson requires at least two guided practice activities")
        return

    labels = {
        "visual": ("visualAssets", "explanations/examples", "practiceQuestions"),
        "auditory": ("audioScript", "explanations/examples", "practiceQuestions"),
        "reading_writing": ("detailed written content", "explanations/examples", "practiceQuestions"),
        "kinesthetic": ("guidedActivities", "explanations/examples", "practiceQuestions"),
    }[style_key]
    missing = [label for label, (content, terms) in zip(labels, evidence[style_key]) if not any(term in content for term in terms)]
    if missing:
        raise ValueError(f"{learning_style} methodology is not evident in: {missing}")
    if style_key == "visual":
        if not payload["visualAssets"]:
            raise ValueError("visual lesson must populate visualAssets")
        topic_lower = topic.lower()
        domain_rules = {
            "mathematics": (("math", "calculus", "algebra", "geometry", "statistics"), ("graph", "plot")),
            "science": (("science", "physics", "chemistry", "biology"), ("process", "system", "cause", "effect", "flow")),
            "programming": (("programming", "code", "software", "computer"), ("architecture", "data flow", "execution flow", "flowchart")),
            "history": (("history", "historical"), ("timeline", "event map")),
        }
        for domain, (topic_terms, visual_terms) in domain_rules.items():
            if any(term in topic_lower for term in topic_terms) and not any(term in visual_text for term in visual_terms):
                raise ValueError(f"visual {domain} lesson requires domain-specific visualAssets")
    elif style_key == "auditory":
        if not payload["audioScript"].strip():
            raise ValueError("auditory lesson must populate audioScript")
        if len(payload["audioScript"].split()) < 100:
            raise ValueError("auditory audioScript must contain at least 100 words of narration")
    elif style_key == "reading_writing":
        if len(payload["explanation"].split()) < 180:
            raise ValueError("reading/writing lesson requires at least 180 words of detailed explanation")
    elif style_key == "kinesthetic":
        activities = payload["guidedActivities"]
        if len(activities) != 3 or not all(
            any(label in activity.lower() for label in ("easy", "medium", "hard"))
            for activity in activities
        ):
            raise ValueError("kinesthetic guidedActivities must provide Easy, Medium, and Hard activities")
        difficulty_labels = {label for label in ("easy", "medium", "hard") if any(label in item.lower() for item in activities)}
        if len(difficulty_labels) != 3:
            raise ValueError("kinesthetic guidedActivities must include all three difficulty levels: Easy, Medium, Hard")
        practice_words = len(practice_text.split())
        all_text = " ".join(
            str(value) if isinstance(value, str) else " ".join(value)
            for value in payload.values()
            if isinstance(value, (str, list))
        )
        if practice_words / max(len(all_text.split()), 1) < 0.4:
            raise ValueError("kinesthetic lesson must contain at least 40% practice-based content")


def _lesson_payload_to_blueprint(
    payload: Dict[str, Any],
    req: models.GenerateLessonRequest,
    selected_lesson: Dict[str, Any],
    learning_style: str,
) -> models.LessonBlueprint:
    sections = []
    for index in range(4):
        explanation = payload["coreConcepts"][index]
        if index == 0:
            explanation = f"{payload['explanation']}\n\n{explanation}"
        sections.append(
            {
                "title": f"{payload['title']} - concept {index + 1}",
                "explanation": explanation,
                "example": payload["examples"][index],
                "concept_connection": payload["keyTakeaways"][index % len(payload["keyTakeaways"])],
                "checkpoint": payload["practiceQuestions"][index],
            }
        )
    interactions = [{"prompt": item} for item in payload["learningObjectives"]]
    interactions.extend({"prompt": item} for item in payload["reflectionQuestions"])
    style_key = _lesson_style_key(learning_style)
    modality_sequences = {
        "visual": ["visual overview", "diagram or concept map", "visual walkthrough", "guided visual practice"],
        "auditory": ["spoken overview", "conversational explanation", "verbal example", "explain-it-back practice"],
        "reading_writing": ["definitions", "structured notes", "written example", "written synthesis"],
        "kinesthetic": ["practice-first activity", "hands-on discovery", "applied example", "independent action"],
        "mixed": ["visual representation", "spoken explanation", "written notes", "hands-on practice", "adaptive reflection"],
    }
    blueprint = models.LessonBlueprint(
        lesson_id=f"lesson:{req.learner_id}:{uuid4()}",
        topic=req.topic,
        selected_lesson=selected_lesson,
        learning_objective=payload["title"],
        lesson_summary=payload["overview"],
        lesson_structure=sections,
        modality_sequence=modality_sequences[style_key],
        interaction_points=interactions,
        assessment_points=[{"prompt": item} for item in payload["nextSteps"]],
        estimated_lesson_duration=int(selected_lesson["estimated_duration"]),
    )
    if style_key in {"visual", "mixed"}:
        visual_assets = _prepare_visual_assets(payload["visualAssets"])
        blueprint.visualElements = visual_assets
        blueprint.diagramDescriptions = [asset for asset in visual_assets if asset["type"] != "graph"]
        blueprint.graphData = [asset for asset in visual_assets if asset["type"] == "graph"]
    if style_key in {"auditory", "mixed"}:
        blueprint.audioNarration = payload["audioScript"]
        blueprint.ttsContent = payload["audioScript"]
        narration_sentences = re.split(r"(?<=[.!?])\s+", payload["audioScript"].strip())
        split_at = max(1, (len(narration_sentences) + 1) // 2)
        narration_parts = [narration_sentences[:split_at], narration_sentences[split_at:]]
        blueprint.audioSections = [
            {
                "title": f"{payload['title']} - narration {index + 1}",
                "script": " ".join(sentences),
                "discussion_prompts": payload["reflectionQuestions"] if index == len(narration_parts) - 1 else [],
            }
            for index, sentences in enumerate(narration_parts)
            if sentences
        ]
    if style_key in {"kinesthetic", "mixed"}:
        blueprint.interactiveQuestions = [{"prompt": item} for item in payload["practiceQuestions"]]
        blueprint.practiceExercises = [{"activity": item} for item in payload["guidedActivities"]]
    return blueprint


async def lesson_planning_agent(
    req: models.GenerateLessonRequest,
    learner_state: models.LearnerState,
    teaching_strategy: models.TeachingStrategy,
) -> models.LessonBlueprint:
    selected_lesson = req.selected_lesson or {}
    if not selected_lesson:
        raise ValueError("Lesson generation requires a selected AI-generated roadmap stage")
    if "estimated_duration" not in selected_lesson:
        raise ValueError("Selected roadmap stage is missing estimated_duration")
    lesson_title = selected_lesson.get("title") or req.topic
    lesson_objectives = selected_lesson.get("objectives") or []
    learning_style = _lesson_learning_style(req, learner_state, teaching_strategy)
    prompt = _lesson_generation_prompt(
        req, learner_state, teaching_strategy, selected_lesson, lesson_title, lesson_objectives, learning_style
    )
    prompt = (
        f"{prompt}\n\nLearning style is a first-class delivery constraint: {learning_style}.\n"
        "Adapt wording, examples, practice, and pacing to that style while preserving the flat JSON contract."
    )
    lesson_request_id = f"lesson-request:{uuid4()}"
    base_messages = [
        {
            "role": "system",
            "content": (
                "You are a master teacher and curriculum designer. Return one strictly valid JSON object with "
                "double-quoted keys and strings. Escape quotes, backslashes, and line breaks inside strings. "
                "Do not use Markdown fences or include commentary outside the JSON object."
            ),
        },
        {"role": "user", "content": prompt},
    ]
    messages = list(base_messages)
    logger.info(
        "Lesson generation request: lesson_request_id=%s learner_id=%s topic=%s selected_stage=%s prompt_size=%s max_tokens=%s context=%s",
        lesson_request_id, req.learner_id, req.topic, lesson_title, len(prompt), 4096,
        json.dumps({"profile": (req.constraints or {}).get("learner_profile", {}), "state": learner_state.model_dump(), "strategy": teaching_strategy.model_dump()}),
    )

    for attempt in range(3):
        text = ""
        candidate_text = ""
        repaired_text = None
        failure_stage = "model call"
        try:
            if attempt:
                logger.info("Lesson correction retry: lesson_request_id=%s attempt=%s", lesson_request_id, attempt + 1)
            resp = await _call_layer("planning", messages, temperature=0.2, max_tokens=4096)
            text = resp["choices"][0]["message"]["content"]
            stop_reason = (resp.get("raw") or {}).get("stop_reason")
            logger.info(
                "Lesson generation response: lesson_request_id=%s attempt=%s stop_reason=%s completion_length=%s response_size=%s max_tokens=%s",
                lesson_request_id, attempt + 1, stop_reason,
                len(text), len(text.encode("utf-8")), 4096,
            )
            if stop_reason == "max_tokens":
                failure_stage = "truncated model output"
                raise ValueError("completion reached max_tokens before producing a complete lesson JSON object")
            failure_stage = "JSON parsing"
            payload, candidate_text, repaired_text = _parse_lesson_json(text)
            if repaired_text is not None:
                logger.warning(
                    "Lesson JSON repaired: lesson_request_id=%s raw_response=%r repaired_response=%s",
                    lesson_request_id, text, repaired_text,
                )
            failure_stage = "lesson payload validation"
            _validate_lesson_payload(payload)
            failure_stage = "learning style validation"
            _validate_lesson_style(payload, learning_style, req.topic)
            failure_stage = "LessonBlueprint validation"
            blueprint = _lesson_payload_to_blueprint(payload, req, selected_lesson, learning_style)
            _validate_blueprint(blueprint)
            blueprint.generation_source = "ai"
            blueprint.generation_model = resp.get("model")
            blueprint.learning_style = learning_style
            asyncio.create_task(_persist_lesson_embedding(blueprint, req.learner_id, req.topic))
            return blueprint
        except Exception as exc:
            logger.warning(
                "Lesson generation failure: lesson_request_id=%s attempt=%s stage=%s error=%s raw_model_response=%r repaired_response=%r",
                lesson_request_id, attempt + 1, failure_stage, exc, text, repaired_text,
            )
            if attempt == 2:
                logger.error("Lesson generation failed after corrections: lesson_request_id=%s topic=%s error=%s", lesson_request_id, req.topic, exc)
                raise RuntimeError(f"Lesson generation failed after 3 correction attempts ({failure_stage}): {exc}") from exc
            correction_source = repaired_text or candidate_text or text
            if failure_stage == "learning style validation":
                correction_instruction = (
                    f"The lesson does not consistently use {learning_style} methodology: {exc}. Revise the teaching "
                    "methodology throughout visualAssets, audioScript, explanations, examples, practiceQuestions, and "
                    "guidedActivities. Preserve "
                    "the topic, facts, and learning objectives, but make the structure and activities unmistakably "
                    f"optimized for {learning_style}."
                )
            else:
                correction_instruction = (
                    "You returned invalid JSON. Fix the JSON and return ONLY corrected JSON. Do not regenerate or "
                    f"rewrite the lesson content. The {failure_stage} error was: {exc}."
                )
            messages = [
                *base_messages,
                {"role": "assistant", "content": correction_source},
                {
                    "role": "user",
                    "content": (
                        f"{correction_instruction} Return the complete corrected object with exactly the fourteen required "
                        "fields, no Markdown, no code fences, and no commentary. "
                        "Preserve the lesson meaning, but compact wording as needed to obey every field limit and keep "
                        "the complete JSON under 1,400 words."
                    ),
                },
            ]

    raise RuntimeError("Lesson generation failed without a response")


async def lesson_roadmap_agent(
    req: models.GenerateLessonRequest,
    learner_profile: models.LearnerProfile,
    learner_state: models.LearnerState,
    teaching_strategy: models.TeachingStrategy,
) -> models.LessonRoadmapResponse:
    constraints = req.constraints or {}
    planning_context = {
        "user_goal": req.topic,
        "learning_goal": learner_profile.learning_goal,
        "target_outcome": constraints.get("target_outcome") or learner_profile.learning_goal,
        "education_level": constraints.get("education_level") or learner_profile.education_level,
        "knowledge_level": constraints.get("familiarity_level") or learner_profile.topic_familiarity or learner_state.knowledge_level,
        "pace": constraints.get("pace") or learner_profile.pace_preference or learner_state.pace_preference,
        "learning_style": constraints.get("learning_style") or learner_profile.preferred_modality or learner_state.preferred_modalities,
        "availability": constraints.get("availability") or learner_profile.learning_availability,
        "accessibility": constraints.get("accessibility") or learner_profile.accessibility,
        "weak_areas": learner_state.weak_topics,
        "strong_areas": learner_state.strong_topics,
        "preferred_difficulty": constraints.get("preferred_difficulty") or teaching_strategy.difficulty_level,
        "profile_data": learner_profile.model_dump(),
        "prior_progress": learner_state.model_dump(),
        "teaching_strategy": teaching_strategy.model_dump(),
        "adaptation_context": constraints.get("adaptation_context", []),
    }
    prompt = (
        "Generate a personalized lesson roadmap before any lesson content is created. "
        "Generate all titles, descriptions, stages, topics, skills, and outcomes yourself; none will be filled in "
        "afterward. Return JSON only with a 'lessons' list of 4 to 8 items. Every item must include id, title, "
        "description, difficulty, estimated_duration as minutes, and objectives as a list of strings. "
        "Sequence prerequisites before advanced material and adapt the roadmap to this learner context. "
        "Make every lesson title specific enough that a teacher could teach from it; avoid vague titles such as "
        "'Core operations' unless the exact operations are named. Descriptions must say what the learner will "
        "understand, what they will practice, and how the lesson prepares the next lesson. "
        "Do not hardcode a generic plan. Do not use project context, project goals, or applied projects. "
        f"Learner roadmap context: {json.dumps(planning_context)}"
    )
    messages = [{"role": "user", "content": prompt}]
    logger.info("Roadmap generation request: learner_id=%s context=%s", req.learner_id, json.dumps(planning_context))
    for attempt in range(3):
        try:
            if attempt:
                logger.info("Roadmap generation retry attempt=%s learner_id=%s topic=%s", attempt + 1, req.learner_id, req.topic)
            resp = await _call_layer("planning", messages, temperature=0.7)
            text = resp["choices"][0]["message"]["content"]
            logger.info("Roadmap generation response: learner_id=%s attempt=%s response=%s", req.learner_id, attempt + 1, text)
            payload = _json_from_model_text(text)
            raw_lessons = payload.get("lessons")
            if not isinstance(raw_lessons, list) or not 4 <= len(raw_lessons) <= 8:
                raise ValueError("roadmap must contain 4 to 8 lessons")
            lessons = [_validate_roadmap_item(item, index) for index, item in enumerate(raw_lessons)]
            return models.LessonRoadmapResponse(
                learner_id=req.learner_id,
                topic=req.topic,
                generation_source="ai",
                generation_model=resp.get("model"),
                lessons=lessons,
            )
        except Exception as exc:
            logger.warning("Roadmap generation validation/model failure: learner_id=%s attempt=%s error=%s", req.learner_id, attempt + 1, exc)
            if attempt == 2:
                logger.error("Roadmap generation failed after retries: learner_id=%s topic=%s error=%s", req.learner_id, req.topic, exc)
                raise RuntimeError(f"Roadmap generation failed after 3 attempts: {exc}") from exc
            messages.append({"role": "user", "content": f"The previous roadmap was malformed: {exc}. Regenerate the complete JSON. Do not reuse or repair the previous output."})

    raise RuntimeError("Roadmap generation failed without a response")


def _validate_blueprint(blueprint: models.LessonBlueprint):
    if len(blueprint.lesson_structure) < 4:
        raise ValueError("lesson_structure must contain at least four learning steps")
    if not blueprint.topic.strip():
        raise ValueError("topic must be explicit")
    if not blueprint.learning_objective.strip() or not blueprint.lesson_summary.strip():
        raise ValueError("lesson requires a learning objective and overview")
    if not blueprint.interaction_points or not blueprint.assessment_points:
        raise ValueError("lesson requires guided practice, reflection, and assessment content")
    if not blueprint.modality_sequence:
        raise ValueError("lesson requires an explicit learning sequence")
    required_section_fields = {"title", "explanation", "example", "concept_connection", "checkpoint"}
    for index, section in enumerate(blueprint.lesson_structure):
        missing = required_section_fields.difference(section)
        if missing:
            raise ValueError(f"lesson_structure item {index + 1} is missing {sorted(missing)}")
        explanation = str(section.get("explanation", "")).strip()
        example = str(section.get("example", "")).strip()
        checkpoint = str(section.get("checkpoint", "")).strip()
        if len(explanation) < 80:
            raise ValueError(f"lesson_structure item {index + 1} needs a complete explanation")
        if len(example) < 60:
            raise ValueError(f"lesson_structure item {index + 1} needs a worked example")
        if len(checkpoint) < 30:
            raise ValueError(f"lesson_structure item {index + 1} needs an answerable checkpoint")
    serialized = json.dumps(blueprint.model_dump()).lower()
    placeholders = ["[topic]", "[concept]", "todo", "insert topic", "placeholder", "state the central idea of"]
    found = next((placeholder for placeholder in placeholders if placeholder in serialized), None)
    if found:
        raise ValueError(f"blueprint contains unresolved placeholder {found}")


def _lesson_learning_style(
    req: models.GenerateLessonRequest,
    learner_state: models.LearnerState,
    teaching_strategy: models.TeachingStrategy,
) -> str:
    constraints = req.constraints or {}
    candidates = [
        constraints.get("learning_style"),
        constraints.get("preferred_modality"),
        learner_state.preferred_modalities,
        teaching_strategy.recommended_modalities,
    ]
    for candidate in candidates:
        if isinstance(candidate, list) and candidate:
            candidate = candidate[0]
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return "Balanced Mix"


def _style_key(learning_style: str) -> str:
    style = learning_style.lower()
    if "visual" in style or "diagram" in style:
        return "visual"
    if "audio" in style or "listen" in style or "narration" in style:
        return "audio"
    if "practice" in style or "exercise" in style or "problem" in style:
        return "practice"
    if "written" in style or "detailed" in style or "explanation" in style:
        return "written"
    return "balanced"


def _modality_contract(learning_style: str) -> Dict[str, Any]:
    key = _style_key(learning_style)
    contracts = {
        "visual": {
            "primary_experience": "visual-first",
            "required_optional_fields": ["visualElements", "conceptMaps", "flowDiagrams", "graphData"],
            "text_density": "short captions and minimal paragraphs",
            "section_pattern": "visual representation, visual intuition, quick check",
        },
        "audio": {
            "primary_experience": "listening-first",
            "required_optional_fields": ["audioNarration", "audioSections", "ttsContent"],
            "text_density": "brief notes only",
            "section_pattern": "narration segment, spoken walkthrough, listening checkpoint",
        },
        "practice": {
            "primary_experience": "exercise-driven",
            "required_optional_fields": ["practiceExercises", "interactiveQuestions"],
            "text_density": "short explanations after practice",
            "section_pattern": "worked example, practice, feedback, mini explanation",
        },
        "written": {
            "primary_experience": "detailed written explanation",
            "required_optional_fields": [],
            "text_density": "comprehensive paragraphs with step-by-step reasoning",
            "section_pattern": "concept, derivation, worked example, checkpoint",
        },
        "balanced": {
            "primary_experience": "mixed multimodal",
            "required_optional_fields": ["visualElements", "practiceExercises"],
            "text_density": "concise",
            "section_pattern": "short explanation, visual, example, practice, optional narration",
        },
    }
    return contracts[key]


async def content_generation_agent(blueprint: models.LessonBlueprint) -> models.GeneratedContent:
    assets = []
    for index, step in enumerate(blueprint.lesson_structure):
        step_id = step.get('step') or str(index)
        content = step.get("explanation") or step.get("content") or json.dumps(step)
        assets.append({"id": f"asset:{blueprint.lesson_id}:{step_id}", "type": "text", "content": content})

    try:
        docs = [a["content"] for a in assets]
        metas = [{"lesson_id": blueprint.lesson_id, "type": a["type"]} for a in assets]
        ids = [a["id"] for a in assets]
        dimension = settings.titan_embedding_dimensions or "default"
        await chroma.add_documents(f"lesson_assets_{dimension}", docs, metas, ids=ids)
    except Exception as exc:
        logger.exception("Lesson asset embedding persistence failed: %s", exc)

    return models.GeneratedContent(lesson_assets=assets)


async def interactive_agent(req: models.TutorInteractionRequest, session_state: Dict[str, Any]) -> models.TutorInteractionResponse:
    lesson = session_state.get("lesson", {})
    prompt = (
        "You are a concise AI tutor inside an active lesson. Answer the learner's request directly, "
        "use the lesson context, and teach rather than merely reveal an answer. "
        f"Action: {req.action}. Lesson: {json.dumps(lesson)}. Learner question: {req.question}"
    )
    try:
        resp = await _call_layer("tutor", [{"role": "user", "content": prompt}], temperature=0.2)
        answer = resp["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.warning("Tutor model unavailable; using lesson-grounded response: %s", exc)
        answer = f"Here is a simpler way to think about it: {lesson.get('lesson_summary', '')} Focus on the objective: {lesson.get('learning_objective', '')}."
    return models.TutorInteractionResponse(interaction_id=f"interaction:{uuid4()}", answer=answer)


async def quiz_agent(req: models.GenerateQuizRequest, session_state: Dict[str, Any]) -> models.QuizResponse:
    lesson = session_state.get("lesson", {})
    style = _lesson_style_from_payload(lesson)
    style_contract = _assessment_contract(style)
    prompt = (
        "Generate an adaptive quiz for this lesson. Return JSON only with a 'questions' list of 4 items. "
        "Use question styles that match the learner modality contract. Every item must include id, type, prompt, "
        "expected_answer, concept, and explanation. MCQ items must also include options. "
        f"Learning style: {style}. Assessment contract: {json.dumps(style_contract)}. "
        f"Lesson: {json.dumps(lesson)}"
    )
    try:
        resp = await _call_layer("quiz", [{"role": "user", "content": prompt}], temperature=0.1)
        payload = _json_from_model_text(resp["choices"][0]["message"]["content"])
        questions = payload.get("questions")
        if not isinstance(questions, list) or len(questions) < 3:
            raise ValueError("quiz requires at least three questions")
    except Exception as exc:
        logger.warning("Quiz model unavailable; using lesson checkpoint quiz: %s", exc)
        questions = _fallback_questions(lesson, style)
    return models.QuizResponse(quiz_id=f"quiz:{uuid4()}", session_id=req.session_id, questions=questions)


async def assessment_agent(sub: models.AssessmentSubmission, session_state: Dict[str, Any] | None = None) -> models.AssessmentResult:
    lesson = (session_state or {}).get("lesson", {})
    style = _lesson_style_from_payload(lesson)
    assessment_context = {
        "selected_lesson": lesson.get("selected_lesson"),
        "learning_objective": lesson.get("learning_objective"),
        "assessment_points": lesson.get("assessment_points"),
        "learning_style": style,
        "assessment_contract": _assessment_contract(style),
        "learner_level": lesson.get("selected_lesson", {}).get("difficulty") if isinstance(lesson.get("selected_lesson"), dict) else None,
    }
    prompt = (
        "Evaluate this learner assessment. Return JSON only with quiz_scores (object of 0-1 scores keyed by question), "
        "mastery_estimates (object of 0-1 concept scores), score (0-1 overall), strengths (list), weaknesses (list), "
        "misconceptions (list), and detailed_feedback (string). "
        "Assess only the concepts taught in the selected lesson and its learning objectives. "
        "Do not use project context, project goals, or applied projects. "
        f"Lesson assessment context: {json.dumps(assessment_context)}. "
        f"Submission: {sub.model_dump_json()}"
    )
    try:
        resp = await _call_layer("assessment", [{"role": "user", "content": prompt}], temperature=0.0)
        payload = _json_from_model_text(resp["choices"][0]["message"]["content"])
        return models.AssessmentResult(learner_id=sub.learner_id, session_id=sub.session_id, **payload)
    except Exception as exc:
        logger.warning("Assessment model unavailable; using confidence-aware scoring: %s", exc)
        return _fallback_assessment(sub)


async def adaptation_agent(req: models.AdaptationRequest) -> models.AdaptationDecision:
    prompt = (
        "You are an adaptive learning agent. Decide the next teaching adaptation from this assessment state. "
        "Return JSON only with an 'adaptations' object describing the action, targets, and reasoning. "
        f"Assessment state: {json.dumps(req.assessment_state)}"
    )
    try:
        resp = await _call_layer(
            "adaptation",
            [{"role": "user", "content": prompt}],
            temperature=0.0,
        )
        payload = _json_from_model_text(resp["choices"][0]["message"]["content"])
        adaptations = payload.get("adaptations", payload)
        if not isinstance(adaptations, dict):
            raise ValueError("adaptations must be an object")
        return models.AdaptationDecision(
            learner_id=req.learner_id,
            session_id=req.session_id,
            adaptations=adaptations,
        )
    except Exception as exc:
        logger.warning("Adaptation model unavailable; using mastery-derived adaptation: %s", exc)
        weak = [key for key, value in req.assessment_state.get("mastery_estimates", {}).items() if float(value) < 0.7]
        return models.AdaptationDecision(
            learner_id=req.learner_id,
            session_id=req.session_id,
            adaptations={
                "action": "reinforce_foundations" if weak else "increase_challenge",
                "targets": weak,
                "reasoning": "Adjusted from the learner's latest mastery estimates.",
            },
        )


async def evolutionary_agent(state: Dict[str, Any]) -> Dict[str, Any]:
    current = dict(state.get("learner_model") or {})
    assessment = state["assessment"]
    adaptation = state["adaptation"]
    mastery = assessment.get("mastery_estimates", {})
    weak = [key for key, value in mastery.items() if float(value) < 0.7]
    strong = [key for key, value in mastery.items() if float(value) >= 0.8]
    history = list(current.get("adaptation_history") or [])
    history.append(adaptation)
    scores = list(mastery.values())
    current.update(
        {
            "weak_topics": weak,
            "strong_topics": strong,
            "confidence_score": sum(scores) / len(scores) if scores else current.get("confidence_score", 0.0),
            "engagement_score": min(1.0, float(current.get("engagement_score", 0.0)) + 0.1),
            "misconception_registry": assessment.get("misconceptions", []),
            "adaptation_history": history[-10:],
            "latest_adaptation": adaptation,
        }
    )
    return current


def _validate_roadmap_item(item: Any, index: int) -> models.LessonRoadmapItem:
    if not isinstance(item, dict):
        raise ValueError(f"roadmap lesson {index + 1} must be an object")
    required = {"id", "title", "description", "difficulty", "estimated_duration", "objectives"}
    missing = required.difference(item)
    if missing:
        raise ValueError(f"roadmap lesson {index + 1} is missing {sorted(missing)}")
    for field in ("id", "title", "description", "difficulty"):
        if not isinstance(item[field], str) or not item[field].strip():
            raise ValueError(f"roadmap lesson {index + 1} has an empty {field}")
    if not isinstance(item["objectives"], list) or not item["objectives"]:
        raise ValueError(f"roadmap lesson {index + 1} requires objectives")
    if any(not isinstance(value, str) or not value.strip() for value in item["objectives"]):
        raise ValueError(f"roadmap lesson {index + 1} has invalid objectives")
    try:
        duration = int(item["estimated_duration"])
    except (TypeError, ValueError) as exc:
        raise ValueError(f"roadmap lesson {index + 1} has an invalid estimated_duration") from exc
    if duration <= 0:
        raise ValueError(f"roadmap lesson {index + 1} estimated_duration must be positive")
    return models.LessonRoadmapItem(
        id=item["id"].strip(),
        title=item["title"].strip(),
        description=item["description"].strip(),
        difficulty=item["difficulty"].strip(),
        estimated_duration=duration,
        objectives=[value.strip() for value in item["objectives"]],
    )




def _lesson_style_from_payload(lesson: Dict[str, Any]) -> str:
    if isinstance(lesson.get("learning_style"), str) and lesson.get("learning_style", "").strip():
        return lesson["learning_style"]
    if lesson.get("audioNarration") or lesson.get("audioSections") or lesson.get("ttsContent"):
        return "Audio Learning"
    if lesson.get("visualElements") or lesson.get("conceptMaps") or lesson.get("diagramDescriptions"):
        return "Visual Examples and Diagrams"
    if lesson.get("practiceExercises") or lesson.get("interactiveQuestions"):
        return "Practice First Learning"
    sequence = [str(item).lower() for item in (lesson.get("modality_sequence") or [])]
    if any("written" in item or "derivation" in item for item in sequence):
        return "Detailed Written Explanations"
    return "Balanced Mix"


def _assessment_contract(learning_style: str) -> Dict[str, Any]:
    key = _style_key(learning_style)
    contracts = {
        "visual": {"focus": ["diagram interpretation", "visual reasoning"], "question_mix": ["mcq", "conceptual_reasoning"]},
        "audio": {"focus": ["verbal reasoning", "concept narration"], "question_mix": ["short_answer", "conceptual_reasoning"]},
        "practice": {"focus": ["problem solving", "numerical accuracy"], "question_mix": ["short_answer", "worked_problem"]},
        "written": {"focus": ["theory explanation", "formal reasoning"], "question_mix": ["short_answer", "conceptual_reasoning"]},
        "balanced": {"focus": ["visual + conceptual + procedural"], "question_mix": ["mcq", "short_answer", "conceptual_reasoning"]},
    }
    return contracts[key]


def _compress_text(text: str, max_chars: int) -> str:
    content = text.strip()
    if len(content) <= max_chars:
        return content
    sentence_chunks = re.split(r"(?<=[.!?])\s+", content)
    trimmed = ""
    for chunk in sentence_chunks:
        candidate = f"{trimmed} {chunk}".strip()
        if len(candidate) > max_chars:
            break
        trimmed = candidate
    if trimmed:
        return trimmed
    return f"{content[: max_chars - 1].rstrip()}…"




def _fallback_questions(lesson: Dict[str, Any], learning_style: str) -> list[Dict[str, Any]]:
    topic = lesson.get("topic", "the topic")
    sections = lesson.get("lesson_structure") or []
    style_key = _style_key(learning_style)
    questions: list[Dict[str, Any]] = []
    for index, section in enumerate(sections[:4]):
        concept = section.get("title", topic)
        base_prompt = section.get("checkpoint") or f"Explain the key idea from {concept}."
        if style_key == "visual":
            questions.append(
                {
                    "id": f"checkpoint-{index + 1}",
                    "type": "mcq",
                    "prompt": f"Which visual relationship best matches this concept: {concept}?",
                    "options": ["Input -> transformation -> output", "Output -> input -> proof", "Constant -> constant -> constant", "Random guess -> answer"],
                    "expected_answer": "Input -> transformation -> output",
                    "concept": concept,
                    "explanation": "Visual learners are assessed on interpreting relationships shown in diagrams.",
                }
            )
        elif style_key == "audio":
            questions.append(
                {
                    "id": f"checkpoint-{index + 1}",
                    "type": "short_answer",
                    "prompt": f"In your own spoken words, summarize the reasoning for {concept}.",
                    "expected_answer": section.get("explanation", ""),
                    "concept": concept,
                    "explanation": "Audio learners are assessed with verbal explanation prompts.",
                }
            )
        elif style_key == "practice":
            questions.append(
                {
                    "id": f"checkpoint-{index + 1}",
                    "type": "worked_problem",
                    "prompt": f"Solve a short {topic} problem using the approach from {concept}. Show steps.",
                    "expected_answer": section.get("example", section.get("explanation", "")),
                    "concept": concept,
                    "explanation": "Practice-first learners are assessed through procedural problem-solving.",
                }
            )
        elif style_key == "written":
            questions.append(
                {
                    "id": f"checkpoint-{index + 1}",
                    "type": "conceptual_reasoning",
                    "prompt": f"Provide a detailed conceptual explanation for {concept}.",
                    "expected_answer": section.get("explanation", ""),
                    "concept": concept,
                    "explanation": "Written-mode learners are assessed with theory-first reasoning prompts.",
                }
            )
        else:
            questions.append(
                {
                    "id": f"checkpoint-{index + 1}",
                    "type": "conceptual_reasoning" if index else "short_answer",
                    "prompt": base_prompt,
                    "expected_answer": section.get("explanation", ""),
                    "concept": concept,
                    "explanation": "Balanced mode blends concept checks and applied understanding.",
                }
            )
    return questions


def _fallback_assessment(sub: models.AssessmentSubmission) -> models.AssessmentResult:
    scores = {}
    for question_id, answer in sub.answers.items():
        confidence = float(sub.confidence.get(question_id, 50)) / 100
        completeness = min(1.0, len(str(answer).split()) / 12)
        scores[question_id] = round((completeness * 0.7) + (confidence * 0.3), 3)
    overall = sum(scores.values()) / len(scores) if scores else 0.0
    weak = [key for key, value in scores.items() if value < 0.7]
    return models.AssessmentResult(
        learner_id=sub.learner_id,
        session_id=sub.session_id,
        quiz_scores=scores,
        mastery_estimates=scores,
        score=overall,
        strengths=[key for key, value in scores.items() if value >= 0.8],
        weaknesses=weak,
        misconceptions=[],
        detailed_feedback="Your responses were recorded. The next lesson will adjust its pacing and practice emphasis from your answer completeness and confidence.",
    )
