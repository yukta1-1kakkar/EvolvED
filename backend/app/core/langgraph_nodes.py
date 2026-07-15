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
from app.ai.openrouter_provider import OpenRouterProvider
from app.ai.router import ModelRouter
from app.core.chroma_client import ChromaClient
from app.core.config import settings
from uuid import uuid4


provider = get_provider()
chroma = ChromaClient()
logger = logging.getLogger(__name__)
LESSON_MAX_TOKENS = 8192


def lesson_embedding_collection() -> str:
    dimension = settings.titan_embedding_dimensions or "default"
    return f"lessons_{dimension}"


async def _call_layer(layer: str, messages: list[Dict[str, str]], **kwargs):
    primary = ModelRouter.get_model(layer)
    try:
        response = await provider.call_chat_model(messages, model=primary, **kwargs)
        response["model"] = primary
        response["provider"] = settings.active_provider.lower()
        return response
    except Exception as exc:
        fallback = settings.reasoning_model
        if fallback == primary:
            openrouter_response = await _call_openrouter_layer(layer, messages, exc, **kwargs)
            if openrouter_response is not None:
                return openrouter_response
            raise
        logger.warning("%s model unavailable: %s; retrying with fallback %s: %s", layer, primary, fallback, exc)
        try:
            response = await provider.call_chat_model(messages, model=fallback, **kwargs)
            response["model"] = fallback
            response["provider"] = settings.active_provider.lower()
            return response
        except Exception as fallback_exc:
            logger.error("%s fallback model unavailable: %s: %s", layer, fallback, fallback_exc)
            openrouter_response = await _call_openrouter_layer(layer, messages, fallback_exc, **kwargs)
            if openrouter_response is not None:
                return openrouter_response
            raise


async def _call_openrouter_layer(layer: str, messages: list[Dict[str, str]], original_exc: Exception, **kwargs):
    if not settings.openrouter_api_key or settings.active_provider.lower() == "openrouter":
        return None
    openrouter = OpenRouterProvider()
    try:
        response = await openrouter.call_chat_model(messages, model=ModelRouter.get_model(layer), **kwargs)
        response["provider"] = "openrouter"
        logger.warning("%s Bedrock unavailable, generated with OpenRouter instead: %s", layer, original_exc)
        return response
    except Exception as exc:
        logger.error("%s OpenRouter failover unavailable: %s", layer, exc)
        return None


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
            "strategy_type": _strategy_text(payload.get("strategy_type") or payload.get("strategyType")) or "adaptive",
            "recommended_modalities": _strategy_list(payload.get("recommended_modalities") or payload.get("recommendedModalities")),
            "difficulty_level": _strategy_text(payload.get("difficulty_level") or payload.get("difficultyLevel")),
            "pacing_strategy": _strategy_text(payload.get("pacing_strategy") or payload.get("pacingStrategy")),
            "interaction_density": _strategy_text(payload.get("interaction_density") or payload.get("interactionDensity")),
        }

        return models.TeachingStrategy(**normalized)
    except (ValueError, TypeError, ValidationError) as exc:
        raise RuntimeError(f"Pedagogy agent returned invalid JSON: {exc}") from exc


def _strategy_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list):
        return ", ".join(filter(None, (_strategy_text(item) for item in value))) or None
    if isinstance(value, dict):
        parts = [f"{key}: {_strategy_text(item)}" for key, item in value.items() if _strategy_text(item)]
        return "; ".join(parts) or None
    return str(value)


def _strategy_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [text for item in value if (text := _strategy_text(item))]
    text = _strategy_text(value)
    return [text] if text else []


def _lesson_style_key(learning_style: str) -> str:
    style = learning_style.lower()
    if "visual" in style:
        return "visual"
    if "auditory" in style or "audio" in style or "listen" in style:
        return "auditory"
    if "reading" in style or "writing" in style or "written" in style:
        return "reading_writing"
    return "reading_writing"


def _canonical_lesson_style(learning_style: str) -> str:
    labels = {
        "visual": "Visual Examples and Diagrams",
        "auditory": "Audio Learning",
        "reading_writing": "Detailed Written Explanations",
    }
    return labels[_lesson_style_key(learning_style)]


def _lesson_style_contract(learning_style: str) -> str:
    contracts = {
        "visual": (
            "Teach visually throughout. visualAssets are the primary explanation mechanism and must include "
            "lesson-specific diagrams, flowcharts, concept maps, knowledge graphs, summaries, process maps, or "
            "mathematical visualizations. For mathematics include coordinate graphs, vector plots, geometric "
            "illustrations, transformation diagrams, function visualizations, derivative visualizations, or matrix "
            "visualizations as appropriate. Text must be short captions that support the visuals. Examples must walk "
            "through what the learner would see, and guided practice must ask the learner to draw, sketch, map, "
            "compare, or interpret a graph or diagram."
        ),
        "auditory": (
            "Teach like a conversational tutor speaking directly to the learner. audioScript must be a complete "
            "narration using a spoken walkthrough, story, dialogue, and verbal analogy. It must cover every core "
            "concept in the lesson in order, so the generated audio can teach the full lesson instead of a short "
            "overview. Examples must sound natural when read aloud. Reflection questions must work as discussion prompts, and practiceQuestions must include "
            "explain-it-back, say-it-aloud, discussion, or verbal reasoning activities."
        ),
        "reading_writing": (
            "Teach as high-quality textbook study material. explanation must be longer and detailed. coreConcepts must "
            "provide precise definitions, important terminology, and structured notes. Examples must show detailed "
            "written reasoning. keyTakeaways must form a written summary, and practiceQuestions must require writing, "
            "summarizing, defining, outlining, or comparing in words."
        ),
    }
    return contracts[_lesson_style_key(learning_style)]


def _accessibility_contract(constraints: Dict[str, Any]) -> str:
    accessibility = constraints.get("accessibility") if isinstance(constraints.get("accessibility"), dict) else {}
    if not accessibility.get("additional_support") and not accessibility.get("dyslexia_support"):
        return "No additional accessibility preference was selected; still use clear language and explicit transitions."
    return (
        "Accessibility support is active. Use dyslexia-aware instructional design based on current spacing and "
        "readability evidence. Keep paragraphs to five lines or fewer, keep most sentences under 25 words, and place "
        "the need-to-know point first. Use predictable headings, explicit step labels, plain language before notation, "
        "and one idea per sentence when possible. Avoid dense walls of text, unexplained symbols, ambiguous pronouns, "
        "unnecessary jargon, all-caps emphasis, italics, and fully justified prose. Pair symbols with spoken/plain-language "
        "meaning. When visual material is useful, include relevant diagrams or coordinate visuals that reduce reading load. "
        "Do not claim a special dyslexia font is required. The UI will handle readable spacing, about 1.5 line spacing, "
        "modest letter spacing, proportional word spacing, left alignment, and a tinted low-glare reading surface."
    )


def _symbolic_math_contract(topic: str, constraints: Dict[str, Any]) -> str:
    accessibility = constraints.get("accessibility") if isinstance(constraints.get("accessibility"), dict) else {}
    if not accessibility.get("symbolic_math_required") and not _is_mathematical_topic(topic):
        return "Use formal notation only when it improves clarity."
    return (
        "Symbolic mathematics is required. Include compact LaTeX-style expressions wrapped in $...$ for definitions, "
        "worked examples, and final interpretations. Every symbol must be explained in words immediately before or "
        "after it. Prefer learner-readable notation over dense syntax: write 'vector v has magnitude 7' near "
        "$\\|\\vec{v}\\| = 7$, and write 'unit x direction' near $\\hat{i}$. Do not leave commands such as "
        "\\vec, \\hat, \\geq, \\leq, or \\frac unexplained. For linear algebra and calculus, include at least one expression such as $Ax = lambda x$, "
        "$f'(x)$, $grad f$, $H_f$, a vector norm, projection formula, limit, derivative, or matrix expression when "
        "appropriate to the selected lesson."
    )


def _roadmap_syllabus_contract(topic: str) -> str:
    normalized = topic.strip().lower()
    if "linear" in normalized and "algebra" in normalized:
        return (
            "Required syllabus sequence for Linear Algebra Foundations: vectors, matrices, norms, projections, "
            "eigenvalues, diagonalisation. The roadmap must contain these exact concept groups in this order."
        )
    if "calculus" in normalized:
        return (
            "Required syllabus sequence for Calculus: limits, derivatives, gradients, multivariable calculus, "
            "Hessians. The roadmap must contain these exact concept groups in this order."
        )
    return ""


def _visual_asset_image_url(asset: Dict[str, Any]) -> str:
    title = str(asset["title"])
    description = str(asset["description"])
    asset_type = str(asset["type"]).lower()
    data = asset["data"]
    width, height = 1300, 760
    font = "Arial, Helvetica, sans-serif"
    animation = (
        "<style>"
        ".node{animation:nodeIn .45s ease both}.node:nth-of-type(2){animation-delay:.05s}.node:nth-of-type(3){animation-delay:.1s}"
        ".node:nth-of-type(4){animation-delay:.15s}.node:nth-of-type(5){animation-delay:.2s}.connector{stroke-dasharray:520;stroke-dashoffset:520;animation:draw .8s ease forwards}"
        "@keyframes nodeIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}"
        "@keyframes draw{to{stroke-dashoffset:0}}"
        "</style>"
    )
    background = '<rect width="1300" height="760" rx="24" fill="#faf7ff"/>'
    heading = _svg_multiline_text(title, 64, 58, 31, 62, 2, "#30263b", font, weight="700")
    body = ""

    if _is_vector_visual_asset(asset):
        body = _vector_visual_svg_body(title, description, data, font)
    elif asset_type == "graph":
        points = [(float(item["x"]), float(item["y"])) for item in data]
        xs, ys = [point[0] for point in points], [point[1] for point in points]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        x_span = x_max - x_min or 1
        y_span = y_max - y_min or 1
        plotted = [
            (150 + ((x - x_min) / x_span) * 1000, 585 - ((y - y_min) / y_span) * 430)
            for x, y in points
        ]
        polyline = " ".join(f"{x:.1f},{y:.1f}" for x, y in plotted)
        dots = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="#7c3aed"/>' for x, y in plotted)
        body = (
            '<rect x="110" y="125" width="1080" height="515" rx="18" fill="#ffffff" stroke="#d8cdeb"/>'
            '<line x1="150" y1="585" x2="1150" y2="585" stroke="#65566f" stroke-width="3"/>'
            '<line x1="150" y1="155" x2="150" y2="585" stroke="#65566f" stroke-width="3"/>'
            '<path d="M1150 585 L1138 578 L1138 592 Z" fill="#65566f"/>'
            '<path d="M150 155 L142 167 L158 167 Z" fill="#65566f"/>'
            f'<polyline points="{polyline}" fill="none" stroke="#7c3aed" stroke-width="4"/>{dots}'
            f'<text x="150" y="625" font-family="{font}" font-size="17" fill="#65566f">x: {x_min:g} to {x_max:g}</text>'
            f'<text x="925" y="625" font-family="{font}" font-size="17" fill="#65566f">y: {y_min:g} to {y_max:g}</text>'
        )
    elif asset_type in {"flowchart", "process", "timeline"}:
        labels = [str(item) for item in data[:6]]
        columns = min(3, max(len(labels), 1))
        box_width = 330
        box_height = 160
        x_gap = 72
        y_gap = 86
        start_y = 175
        marker = (
            '<defs><marker id="arrow" markerWidth="14" markerHeight="14" refX="12" refY="5" orient="auto">'
            '<path d="M0,0 L0,10 L13,5 z" fill="#7c3aed"/></marker></defs>'
        )
        boxes = []
        centers = []
        full_row_start_x = (width - ((columns * box_width) + ((columns - 1) * x_gap))) / 2
        for index, label in enumerate(labels):
            row = index // columns
            sequence_col = index % columns
            display_col = sequence_col if row % 2 == 0 else columns - 1 - sequence_col
            x = full_row_start_x + display_col * (box_width + x_gap)
            y = start_y + row * (box_height + y_gap)
            centers.append((x + box_width / 2, y + box_height / 2, x, y))
            boxes.append(f'<g class="node"><rect x="{x:.1f}" y="{y:.1f}" width="{box_width}" height="{box_height}" rx="18" fill="#ede9fe" stroke="#7c3aed" stroke-width="2.5"/>')
            boxes.append(
                _svg_multiline_text(
                    str(label),
                    x + box_width / 2,
                    y + 52,
                    24,
                    28,
                    3,
                    "#30263b",
                    font,
                    anchor="middle",
                    weight="700",
                )
            )
            boxes.append("</g>")
        arrows = []
        for index in range(len(centers) - 1):
            current_cx, current_cy, current_x, current_y = centers[index]
            next_cx, next_cy, next_x, next_y = centers[index + 1]
            same_row = index // columns == (index + 1) // columns
            if same_row:
                if next_x > current_x:
                    start = (current_x + box_width + 18, current_cy)
                    end = (next_x - 18, next_cy)
                else:
                    start = (current_x - 18, current_cy)
                    end = (next_x + box_width + 18, next_cy)
                arrows.append(f'<line class="connector" x1="{start[0]:.1f}" y1="{start[1]:.1f}" x2="{end[0]:.1f}" y2="{end[1]:.1f}" stroke="#7c3aed" stroke-width="4" marker-end="url(#arrow)"/>')
            elif abs(current_cx - next_cx) < 1:
                start = (current_cx, current_y + box_height + 18)
                end = (next_cx, next_y - 18)
                arrows.append(f'<line class="connector" x1="{start[0]:.1f}" y1="{start[1]:.1f}" x2="{end[0]:.1f}" y2="{end[1]:.1f}" stroke="#7c3aed" stroke-width="4" marker-end="url(#arrow)"/>')
            else:
                start_y_arrow = current_y + box_height + 18
                end_y_arrow = next_y - 18
                mid_y = (start_y_arrow + end_y_arrow) / 2
                path = f"M{current_cx:.1f},{start_y_arrow:.1f} L{current_cx:.1f},{mid_y:.1f} L{next_cx:.1f},{mid_y:.1f} L{next_cx:.1f},{end_y_arrow:.1f}"
                arrows.append(f'<path class="connector" d="{path}" fill="none" stroke="#7c3aed" stroke-width="4" marker-end="url(#arrow)"/>')
        body = marker + "".join(arrows) + "".join(boxes)
    else:
        labels = [str(item) for item in data[:6]]
        center_label = labels[0] if labels else title
        child_labels = labels[1:] or labels[:1]
        child_width = 300
        child_height = 126
        child_y = 430
        nodes = [
            '<g class="node"><rect x="455" y="170" width="390" height="128" rx="22" fill="#ffffff" stroke="#7c3aed" stroke-width="3"/>',
            _svg_multiline_text(center_label, 650, 214, 21, 26, 3, "#30263b", font, anchor="middle", weight="700"),
            "</g>",
        ]
        connectors = []
        for index, label in enumerate(child_labels[:4]):
            row = index // 2
            col = index % 2
            x = 270 + col * 460
            y = child_y + row * 155
            connector_path = f"M650,298 L650,352 L{x + child_width / 2:.1f},352 L{x + child_width / 2:.1f},{y - 18:.1f}"
            connectors.append(f'<path class="connector" d="{connector_path}" fill="none" stroke="#a78bfa" stroke-width="3.5"/>')
            nodes.append(f'<g class="node"><rect x="{x}" y="{y}" width="{child_width}" height="{child_height}" rx="18" fill="#ede9fe" stroke="#7c3aed" stroke-width="2.5"/>')
            nodes.append(
                _svg_multiline_text(
                    label,
                    x + child_width / 2,
                    y + 38,
                    18,
                    24,
                    4,
                    "#30263b",
                    font,
                    anchor="middle",
                    weight="700",
                )
            )
            nodes.append("</g>")
        body = "".join(connectors) + "".join(nodes)

    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">{animation}{background}{heading}{body}</svg>'
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def _is_vector_visual_asset(asset: Dict[str, Any]) -> bool:
    text = " ".join(str(asset.get(key, "")) for key in ("title", "description", "type"))
    text += " " + " ".join(str(item) for item in asset.get("data", []) if isinstance(asset.get("data"), list))
    return bool(re.search(r"\b(vector|component|magnitude|hypotenuse|origin|coordinate|direction)\b", text, re.I))


def _vector_visual_svg_body(title: str, description: str, data: list[Any], font: str) -> str:
    text = f"{title} {description} {' '.join(str(item) for item in data)}"
    pairs = [(float(x), float(y)) for x, y in re.findall(r"\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)", text)]
    pairs.extend(
        (float(item["x"]), float(item["y"]))
        for item in data
        if isinstance(item, dict) and _is_number_like(item.get("x")) and _is_number_like(item.get("y"))
    )
    arrows = [
        (label.upper(), (float(sx), float(sy)), (float(ex), float(ey)))
        for label, sx, sy, ex, ey in re.findall(
            r"\b(?:arrow|vector)\s+([a-z])\b.{0,80}?\bfrom\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)\s*\bto\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)",
            text,
            re.I,
        )
    ]
    if not arrows:
        arrows = [
            (chr(65 + index), (float(sx), float(sy)), (float(ex), float(ey)))
            for index, (sx, sy, ex, ey) in enumerate(
                re.findall(
                    r"\bstarts?\s+at\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)\s*(?:,|\band\b)?\s*ends?\s+at\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)",
                    text,
                    re.I,
                )
            )
        ]
    if not arrows and re.search(r"\bequal vectors?\b", text, re.I) and len(pairs) >= 4:
        arrows = [("A", pairs[0], pairs[1]), ("B", pairs[2], pairs[3])]
    arrows = [arrow for arrow in arrows if arrow[1] != arrow[2]]
    if arrows:
        points = [(0.0, 0.0)] + [point for _, start, end in arrows for point in (start, end)]
        bounds = max(5, int(max(max(abs(x), abs(y)) for x, y in points)) + 1)
        left, right, top, bottom = 120, 1160, 140, 610
        plot_width, plot_height = right - left, bottom - top

        def px(value: float) -> float:
            return left + ((value + bounds) / (bounds * 2)) * plot_width

        def py(value: float) -> float:
            return bottom - ((value + bounds) / (bounds * 2)) * plot_height

        def fmt(value: float) -> str:
            return f"{value:g}"

        origin_x, origin_y = px(0), py(0)
        grid = []
        for value in range(-bounds, bounds + 1):
            grid.append(f'<line x1="{px(value):.1f}" y1="{top}" x2="{px(value):.1f}" y2="{bottom}" stroke="#e5ddf3" stroke-width="1"/>')
            grid.append(f'<line x1="{left}" y1="{py(value):.1f}" x2="{right}" y2="{py(value):.1f}" stroke="#e5ddf3" stroke-width="1"/>')
        colors = ["#7c3aed", "#0f766e", "#2563eb", "#c2410c"]
        markers = [
            f'<marker id="vectorArrow{index}" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">'
            f'<path d="M1,1.5 L9,5 L1,8.5 Z" fill="{color}"/></marker>'
            for index, color in enumerate(colors)
        ]
        arrow_lines = []
        for index, (label, start, end) in enumerate(arrows):
            color = colors[index % len(colors)]
            sx, sy = px(start[0]), py(start[1])
            ex, ey = px(end[0]), py(end[1])
            arrow_lines.append(
                f'<line x1="{sx:.1f}" y1="{sy:.1f}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="{color}" stroke-width="6" marker-end="url(#vectorArrow{index % len(colors)})"/>'
                f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="6" fill="#30263b"/>'
                f'<circle cx="{ex:.1f}" cy="{ey:.1f}" r="4" fill="{color}"/>'
                f'<text x="{(sx + ex) / 2 + 12:.1f}" y="{(sy + ey) / 2 - 16:.1f}" font-family="{font}" font-size="24" font-weight="800" fill="{color}">Arrow {label}</text>'
                f'<text x="{ex + 16:.1f}" y="{ey - 14:.1f}" font-family="{font}" font-size="22" font-weight="800" fill="{color}">({fmt(end[0])},{fmt(end[1])})</text>'
                f'<text x="{sx + 12:.1f}" y="{sy + 30:.1f}" font-family="{font}" font-size="18" font-weight="700" fill="#30263b">({fmt(start[0])},{fmt(start[1])})</text>'
            )
        return (
            '<defs>'
            + "".join(markers) +
            '<marker id="axisArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">'
            '<path d="M1,2 L7,4 L1,6 Z" fill="#65566f"/></marker></defs>'
            '<rect x="90" y="115" width="1120" height="560" rx="20" fill="#ffffff" stroke="#d8cdeb"/>'
            + "".join(grid) +
            f'<line x1="{left}" y1="{origin_y:.1f}" x2="{right + 28}" y2="{origin_y:.1f}" stroke="#65566f" stroke-width="3" marker-end="url(#axisArrow)"/>'
            f'<line x1="{origin_x:.1f}" y1="{bottom}" x2="{origin_x:.1f}" y2="{top - 28}" stroke="#65566f" stroke-width="3" marker-end="url(#axisArrow)"/>'
            + "".join(arrow_lines) +
            f'<text x="{right + 36}" y="{origin_y + 6:.1f}" font-family="{font}" font-size="22" font-weight="700" fill="#65566f">x</text>'
            f'<text x="{origin_x - 8:.1f}" y="{top - 38}" font-family="{font}" font-size="22" font-weight="700" fill="#65566f">y</text>'
        )
    x, y = max(pairs, key=lambda point: point[0] * point[0] + point[1] * point[1], default=(3.0, 4.0))
    if x == 0 and y == 0:
        x, y = 3.0, 4.0
    bounds = max(5, int(max(abs(x), abs(y))) + 1)
    left, right, top, bottom = 120, 1160, 140, 610
    plot_width, plot_height = right - left, bottom - top

    def px(value: float) -> float:
        return left + ((value + bounds) / (bounds * 2)) * plot_width

    def py(value: float) -> float:
        return bottom - ((value + bounds) / (bounds * 2)) * plot_height

    def fmt(value: float) -> str:
        return f"{value:g}"

    origin_x, origin_y = px(0), py(0)
    end_x, end_y = px(x), py(y)
    grid = []
    for value in range(-bounds, bounds + 1):
        grid.append(f'<line x1="{px(value):.1f}" y1="{top}" x2="{px(value):.1f}" y2="{bottom}" stroke="#e5ddf3" stroke-width="1"/>')
        grid.append(f'<line x1="{left}" y1="{py(value):.1f}" x2="{right}" y2="{py(value):.1f}" stroke="#e5ddf3" stroke-width="1"/>')
    return (
        '<defs><marker id="vectorArrow" markerWidth="13" markerHeight="13" refX="12" refY="6.5" orient="auto" markerUnits="userSpaceOnUse">'
        '<path d="M1,1.5 L12,6.5 L1,11.5 Z" fill="#7c3aed"/></marker>'
        '<marker id="axisArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">'
        '<path d="M1,2 L7,4 L1,6 Z" fill="#65566f"/></marker></defs>'
        '<rect x="90" y="115" width="1120" height="560" rx="20" fill="#ffffff" stroke="#d8cdeb"/>'
        + "".join(grid) +
        f'<line x1="{left}" y1="{origin_y:.1f}" x2="{right + 28}" y2="{origin_y:.1f}" stroke="#65566f" stroke-width="3" marker-end="url(#axisArrow)"/>'
        f'<line x1="{origin_x:.1f}" y1="{bottom}" x2="{origin_x:.1f}" y2="{top - 28}" stroke="#65566f" stroke-width="3" marker-end="url(#axisArrow)"/>'
        f'<line x1="{origin_x:.1f}" y1="{origin_y:.1f}" x2="{end_x:.1f}" y2="{origin_y:.1f}" stroke="#14b8a6" stroke-width="5" marker-end="url(#vectorArrow)"/>'
        f'<line x1="{end_x:.1f}" y1="{origin_y:.1f}" x2="{end_x:.1f}" y2="{end_y:.1f}" stroke="#f97316" stroke-width="5" marker-end="url(#vectorArrow)"/>'
        f'<line x1="{origin_x:.1f}" y1="{origin_y:.1f}" x2="{end_x:.1f}" y2="{end_y:.1f}" stroke="#7c3aed" stroke-width="6" marker-end="url(#vectorArrow)"/>'
        f'<line x1="{end_x:.1f}" y1="{origin_y:.1f}" x2="{end_x:.1f}" y2="{end_y:.1f}" stroke="#7c3aed" stroke-width="2.5" stroke-dasharray="8 8" opacity="0.55"/>'
        f'<line x1="{origin_x:.1f}" y1="{end_y:.1f}" x2="{end_x:.1f}" y2="{end_y:.1f}" stroke="#7c3aed" stroke-width="2.5" stroke-dasharray="8 8" opacity="0.55"/>'
        f'<circle cx="{origin_x:.1f}" cy="{origin_y:.1f}" r="7" fill="#30263b"/>'
        f'<circle cx="{end_x:.1f}" cy="{end_y:.1f}" r="4" fill="#7c3aed"/>'
        f'<text x="{origin_x + 12:.1f}" y="{origin_y + 32:.1f}" font-family="{font}" font-size="20" font-weight="700" fill="#30263b">(0,0)</text>'
        f'<text x="{(origin_x + end_x) / 2 - 38:.1f}" y="{origin_y + 38:.1f}" font-family="{font}" font-size="22" font-weight="700" fill="#0f766e">x = {fmt(x)}</text>'
        f'<text x="{end_x + 16:.1f}" y="{(origin_y + end_y) / 2:.1f}" font-family="{font}" font-size="22" font-weight="700" fill="#c2410c">y = {fmt(y)}</text>'
        f'<text x="{end_x + 16:.1f}" y="{end_y - 16:.1f}" font-family="{font}" font-size="23" font-weight="800" fill="#7c3aed">({fmt(x)},{fmt(y)})</text>'
        f'<text x="{(origin_x + end_x) / 2 + 12:.1f}" y="{(origin_y + end_y) / 2 - 20:.1f}" font-family="{font}" font-size="24" font-weight="800" fill="#5b21b6">vector v</text>'
    )


def _is_number_like(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    try:
        float(value)
    except (TypeError, ValueError):
        return False
    return True


def _svg_multiline_text(
    text: str,
    x: float,
    y: float,
    font_size: int,
    max_chars: int,
    max_lines: int,
    fill: str,
    font_family: str,
    anchor: str = "start",
    weight: str = "400",
) -> str:
    words = re.sub(r"\s+", " ", text).strip().split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= max_chars or not current:
            current = candidate
            continue
        if len(lines) >= max_lines - 1:
            break
        lines.append(current)
        current = word
    if current and len(lines) < max_lines:
        lines.append(current)
    lines = lines[:max_lines]
    tspans = []
    for index, line in enumerate(lines):
        dy = 0 if index == 0 else font_size + 5
        tspans.append(f'<tspan x="{x:.1f}" dy="{dy}">{escape(line)}</tspan>')
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" font-family="{font_family}" '
        f'font-size="{font_size}" font-weight="{weight}" fill="{fill}">{"".join(tspans)}</text>'
    )


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


_BAD_VISUAL_LABELS = {
    "label",
    "node",
    "step",
    "concept",
    "topic",
    "text",
    "placeholder",
    "lorem ipsum",
    "todo",
    "n/a",
}

_VISUAL_DESCRIPTION_PHRASES = (
    "a diagram showing",
    "a flowchart showing",
    "a concept map showing",
    "an illustration showing",
    "the diagram shows",
    "the diagram highlights",
    "the flowchart shows",
    "the visual shows",
    "showing the",
    "illustrating the",
)


def _validate_visual_text(value: Any, field: str, asset_index: int, max_words: int) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "")).strip()
    lower = normalized.lower()
    if not normalized:
        raise ValueError(f"visualAssets[{asset_index}] {field} is required")
    if lower in _BAD_VISUAL_LABELS or any(token in lower for token in ("[topic]", "[concept]", "insert ", "placeholder")):
        raise ValueError(f"visualAssets[{asset_index}] {field} contains placeholder text")
    if not re.search(r"[A-Za-z0-9]", normalized):
        raise ValueError(f"visualAssets[{asset_index}] {field} must contain readable text")
    if re.search(r"[{}<>|`~]{2,}", normalized):
        raise ValueError(f"visualAssets[{asset_index}] {field} contains malformed text")
    if len(normalized.split()) > max_words:
        normalized = _compact_visual_text(normalized, max_words)
    return normalized


def _compact_visual_text(value: str, max_words: int) -> str:
    # ponytail: word-cap captions; upgrade to semantic summarization if visual captions need nuance.
    words = value.split()
    if len(words) <= max_words:
        return value
    return " ".join(words[:max_words]).rstrip(".,;:") + "."


def _validate_visual_label(label: str, asset_index: int, label_index: int) -> str:
    normalized = re.sub(r"\s+", " ", label).strip()
    lower = normalized.lower()
    if not normalized:
        raise ValueError(f"visualAssets[{asset_index}].data[{label_index}] is empty")
    if lower in _BAD_VISUAL_LABELS or any(token in lower for token in ("[topic]", "[concept]", "insert ", "placeholder")):
        raise ValueError(f"visualAssets[{asset_index}].data[{label_index}] contains placeholder text")
    if any(phrase in lower for phrase in _VISUAL_DESCRIPTION_PHRASES):
        raise ValueError(f"visualAssets[{asset_index}].data[{label_index}] must be a node label, not a visual description")
    if not re.search(r"[A-Za-z0-9]", normalized):
        raise ValueError(f"visualAssets[{asset_index}].data[{label_index}] must contain readable text")
    if re.search(r"[{}<>|`~]{2,}", normalized):
        raise ValueError(f"visualAssets[{asset_index}].data[{label_index}] contains malformed text")
    if len(normalized) > 42 or len(normalized.split()) > 6:
        # ponytail: simple node-label cap; upgrade to semantic summarization if labels need full clauses.
        normalized = _compact_visual_label(normalized, f"Node {label_index + 1}")
    return normalized


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
        elif asset_type != "graph":
            data = [_validate_visual_label(item, index, point_index) for point_index, item in enumerate(data)]
        asset = {
            "id": f"visual-{index + 1}",
            "title": _validate_visual_text(raw["title"], "title", index, 10),
            "description": _validate_visual_text(raw["description"], "description", index, 28),
            "type": asset_type,
            "data": data,
        }
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
    roadmap_topic = constraints.get("roadmap_topic") or req.topic
    return (
        f"Create a complete learner-facing lesson for learner {req.learner_id}.\n"
        f"Learning goal: {learner_profile.get('learning_goal')}\n"
        f"Selected lesson title: {lesson_title}\n"
        f"Selected lesson description: {selected_lesson.get('description')}\n"
        f"Selected lesson objectives: {json.dumps(lesson_objectives)}\n"
        f"Roadmap topic for background only: {roadmap_topic}\n"
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
        f"Education level constraint: {constraints.get('education_level') or learner_profile.get('education_level')}; "
        "match vocabulary, abstraction, notation, and examples to this level.\n"
        f"Familiarity constraint: {constraints.get('familiarity_level') or learner_profile.get('topic_familiarity') or learner_state.knowledge_level}; "
        "Beginner lessons must teach foundations slowly, Intermediate lessons must move faster through basics and add applications, "
        "and Advanced lessons must include formal reasoning, edge cases, and more challenging practice.\n"
        f"Pace constraint: {constraints.get('pace') or learner_profile.get('pace_preference') or learner_state.pace_preference}; "
        "Gentle and Thorough must use smaller steps and more scaffolding, Balanced must use moderate step sizes, and Fast and Challenging "
        "must use denser explanations and harder checkpoints.\n"
        f"Availability constraint: {constraints.get('availability') or learner_profile.get('learning_availability')}; "
        "fit the amount of content and practice to this study window.\n\n"
        "Use the selected roadmap stage as the lesson's sole curricular scope. The selected lesson title is the "
        "canonical topic for every explanation, example, assessment, diagram, flowchart, narration, and media asset. "
        "Use the broader roadmap topic only as background context; never substitute it for the selected lesson.\n\n"
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
        "Each visual label must be educationally correct, readable, 1 to 6 words, and specific to the selected lesson. "
        "Data labels must be node names only, not sentences or descriptions. Never start a label with phrases like "
        "'A diagram showing', 'A flowchart showing', 'The diagram shows', or 'The diagram highlights'. "
        "For flowcharts, labels must form the correct learning sequence and arrows will be rendered in array order. "
        "For diagrams, include named objects from the selected lesson. For vector lessons, prefer graph assets or "
        "coordinate diagrams with endpoints such as (3,4), component arrows, and magnitude labels; do not use "
        "flowcharts for vector components unless the selected lesson is explicitly procedural. Vector lessons may "
        "name Vector A, Vector B, Resultant Vector, Triangle Rule, Parallelogram Rule, or Component Addition; eigenvalue lessons should "
        "name Matrix A, Eigenvector, Eigenvalue, Transformation, or Scaling Direction; derivative lessons should name "
        "Curve, Tangent Line, Instantaneous Rate of Change, or Slope Interpretation. "
        "For mathematical topics, include at least one graph asset with numeric points and one lesson-specific diagram "
        "or process asset. "
        "For every Visual lesson, return at least three distinct visualAssets with different types whenever possible: "
        "one flowchart or process map showing the learning sequence, one diagram or concept_map naming lesson-specific "
        "objects/relationships, and one graph for math topics or one infographic/timeline/process visual for non-math topics. "
        "Do not repeat the same visual type unless the lesson absolutely requires it. "
        "Never use placeholder labels, generic labels, random text, malformed text, or labels unrelated to the selected lesson. "
        "Do not generate imageUrl; the verified renderer creates it after validation.\n"
        "Return exactly 4 coreConcepts, 4 examples, 4 practiceQuestions, 2 learningObjectives, 2 reflectionQuestions, "
        "2 keyTakeaways, and 2 nextSteps. visualAssets must be populated for Visual lessons and empty for Audio or "
        "Detailed Written lessons. audioScript must be populated for Audio lessons and empty for Visual or Detailed "
        "Written lessons. guidedActivities must be an empty array because only Visual, Audio, and Detailed Written "
        "lesson styles are supported. Respect these word limits: title 12 words; overview 70 to 110 words; each learning objective "
        "at most 22 words; each core concept 90 to 140 words; explanation 220 to 340 words (320 to 480 for Reading/Writing; "
        "320 to 480 for Detailed Written); each example 80 to 130 words; each practice question 45 to 90 words; each reflection question "
        "at most 30 words; each key takeaway 20 to 35 words; each next step 20 to 35 words. For Visual return "
        "3 to 4 visualAssets with distinct purposes. For Audio return an audioScript of 280 to 420 words with "
        "one spoken segment for each of the 4 coreConcepts, in the same order, so every concept in the lesson has "
        "audio coverage. "
        "For Detailed Written, make explanation and coreConcepts the primary teaching mechanism. "
        "Keep the entire response under "
        "3,200 words. Use one paragraph per string, with no decorative headings or repeated explanations.\n\n"
        "Teaching quality requirements:\n"
        "- Act as an expert adaptive educator.\n"
        "- Generate the lesson using the teaching methodology most effective for the specified learning style. "
        "Do not simply change wording. Change the structure, content, activities, and presentation of the lesson "
        "according to the learning style.\n"
        "- Generate the lesson using teaching strategies specifically optimized for the learner's learning style. "
        "The lesson structure, examples, explanations, activities, and practice questions must reflect that learning "
        "style throughout the lesson.\n"
        f"- Learning-style teaching contract: {_lesson_style_contract(learning_style)}\n"
        f"- Accessibility contract: {_accessibility_contract(constraints)}\n"
        f"- Symbolic modality contract: {_symbolic_math_contract(lesson_title, constraints)}\n"
        "- The lesson must be directly studyable by a person. It should explain, demonstrate, coach practice, "
        "and check understanding without relying on a human teacher to fill gaps.\n"
        "- Use a concrete throughline example that fits the topic. Reuse it across sections, then add a fresh "
        "practice case near the end.\n"
        "- Start from intuition and vocabulary, then move to procedure, then interpretation, then independent practice.\n"
        "- Ground every generated artifact in the selected lesson title, description, and objectives.\n"
        "- Visual labels must use correct terminology from the selected lesson, with short node titles that can fit in a diagram.\n"
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


def _model_stopped_for_length(response: Dict[str, Any]) -> bool:
    raw = response.get("raw") or {}
    choice = (response.get("choices") or [{}])[0]
    stop_reason = raw.get("stop_reason") or raw.get("finish_reason") or choice.get("finish_reason")
    return str(stop_reason or "").lower() in {"max_tokens", "length"}


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
        if isinstance(concept, str) and len(concept.strip()) < 180:
            errors.append(f"coreConcepts[{index}] must contain a complete explanation")
    for index, example in enumerate(payload.get("examples") or []):
        if isinstance(example, str) and len(example.strip()) < 120:
            errors.append(f"examples[{index}] must contain a complete worked example")
    for index, practice in enumerate(payload.get("practiceQuestions") or []):
        if isinstance(practice, str) and len(practice.strip()) < 60:
            errors.append(f"practiceQuestions[{index}] must be an answerable activity")
    if errors:
        raise ValueError("; ".join(errors))


def _is_mathematical_topic(topic: str) -> bool:
    math_terms = (
        "math", "algebra", "calculus", "geometry", "trigonometry", "statistics", "probability",
        "derivative", "integral", "limit", "function", "graph", "slope", "vector", "matrix",
        "eigenvalue", "eigenvector", "linear transformation", "coordinate", "equation",
    )
    topic_lower = topic.lower()
    return any(term in topic_lower for term in math_terms)


def _compact_visual_label(value: Any, fallback: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        text = fallback
    text = re.split(r"(?<=[.!?])\s+", text)[0]
    words = text.split()[:6]
    return " ".join(words)[:42].strip() or fallback


def _lesson_visual_terms(lesson_title: str, lesson_objectives: list[Any], concepts: list[str]) -> list[str]:
    terms: list[str] = []
    terms.append(_compact_visual_label(lesson_title, "Lesson focus"))
    for objective in lesson_objectives:
        terms.append(_compact_visual_label(objective, "Learning goal"))
    for concept in concepts:
        terms.append(_compact_visual_label(concept, "Key concept"))
    deduped = []
    seen = set()
    for term in terms:
        key = term.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(term)
    return (deduped + ["Core idea", "Worked example", "Learner check"])[:6]


def _fallback_graph_points(lesson_title: str) -> list[Dict[str, int | float]]:
    title = lesson_title.lower()
    if "derivative" in title or "slope" in title or "tangent" in title:
        return [{"x": x, "y": x * x} for x in range(-3, 4)]
    if "vector" in title:
        return [{"x": 0, "y": 0}, {"x": 2, "y": 1}, {"x": 4, "y": 3}, {"x": 5, "y": 4}]
    if "eigen" in title or "matrix" in title or "transformation" in title:
        return [{"x": -2, "y": -1}, {"x": -1, "y": -0.5}, {"x": 0, "y": 0}, {"x": 1, "y": 0.5}, {"x": 2, "y": 1}]
    if "function" in title or "graph" in title or "equation" in title:
        return [{"x": x, "y": (x * x) - 2} for x in range(-3, 4)]
    return [{"x": 0, "y": 0}, {"x": 1, "y": 1}, {"x": 2, "y": 3}, {"x": 3, "y": 6}, {"x": 4, "y": 10}]


def _ensure_visual_asset_mix(
    assets: list[Dict[str, Any]],
    lesson_title: str,
    lesson_objectives: list[Any],
    concepts: list[str],
) -> list[Dict[str, Any]]:
    terms = _lesson_visual_terms(lesson_title, lesson_objectives, concepts)
    short_title = _compact_visual_label(lesson_title, "Lesson")
    existing_types = {str(asset.get("type") or "").lower() for asset in assets}
    additions: list[Dict[str, Any]] = []

    if not existing_types.intersection({"flowchart", "process"}):
        additions.append(
            {
                "title": f"{short_title} flow",
                "description": f"Shows the ordered reasoning path for {lesson_title}.",
                "type": "flowchart",
                "data": terms[:5],
            }
        )

    if not existing_types.intersection({"diagram", "concept_map", "illustration"}):
        additions.append(
            {
                "title": f"{short_title} diagram",
                "description": f"Names the key objects and relationships in {lesson_title}.",
                "type": "diagram",
                "data": terms[:6],
            }
        )

    if _is_mathematical_topic(lesson_title):
        if "graph" not in existing_types:
            additions.append(
                {
                    "title": f"{short_title} graph",
                    "description": f"Plots a representative mathematical relationship for {lesson_title}.",
                    "type": "graph",
                    "data": _fallback_graph_points(lesson_title),
                }
            )
    elif not existing_types.intersection({"timeline", "process", "concept_map"}):
        additions.append(
            {
                "title": f"{short_title} map",
                "description": f"Summarizes the main ideas from the selected lesson.",
                "type": "concept_map",
                "data": terms[:5],
            }
        )

    prepared_additions = _prepare_visual_assets(additions) if additions else []
    if prepared_additions:
        repaired = [*assets[: max(0, 4 - len(prepared_additions))], *prepared_additions]
    else:
        repaired = [*assets]

    unique: list[Dict[str, Any]] = []
    seen_titles = set()
    for asset in repaired:
        key = (str(asset.get("type")), str(asset.get("title")).lower())
        if key in seen_titles:
            continue
        seen_titles.add(key)
        unique.append(asset)
    return unique[:4]


def _validate_lesson_style(payload: Dict[str, Any], learning_style: str, topic: str) -> None:
    style_key = _lesson_style_key(learning_style)
    declared_raw = str(payload["learningStyle"]).lower()
    if any(term in declared_raw for term in ("balanced", "mixed", "practice first", "kinesthetic", "hands-on")):
        raise ValueError("learningStyle must be Visual Examples and Diagrams, Audio Learning, or Detailed Written Explanations")
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
    }
    labels = {
        "visual": ("visualAssets", "explanations/examples", "practiceQuestions"),
        "auditory": ("audioScript", "explanations/examples", "practiceQuestions"),
        "reading_writing": ("detailed written content", "explanations/examples", "practiceQuestions"),
    }[style_key]
    missing = [label for label, (content, terms) in zip(labels, evidence[style_key]) if not any(term in content for term in terms)]
    if missing:
        logger.warning("%s methodology keywords are not explicit in: %s", learning_style, missing)
    if style_key == "visual":
        if not payload["visualAssets"]:
            raise ValueError("visual lesson must populate visualAssets")
        topic_lower = topic.lower()
        asset_types = {asset["type"] for asset in visual_assets}
        if _is_mathematical_topic(topic) and ("graph" not in asset_types or not (asset_types - {"graph"})):
            raise ValueError("visual mathematical lesson requires both graphData and a lesson-specific diagram/process visual")
        domain_rules = {
            "mathematics": (("math", "calculus", "algebra", "geometry", "statistics", "derivative", "function", "vector", "matrix", "eigenvalue"), ("graph", "plot", "vector", "matrix", "curve", "slope", "transformation")),
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
        if len(payload["audioScript"].split()) < 120:
            raise ValueError("auditory audioScript must contain at least 120 words of narration")
    elif style_key == "reading_writing":
        if len(payload["explanation"].split()) < 180:
            raise ValueError("reading/writing lesson requires at least 180 words of detailed explanation")


def _audio_sections_from_payload(payload: Dict[str, Any]) -> list[Dict[str, Any]]:
    sections: list[Dict[str, Any]] = []
    title = str(payload["title"]).strip()
    concepts = payload.get("coreConcepts") or []
    examples = payload.get("examples") or []
    practice_questions = payload.get("practiceQuestions") or []
    takeaways = payload.get("keyTakeaways") or []
    reflections = payload.get("reflectionQuestions") or []

    for index, concept in enumerate(concepts):
        example = examples[index] if index < len(examples) else ""
        practice = practice_questions[index] if index < len(practice_questions) else ""
        takeaway = takeaways[index % len(takeaways)] if takeaways else ""
        script_parts = [
            f"Concept {index + 1}: {concept}",
            f"Here is the spoken example: {example}" if example else "",
            f"Listen for this key idea: {takeaway}" if takeaway else "",
            f"Now say this back in your own words: {practice}" if practice else "",
        ]
        if index == len(concepts) - 1 and reflections:
            script_parts.append("To close, discuss this: " + " ".join(reflections))
        sections.append(
            {
                "title": f"{title} - concept {index + 1}",
                "script": " ".join(part for part in script_parts if part).strip(),
                "discussion_prompts": reflections if index == len(concepts) - 1 else [],
            }
        )
    return sections


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
    if style_key == "visual":
        visual_assets = _ensure_visual_asset_mix(
            _prepare_visual_assets(payload["visualAssets"]),
            str(selected_lesson.get("title") or req.topic),
            selected_lesson.get("objectives") or [],
            payload["coreConcepts"],
        )
        lesson_scope = {
            "lessonTitle": str(selected_lesson.get("title") or req.topic),
            "lessonObjectives": selected_lesson.get("objectives") or [],
            "lessonDescription": selected_lesson.get("description") or "",
        }
        for asset in visual_assets:
            title = str(asset.get("title") or "").strip()
            lesson_title = lesson_scope["lessonTitle"]
            if lesson_title.lower() not in title.lower():
                asset["title"] = f"{lesson_title}: {title}"
            asset["lessonScope"] = lesson_scope
            asset["caption"] = f"{asset['description']} Grounded in: {lesson_scope['lessonTitle']}."
            asset["imageUrl"] = _visual_asset_image_url(asset)
        blueprint.visualElements = visual_assets
        blueprint.diagramDescriptions = [asset for asset in visual_assets if asset["type"] != "graph"]
        blueprint.graphData = [asset for asset in visual_assets if asset["type"] == "graph"]
        flow_source = next((asset for asset in visual_assets if asset["type"] in {"flowchart", "process", "timeline"}), None)
        if flow_source:
            flow_steps = flow_source["data"]
            flow_title = flow_source["title"]
        else:
            flow_steps = [objective.split(".")[0][:64] for objective in payload["learningObjectives"]]
            flow_steps.extend(takeaway.split(".")[0][:64] for takeaway in payload["keyTakeaways"])
            flow_title = f"{payload['title']} learning flow"
        blueprint.flowDiagrams = [
            {
                "id": f"flow-{blueprint.lesson_id}",
                "title": flow_title,
                "steps": flow_steps[:6],
            }
        ]
    if style_key == "auditory":
        blueprint.audioSections = _audio_sections_from_payload(payload)
        section_scripts = [str(section.get("script") or "").strip() for section in blueprint.audioSections if section.get("script")]
        concept_narration = "\n\n".join(section_scripts)
        full_narration = "\n\n".join(part for part in (payload["audioScript"].strip(), concept_narration) if part)
        blueprint.audioNarration = full_narration
        blueprint.ttsContent = full_narration
    return blueprint


async def lesson_planning_agent(
    req: models.GenerateLessonRequest,
    learner_state: models.LearnerState,
    teaching_strategy: models.TeachingStrategy,
) -> models.LessonBlueprint:
    selected_lesson = req.selected_lesson or {}
    if not selected_lesson:
        raise ValueError("Lesson generation requires a selected AI-generated roadmap stage")
    if not isinstance(selected_lesson, dict):
        raise ValueError("Selected roadmap stage must be an object")
    if "estimated_duration" not in selected_lesson:
        raise ValueError("Selected roadmap stage is missing estimated_duration")
    if not str(selected_lesson.get("title") or "").strip():
        raise ValueError("Selected roadmap stage is missing title")
    if not str(selected_lesson.get("description") or "").strip():
        raise ValueError("Selected roadmap stage is missing description")
    lesson_title = selected_lesson.get("title") or req.topic
    lesson_objectives = selected_lesson.get("objectives") or []
    if not lesson_objectives:
        raise ValueError("Selected roadmap stage is missing objectives")
    learning_style = _lesson_learning_style(req, learner_state, teaching_strategy)
    prompt = _lesson_generation_prompt(
        req, learner_state, teaching_strategy, selected_lesson, lesson_title, lesson_objectives, learning_style
    )
    prompt = (
        f"{prompt}\n\nLearning style is a first-class delivery constraint: {learning_style}.\n"
        "Adapt wording, examples, practice, and pacing to that style while preserving the flat JSON contract. "
        "Do not use em dashes in any generated text; use commas, periods, or short parentheses instead."
    )
    lesson_request_id = f"lesson-request:{uuid4()}"
    base_messages = [
        {
            "role": "system",
            "content": (
                "You are a master teacher and curriculum designer. Return one strictly valid JSON object with "
                "double-quoted keys and strings. Escape quotes, backslashes, and line breaks inside strings. "
                "Do not use Markdown fences or include commentary outside the JSON object. Do not use em dashes."
            ),
        },
        {"role": "user", "content": prompt},
    ]
    messages = list(base_messages)
    logger.info(
        "Lesson generation request: lesson_request_id=%s learner_id=%s topic=%s selected_stage=%s prompt_size=%s max_tokens=%s context=%s",
        lesson_request_id, req.learner_id, req.topic, lesson_title, len(prompt), LESSON_MAX_TOKENS,
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
            resp = await _call_layer("planning", messages, temperature=0.2, max_tokens=LESSON_MAX_TOKENS)
            text = resp["choices"][0]["message"]["content"]
            stop_reason = (resp.get("raw") or {}).get("stop_reason")
            logger.info(
                "Lesson generation response: lesson_request_id=%s attempt=%s stop_reason=%s completion_length=%s response_size=%s max_tokens=%s",
                lesson_request_id, attempt + 1, stop_reason,
                len(text), len(text.encode("utf-8")), LESSON_MAX_TOKENS,
            )
            if _model_stopped_for_length(resp):
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
            _validate_lesson_style(payload, learning_style, lesson_title)
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
                        "the complete JSON under 3,200 words."
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
        f"The roadmap topic is exactly {req.topic}; every lesson must stay within that topic. "
        f"{_roadmap_syllabus_contract(req.topic)} "
        f"Education level is {planning_context['education_level']}; choose vocabulary, abstraction, examples, and "
        "expected math/formality for that level. "
        f"Current familiarity is {planning_context['knowledge_level']}; for Beginner start with intuition and "
        "foundations, for Intermediate compress basics and add worked applications, and for Advanced emphasize edge "
        "cases, formal reasoning, and challenging synthesis. "
        f"Preferred pace is {planning_context['pace']}; Gentle and Thorough should use smaller steps and longer "
        "durations, Balanced should use moderate durations, and Fast and Challenging should use fewer, denser stages "
        "with harder objectives. "
        f"Learning style is {planning_context['learning_style']}; choose roadmap outcomes that naturally support that "
        "delivery style. Availability is "
        f"{planning_context['availability']}; keep estimated_duration realistic for that daily time. "
        "Keep the roadmap compact for square cards: title 4 to 9 words, description one plain sentence of 10 to 18 "
        "words, difficulty 1 to 2 words, and exactly 2 objectives of 5 to 10 words each. Make titles specific but "
        "short; name the exact concept group without listing every subtopic. Descriptions should summarize only the "
        "core outcome, not a full lesson plan. "
        "Do not hardcode a generic plan. Do not use project context, project goals, or applied projects. "
        "Do not use em dashes in any generated text; use commas or periods instead. "
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
            return _canonical_lesson_style(candidate.strip())
    return "Detailed Written Explanations"


def _style_key(learning_style: str) -> str:
    style = learning_style.lower()
    if "visual" in style or "diagram" in style:
        return "visual"
    if "audio" in style or "listen" in style or "narration" in style:
        return "audio"
    if "written" in style or "detailed" in style or "explanation" in style:
        return "written"
    return "written"


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
        "written": {
            "primary_experience": "detailed written explanation",
            "required_optional_fields": [],
            "text_density": "comprehensive paragraphs with step-by-step reasoning",
            "section_pattern": "concept, derivation, worked example, checkpoint",
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


async def source_analysis_agent(
    title: str,
    kind: str,
    source_material: Dict[str, Any],
) -> Dict[str, Any]:
    """Extract a source-grounded teaching brief for Module Leader generation."""
    source_text = str(source_material.get("text") or "").strip()
    warning = str(source_material.get("extraction_warning") or "").strip()
    if not source_text or warning and any(marker in warning.lower() for marker in ("no selectable text", "did not expose selectable text")):
        return {
            "readable": False,
            "source_text": source_text,
            "concepts": [],
            "learning_objectives": [],
            "warnings": [warning or "The upload contains no readable teaching text."],
        }

    prompt = (
        "You are the Source Analysis Agent for a module leader. Analyze only the supplied source. "
        "Do not add facts that are absent from it. Return JSON only with readable (boolean), "
        "source_summary (string), concepts (5 to 12 objects with name, evidence, and importance), "
        "learning_objectives (3 to 6 measurable strings), difficulty (Foundational, Intermediate, or Advanced), "
        "and warnings (list of strings). Evidence must be a short paraphrase or excerpt traceable to the source. "
        f"Draft kind: {kind}. Draft title: {title}. Filename: {source_material.get('filename', '')}. "
        f"Source text:\n{source_text[:30000]}"
    )
    resp = await _call_layer("content", [{"role": "user", "content": prompt}], temperature=0.0, max_tokens=3000)
    payload = _json_from_model_text(resp["choices"][0]["message"]["content"])
    concepts = payload.get("concepts")
    objectives = payload.get("learning_objectives")
    if payload.get("readable") is False or not isinstance(concepts, list) or len(concepts) < 3:
        raise ValueError("Source Analysis Agent did not return enough source-grounded concepts")
    if not isinstance(objectives, list) or len(objectives) < 2:
        raise ValueError("Source Analysis Agent did not return enough learning objectives")
    return {
        **payload,
        "readable": True,
        "source_text": source_text,
        "concepts": concepts[:12],
        "learning_objectives": objectives[:6],
        "warnings": payload.get("warnings") if isinstance(payload.get("warnings"), list) else [],
    }


async def quality_review_agent(
    title: str,
    kind: str,
    source_analysis: Dict[str, Any],
    draft: Dict[str, Any],
    source_material: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Generate and review a publishable Module Leader lesson or assessment."""
    if not source_analysis.get("readable"):
        return draft
    if kind == "assessment":
        contract = (
            "Return 6 to 10 varied questions. Each question needs id, type, bloom_level, question, topic, and answer. "
            "MCQs also need exactly 4 plausible options containing the exact answer and an explanation. "
            "Short-answer questions need a 3-item rubric. Cover multiple source concepts and never ask vague questions "
            "about an 'uploaded document'. Include title, source_locked=true, workflow, fairness, questions, "
            "topic_distribution, estimated_duration, difficulty, and delivery_support for gentle, balanced, and fast "
            "paces plus visual, audio, and reading modalities. Assessment questions and marking must remain identical "
            "for every learner; only presentation guidance may vary."
        )
    else:
        contract = (
            "Return a complete teachable lesson with a meaningful source-derived title, source_locked=true, workflow, "
            "3 to 5 specific learning_objectives, a plain-language summary that tells learners what they will understand, "
            "estimated_duration, difficulty, and 4 to 6 logically ordered sections. Cover prerequisites and key terms, "
            "the problem, the proposed approach, a worked conceptual example, evidence/results, and limitations when "
            "those are present in the source. Every section needs a descriptive title, a clear explanatory summary, "
            "2 to 5 concise subsections, at least one source-grounded example, and at least one check_for_understanding. "
            "Also give every section guided_explanation (slower, scaffolded, terminology unpacked), quick_takeaway "
            "(one concise but complete explanation), and spoken_explanation (natural narration without visual references). "
            "These are alternate presentations of the same facts, not different learning outcomes. Include a flowchart "
            "only when it genuinely explains a source process. Keep the complete JSON below 2,800 words. Use concrete, plain-language explanations and source-grounded examples in a logical "
            "teaching sequence. Do not copy author names, journal headers, affiliations, code links, citation lists, or "
            "raw abstract paragraphs into lesson sections. Do not say 'uploaded source' in objectives. Do not invent a "
            "generic image merely to fill a visual field."
        )
    source_text = _representative_source_excerpt(str((source_material or {}).get("text") or ""))
    analysis_for_prompt = {key: value for key, value in source_analysis.items() if key != "source_text"}
    prompt = (
        "You are the Source-Grounded Lesson and Assessment Agent for a module leader. Analyze the complete source, then "
        "rewrite and quality-check the candidate content for "
        "accuracy, completeness, appropriate difficulty, accessibility, clarity, answer correctness, and source fidelity. "
        "Remove unsupported claims. Return JSON only, containing the corrected final content rather than a review report. "
        f"Required contract: {contract} Title: {title}. Kind: {kind}. "
        f"Source analysis: {json.dumps(analysis_for_prompt, ensure_ascii=False)}. "
        f"Candidate draft: {json.dumps(draft, ensure_ascii=False)}. Full extracted source:\n{source_text}"
    )
    resp = await _call_layer(
        "draft",
        [
            {"role": "system", "content": "You create accurate, highly teachable classroom material. Return one valid JSON object only, without Markdown fences."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        max_tokens=4800,
        max_attempts=1,
        response_schema=_draft_response_schema(kind),
    )
    reviewed = _json_from_model_text(resp["choices"][0]["message"]["content"])
    if kind == "lesson":
        if not isinstance(reviewed.get("sections"), list) or len(reviewed["sections"]) < 4:
            raise ValueError("Quality Review Agent returned an incomplete lesson")
        if not isinstance(reviewed.get("learning_objectives"), list) or len(reviewed["learning_objectives"]) < 2:
            raise ValueError("Quality Review Agent returned a lesson without sufficient objectives")
        for section in reviewed["sections"]:
            if not isinstance(section, dict) or not section.get("title") or not section.get("summary"):
                raise ValueError("Quality Review Agent returned an incomplete lesson section")
            summary = str(section["summary"]).strip()
            section["guided_explanation"] = str(section.get("guided_explanation") or summary).strip()
            section["quick_takeaway"] = str(section.get("quick_takeaway") or summary).strip()
            section["spoken_explanation"] = str(section.get("spoken_explanation") or section["guided_explanation"]).strip()
    else:
        questions = reviewed.get("questions")
        if not isinstance(questions, list) or len(questions) < 5:
            raise ValueError("Quality Review Agent returned an incomplete assessment")
        for question in questions:
            if not isinstance(question, dict) or not question.get("question") or not question.get("answer") or not question.get("topic"):
                raise ValueError("Quality Review Agent returned an invalid assessment question")
            question_type = str(question.get("type") or "").strip().lower().replace("-", "_").replace(" ", "_")
            question["type"] = question_type
            if question_type == "short_answer":
                question.pop("options", None)
            if question_type == "mcq" and (
                not isinstance(question.get("options"), list)
                or len(question["options"]) != 4
                or question["answer"] not in question["options"]
            ):
                raise ValueError("Quality Review Agent returned an invalid MCQ")
    return {
        **reviewed,
        "title": str(reviewed.get("title") or title).strip(),
        "source_locked": True,
        "workflow": "source_grounded_generation_requires_module_leader_approval",
        "agent_workflow": ["Source-Grounded Generation Agent", "Quality Review Contract"],
        "quality_review": {
            "status": "passed",
            "checks": ["accuracy", "completeness", "difficulty", "accessibility", "source_fidelity"],
        },
        "generation": {
            "provider": str(resp.get("provider") or settings.active_provider).lower(),
            "model": str(resp.get("model") or ModelRouter.get_model("draft")),
            "mode": "primary_model",
        },
    }


def _representative_source_excerpt(source_text: str, max_chars: int = 32000) -> str:
    text = str(source_text or "").strip()
    if len(text) <= max_chars:
        return text
    # ponytail: three windows preserve paper setup, method, and findings; replace with retrieval if sources exceed model context routinely.
    start_size = max_chars * 4 // 10
    middle_size = max_chars * 3 // 10
    end_size = max_chars - start_size - middle_size
    middle_start = max(start_size, len(text) // 2 - middle_size // 2)
    return "\n\n[BEGINNING OF SOURCE]\n" + text[:start_size] + "\n\n[MIDDLE OF SOURCE]\n" + text[middle_start:middle_start + middle_size] + "\n\n[END OF SOURCE]\n" + text[-end_size:]


def _draft_response_schema(kind: str) -> Dict[str, Any]:
    if kind == "assessment":
        question = {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "type": {"type": "string"},
                "bloom_level": {"type": "string"},
                "question": {"type": "string"},
                "topic": {"type": "string"},
                "answer": {"type": "string"},
                "options": {"type": "array", "items": {"type": "string"}},
                "explanation": {"type": "string"},
                "rubric": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["id", "type", "bloom_level", "question", "topic", "answer"],
        }
        return {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "fairness": {"type": "string"},
                "estimated_duration": {"type": "integer"},
                "difficulty": {"type": "string"},
                "questions": {"type": "array", "items": question},
                "topic_distribution": {"type": "array", "items": {}},
            },
            "required": ["title", "fairness", "estimated_duration", "difficulty", "questions"],
        }
    section = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "summary": {"type": "string"},
            "guided_explanation": {"type": "string"},
            "quick_takeaway": {"type": "string"},
            "spoken_explanation": {"type": "string"},
            "subsections": {"type": "array", "items": {"type": "string"}},
            "examples": {"type": "array", "items": {"type": "string"}},
            "checks_for_understanding": {"type": "array", "items": {"type": "string"}},
        },
        "required": [
            "title", "summary", "guided_explanation", "quick_takeaway", "spoken_explanation",
            "subsections", "examples", "checks_for_understanding",
        ],
    }
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "summary": {"type": "string"},
            "learning_objectives": {"type": "array", "items": {"type": "string"}},
            "estimated_duration": {"type": "integer"},
            "difficulty": {"type": "string"},
            "sections": {"type": "array", "items": section},
            "flowcharts": {"type": "array", "items": {"type": "object"}},
        },
        "required": ["title", "summary", "learning_objectives", "estimated_duration", "difficulty", "sections"],
    }


async def interactive_agent(req: models.TutorInteractionRequest, session_state: Dict[str, Any]) -> models.TutorInteractionResponse:
    lesson = session_state.get("lesson", {})
    selected_lesson = lesson.get("selected_lesson") or {}
    prompt = (
        "You are the AI tutor inside an active EvolvED lesson. Answer only from the selected lesson context. "
        "If the learner asks something broad, connect it back to this selected lesson instead of drifting to the roadmap topic. "
        "Return a neat learner-facing answer in this exact structure, with no markdown table and no extra preamble:\n"
        "Answer: one clear sentence that directly answers the question.\n"
        "Why it matters: one short sentence grounded in the selected lesson.\n"
        "Steps:\n"
        "1. first concrete step or idea.\n"
        "2. second concrete step or idea.\n"
        "Example: one compact example from the lesson.\n"
        "Check yourself: one short question the learner can answer.\n"
        "Keep the whole answer under 170 words. Use plain language, correct terminology, and clean line breaks. "
        "Do not use em dashes; use commas or periods instead. "
        f"Action: {req.action}. "
        f"Selected lesson: {json.dumps(selected_lesson)}. "
        f"Lesson objective: {lesson.get('learning_objective')}. "
        f"Lesson summary: {lesson.get('lesson_summary')}. "
        f"Lesson sections: {json.dumps(lesson.get('lesson_structure', [])[:4])}. "
        f"Learner question: {req.question}"
    )
    try:
        resp = await _call_layer("tutor", [{"role": "user", "content": prompt}], temperature=0.2)
        answer = _format_tutor_answer(resp["choices"][0]["message"]["content"], lesson, req.question)
    except Exception as exc:
        logger.warning("Tutor model unavailable; using lesson-grounded response: %s", exc)
        answer = _format_tutor_answer("", lesson, req.question)
    return models.TutorInteractionResponse(interaction_id=f"interaction:{uuid4()}", answer=answer)


def _format_tutor_answer(raw_answer: str, lesson: Dict[str, Any], question: str) -> str:
    text = re.sub(r"\n{3,}", "\n\n", str(raw_answer or "")).strip()
    required_labels = ("Answer:", "Why it matters:", "Steps:", "Example:", "Check yourself:")
    if text and all(label in text for label in required_labels):
        return text

    summary = str(lesson.get("lesson_summary") or "").strip()
    objective = str(lesson.get("learning_objective") or "").strip()
    sections = lesson.get("lesson_structure") or []
    first_section = sections[0] if sections and isinstance(sections[0], dict) else {}
    first_example = str(first_section.get("example") or "").strip()
    first_checkpoint = str(first_section.get("checkpoint") or "").strip()
    answer = text or summary or objective or "This question is about the selected lesson concept."
    return "\n".join(
        [
            f"Answer: {_first_sentence(answer, 34)}",
            f"Why it matters: {_first_sentence(objective or summary, 28)}",
            "Steps:",
            f"1. {_first_sentence(str(first_section.get('explanation') or summary), 24)}",
            f"2. {_first_sentence(str(first_section.get('concept_connection') or objective), 24)}",
            f"Example: {_first_sentence(first_example or summary, 30)}",
            f"Check yourself: {_first_sentence(first_checkpoint or question, 24)}",
        ]
    )


def _first_sentence(value: str, max_words: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.split(r"(?<=[.!?])\s+", text)[0].strip()
    words = text.split()
    if len(words) > max_words:
        text = " ".join(words[:max_words]).rstrip(".,;:") + "."
    return text or "Review the selected lesson idea and explain it in your own words."


async def quiz_agent(req: models.GenerateQuizRequest, session_state: Dict[str, Any]) -> models.QuizResponse:
    lesson = session_state.get("lesson", {})
    style = _lesson_style_from_payload(lesson)
    style_contract = _assessment_contract(style)
    prompt = (
        "Generate an adaptive quiz for this lesson. Return JSON only with a 'questions' list of 4 items. "
        "Every question must combine multiple-select checking with a long written answer. "
        "Every item must include id, type='msq_long_answer', prompt, options, correct_answers, "
        "long_answer_prompt, expected_answer, concept, and explanation. "
        "options must contain 4 to 6 short choices. correct_answers must contain 1 to 2 exact option strings for 4 or 5 options, "
        "or at most 3 exact option strings only when there are 6 options. Every question must include at least two plausible incorrect distractors. "
        "long_answer_prompt must ask the learner to justify, derive, explain, or interpret in 3 to 6 sentences. "
        "Include visual_asset only when a diagram, flowchart, graph, or process is needed for that specific question. "
        "Do not reuse the same visual for unrelated questions. visual_asset must be an object with title, description, type, and data, using the same schema as lesson visualAssets: "
        "type must be graph, diagram, flowchart, concept_map, timeline, illustration, or process. "
        "For graph visualizations, data must be numeric points with x and y fields. For vector questions, prefer "
        "a graph or coordinate diagram with endpoint labels such as (3,4), component arrows, and magnitude; do not "
        "use a flowchart for vector components. For diagrams and flowcharts, data must be 2 to 6 ordered string labels. If no visual is needed, omit visual_asset. "
        "Do not use em dashes in prompts, choices, explanations, or visual text; use commas or periods instead. "
        f"Learning style: {style}. Assessment contract: {json.dumps(style_contract)}. "
        f"Lesson: {json.dumps(lesson)}"
    )
    resp = await _call_layer("quiz", [{"role": "user", "content": prompt}], temperature=0.1)
    payload = _json_from_model_text(resp["choices"][0]["message"]["content"])
    questions = payload.get("questions")
    if not isinstance(questions, list) or len(questions) < 3:
        raise ValueError("quiz requires at least three questions")
    questions = _normalize_quiz_questions(questions, lesson)
    if len(questions) < 3:
        raise ValueError("quiz requires at least three valid questions")
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
        "Each submission answer may contain selected_options and long_answer. Grade both the multiple-select choices "
        "and the written reasoning, with more weight on conceptual justification than guessing. "
        "Assess only the concepts taught in the selected lesson and its learning objectives. "
        "Do not use project context, project goals, or applied projects. "
        "Do not use em dashes in detailed_feedback or any list item; use commas or periods instead. "
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
        "Do not use em dashes in any generated text; use commas or periods instead. "
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
    objectives = [_compact_roadmap_text(value, 10) for value in item["objectives"][:2]]
    return models.LessonRoadmapItem(
        id=item["id"].strip(),
        title=_compact_roadmap_text(item["title"], 9),
        description=_compact_roadmap_text(item["description"], 18),
        difficulty=_compact_roadmap_text(item["difficulty"], 2),
        estimated_duration=duration,
        objectives=objectives,
    )


def _compact_roadmap_text(value: Any, max_words: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.split(r"(?<=[.!?])\s+", text)[0].strip()
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]).rstrip(".,;:")




def _lesson_style_from_payload(lesson: Dict[str, Any]) -> str:
    if isinstance(lesson.get("learning_style"), str) and lesson.get("learning_style", "").strip():
        return _canonical_lesson_style(lesson["learning_style"])
    if lesson.get("audioNarration") or lesson.get("audioSections") or lesson.get("ttsContent"):
        return "Audio Learning"
    if lesson.get("visualElements") or lesson.get("conceptMaps") or lesson.get("diagramDescriptions"):
        return "Visual Examples and Diagrams"
    return "Detailed Written Explanations"


def _assessment_contract(learning_style: str) -> Dict[str, Any]:
    key = _style_key(learning_style)
    contracts = {
        "visual": {"focus": ["diagram interpretation", "visual reasoning"], "question_mix": ["mcq", "conceptual_reasoning"]},
        "audio": {"focus": ["verbal reasoning", "concept narration"], "question_mix": ["short_answer", "conceptual_reasoning"]},
        "written": {"focus": ["theory explanation", "formal reasoning"], "question_mix": ["short_answer", "conceptual_reasoning"]},
    }
    return contracts[key]


def _normalize_quiz_questions(raw_questions: list[Any], lesson: Dict[str, Any]) -> list[Dict[str, Any]]:
    normalized: list[Dict[str, Any]] = []
    for index, raw in enumerate(raw_questions[:4]):
        if not isinstance(raw, dict):
            continue
        question_id = str(raw.get("id") or f"question-{index + 1}")
        prompt = str(raw.get("prompt") or raw.get("question") or "").strip()
        concept = str(raw.get("concept") or _lesson_question_concept(lesson, index)).strip()
        visual_asset = _quiz_visual_asset(raw.get("visual_asset") or raw.get("visualAsset") or raw.get("diagram"), concept, index)
        if not prompt:
            prompt = f"Use the visual to identify and explain the key idea in {concept}." if visual_asset else f"Identify and explain the key idea in {concept}."
        if not visual_asset:
            visual_asset = _quiz_visual_asset_from_prompt(prompt, concept, index)
        options = _quiz_options(raw, concept, bool(visual_asset))
        correct_answers = raw.get("correct_answers") or raw.get("correctAnswers") or raw.get("answer") or raw.get("expected_options")
        if isinstance(correct_answers, str):
            correct_answers = [correct_answers]
        if not isinstance(correct_answers, list):
            correct_answers = options[:2]
        correct = _balanced_correct_answers(correct_answers, options)
        question = {
                "id": question_id,
                "type": "msq_long_answer",
                "prompt": prompt,
                "options": options,
                "correct_answers": correct,
                "long_answer_prompt": str(raw.get("long_answer_prompt") or raw.get("longAnswerPrompt") or f"Explain your selections for {concept} in 3 to 6 sentences."),
                "expected_answer": str(raw.get("expected_answer") or raw.get("expectedAnswer") or raw.get("explanation") or ""),
                "concept": concept,
                "explanation": str(raw.get("explanation") or "Select every correct option, then justify your reasoning in writing."),
            }
        if visual_asset:
            question["visual_asset"] = visual_asset
        normalized.append(question)
    return _dedupe_quiz_visuals(normalized[:4])


def _dedupe_quiz_visuals(questions: list[Dict[str, Any]]) -> list[Dict[str, Any]]:
    seen: set[str] = set()
    for question in questions:
        visual = question.get("visual_asset")
        if not isinstance(visual, dict):
            continue
        identity = {"type": visual.get("type"), "data": visual.get("data")} if visual.get("data") else {"imageUrl": visual.get("imageUrl")}
        key = json.dumps(identity, sort_keys=True, default=str).lower()
        if key in seen:
            question.pop("visual_asset", None)
        else:
            seen.add(key)
    return questions


def _balanced_correct_answers(correct_answers: list[Any], options: list[str]) -> list[str]:
    requested = [str(item) for item in correct_answers if str(item) in options]
    max_correct = 3 if len(options) >= 6 else 2
    max_correct = min(max_correct, max(1, len(options) - 2))
    correct: list[str] = []
    for option in requested:
        if option not in correct:
            correct.append(option)
        if len(correct) >= max_correct:
            break
    return correct or options[:1]


def _quiz_options(raw: Dict[str, Any], concept: str, has_visual: bool = False) -> list[str]:
    options = raw.get("options")
    if isinstance(options, list):
        cleaned = [re.sub(r"\s+", " ", str(option)).strip() for option in options if str(option).strip()]
    else:
        cleaned = []
    defaults = [f"Correctly identifies {concept}", "Explains the reasoning clearly", "Connects the idea to the lesson objective", "Confuses the prerequisite concept"]
    if has_visual:
        defaults[1:1] = ["Uses the visual evidence", "Ignores the diagram"]
    for option in defaults:
        if len(cleaned) >= 4:
            break
        if option not in cleaned:
            cleaned.append(option)
    return cleaned[:6]


def _quiz_visual_asset_from_prompt(prompt: str, concept: str, index: int) -> Dict[str, Any] | None:
    coordinate_count = len(re.findall(r"\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)", prompt))
    if coordinate_count < 2 or not re.search(r"\b(diagram|arrow|vector)\b", prompt, re.I):
        return None
    return _quiz_visual_asset(
        {
            "id": f"quiz-visual-{index + 1}",
            "title": "Vector diagram",
            "description": prompt,
            "type": "diagram",
            "data": [prompt],
        },
        concept,
        index,
    )


def _quiz_visual_asset(raw_visual: Any, concept: str, index: int) -> Dict[str, Any] | None:
    if isinstance(raw_visual, dict):
        image_url = str(raw_visual.get("imageUrl") or raw_visual.get("image_url") or "").strip()
        data = raw_visual.get("data") if isinstance(raw_visual.get("data"), list) else []
        if not image_url and not data:
            return None
        asset = {
            "id": str(raw_visual.get("id") or f"quiz-visual-{index + 1}"),
            "title": str(raw_visual.get("title") or f"{concept} assessment diagram"),
            "description": str(raw_visual.get("description") or f"Assessment visual for {concept}."),
            "type": str(raw_visual.get("type") or "flowchart").lower(),
            "data": data,
        }
        if image_url:
            asset["imageUrl"] = image_url
    else:
        return None
    if not asset:
        return None
    if asset["type"] not in {"graph", "diagram", "flowchart", "concept_map", "timeline", "illustration", "process"}:
        asset["type"] = "flowchart"
    if not asset.get("imageUrl") and not asset.get("data"):
        return None
    try:
        asset["imageUrl"] = str(asset.get("imageUrl") or _visual_asset_image_url(asset))
    except Exception as exc:
        logger.warning("Quiz visual rendering failed; using text-only visual metadata: %s", exc)
    return asset

def _lesson_question_concept(lesson: Dict[str, Any], index: int) -> str:
    sections = lesson.get("lesson_structure") or []
    if index < len(sections) and isinstance(sections[index], dict):
        return str(sections[index].get("title") or lesson.get("topic") or "the lesson")
    return str(lesson.get("topic") or "the lesson")


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
    questions: list[Dict[str, Any]] = []
    for index, section in enumerate(sections[:4]):
        concept = section.get("title", topic)
        base_prompt = section.get("checkpoint") or f"Explain the key idea from {concept}."
        prompt = f"Select every statement that supports this idea: {base_prompt}"
        options = [
            f"{concept} connects to the lesson objective",
            f"{concept} should be explained with evidence from the lesson",
            "A correct answer should justify the selected claims",
            "Any unrelated formula is enough",
        ]
        correct_answers = options[:2]
        question = {
                "id": f"checkpoint-{index + 1}",
                "type": "msq_long_answer",
                "prompt": prompt,
                "options": options,
                "correct_answers": correct_answers,
                "long_answer_prompt": f"Explain your selected choices for {concept} in 3 to 6 sentences.",
                "expected_answer": section.get("explanation", ""),
                "concept": concept,
                "explanation": "This checks both multiple-select recognition and written reasoning from the lesson.",
            }
        questions.append(question)
    return questions


def _fallback_assessment(sub: models.AssessmentSubmission) -> models.AssessmentResult:
    scores = {}
    for question_id, answer in sub.answers.items():
        confidence = float(sub.confidence.get(question_id, 50)) / 100
        if isinstance(answer, dict):
            selected_options = answer.get("selected_options") if isinstance(answer.get("selected_options"), list) else []
            long_answer = str(answer.get("long_answer") or "")
            option_score = min(1.0, len(selected_options) / 2)
            writing_score = min(1.0, len(long_answer.split()) / 35)
            completeness = (option_score * 0.35) + (writing_score * 0.65)
        else:
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
