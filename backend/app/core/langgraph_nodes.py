from typing import Any, Dict
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


async def _call_layer(layer: str, messages: list[Dict[str, str]], **kwargs):
    primary = ModelRouter.get_model(layer)
    try:
        return await provider.call_chat_model(messages, model=primary, **kwargs)
    except Exception as exc:
        fallback = settings.reasoning_model
        if fallback == primary:
            raise
        logger.warning("%s model unavailable: %s; retrying with fallback %s: %s", layer, primary, fallback, exc)
        try:
            return await provider.call_chat_model(messages, model=fallback, **kwargs)
        except Exception as fallback_exc:
            logger.error("%s fallback model unavailable: %s: %s", layer, fallback, fallback_exc)
            raise


async def _persist_lesson_embedding(blueprint: models.LessonBlueprint, learner_id: str, topic: str):
    try:
        docs = [json.dumps(blueprint.model_dump())]
        metas = [{"learner_id": learner_id, "topic": topic}]
        await chroma.add_documents("lessons", docs, metas, ids=[blueprint.lesson_id])
    except Exception as exc:
        logger.warning("Lesson embedding persistence failed: %s", exc)


def _json_from_model_text(text: str) -> Dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    def _loads_lenient_json(candidate: str) -> Dict[str, Any]:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError as exc:
            if "Invalid \\escape" not in str(exc):
                raise
            escaped = re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", candidate)
            return json.loads(escaped)

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
        logger.warning("Pedagogy model unavailable; using profile-derived strategy: %s", exc)
        learner_state = state.get("state", {}).get("learner_state", {})
        return models.TeachingStrategy(
            strategy_type="adaptive_scaffolding",
            recommended_modalities=learner_state.get("preferred_modalities") or ["text", "practice"],
            difficulty_level=learner_state.get("knowledge_level") or "novice",
            pacing_strategy=learner_state.get("pace_preference") or "balanced",
            interaction_density="medium",
        )

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


def _lesson_generation_prompt(
    req: models.GenerateLessonRequest,
    learner_state: models.LearnerState,
    teaching_strategy: models.TeachingStrategy,
    selected_lesson: Dict[str, Any],
    lesson_title: str,
    lesson_objectives: list[Any],
) -> str:
    constraints = req.constraints or {}
    return (
        f"Create a complete learner-facing lesson for learner {req.learner_id}.\n"
        f"Overall topic: {req.topic}\n"
        f"Selected roadmap lesson: {json.dumps(selected_lesson) if selected_lesson else lesson_title}\n"
        f"Roadmap objectives: {json.dumps(lesson_objectives)}\n"
        f"Learner state: {learner_state.model_dump_json()}\n"
        f"Teaching strategy: {teaching_strategy.model_dump_json()}\n"
        f"Additional constraints: {json.dumps(constraints)}\n\n"
        "Return ONLY a JSON object with these fields: lesson_id, topic, selected_lesson, learning_objective, "
        "lesson_summary, lesson_structure, modality_sequence, interaction_points, assessment_points, "
        "estimated_lesson_duration.\n\n"
        "Teaching quality requirements:\n"
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
        "lesson_structure requirements:\n"
        "- Return 5 or 6 sections.\n"
        "- Each section must contain title, explanation, example, concept_connection, checkpoint.\n"
        "- Each explanation must be 120 to 260 words and include the actual lesson concept, not meta-instructions.\n"
        "- Each example must be a worked example or modeled answer, not a prompt. Use numbered steps when useful.\n"
        "- Each concept_connection must explain why this section matters and how it connects to the lesson objective.\n"
        "- Each checkpoint must ask the learner to do a small task and include enough details to be answerable.\n\n"
        "interaction_points and assessment_points requirements:\n"
        "- interaction_points should include 3 to 5 learner prompts for retrieval, self-explanation, and error checking.\n"
        "- assessment_points should include 3 to 5 checks with expected_answer or success_criteria when possible.\n\n"
        "Hard constraints: Do not use projects, project goals, applied projects, or project context. Never emit "
        "placeholders such as [Topic], [Concept], TODO, or template text. Do not tell the learner to 'state the "
        "central idea' unless the central idea has already been taught in the lesson."
    )


async def lesson_planning_agent(
    req: models.GenerateLessonRequest,
    learner_state: models.LearnerState,
    teaching_strategy: models.TeachingStrategy,
) -> models.LessonBlueprint:
    selected_lesson = req.selected_lesson or {}
    lesson_title = selected_lesson.get("title") or req.topic
    lesson_objectives = selected_lesson.get("objectives") or []
    learning_style = _lesson_learning_style(req, learner_state, teaching_strategy)
    modality_contract = _modality_contract(learning_style)
    prompt = _lesson_generation_prompt(req, learner_state, teaching_strategy, selected_lesson, lesson_title, lesson_objectives)
    prompt = (
        f"{prompt}\n\nLearning style is a first-class delivery constraint: {learning_style}.\n"
        f"Modality-specific contract: {json.dumps(modality_contract)}\n"
        "Include optional modality fields only when relevant: visualElements, conceptMaps, diagramDescriptions, "
        "flowDiagrams, graphData, audioNarration, audioSections, ttsContent, practiceExercises, and interactiveQuestions. "
        "The lesson_structure must change by learning style: visual lessons pair concise text with visual data, "
        "audio lessons use concise reading text plus narration, practice-first lessons begin with worked examples "
        "and exercises, detailed-written lessons use richer explanations, and balanced lessons mix text, visuals, "
        "examples, practice, and optional narration."
    )
    messages = [
        {
            "role": "system",
            "content": (
                "You are a master teacher and curriculum designer. Produce lessons that can teach a real learner "
                "without requiring a separate instructor. Be concrete, accurate, warm, and step-by-step."
            ),
        },
        {"role": "user", "content": prompt},
    ]
    blueprint = None
    for attempt in range(2):
        try:
            resp = await _call_layer("planning", messages)
            text = resp["choices"][0]["message"]["content"]
            payload = _json_from_model_text(text)
            candidate = models.LessonBlueprint(**payload)
            _validate_blueprint(candidate)
            candidate.lesson_id = f"lesson:{req.learner_id}:{uuid4()}"
            _ensure_modality_payload(candidate, lesson_title, learning_style)
            blueprint = candidate
            break
        except Exception as exc:
            if attempt == 1:
                logger.warning("Lesson planning model unavailable; using structured lesson fallback: %s", exc)
                blueprint = _fallback_blueprint(req, learning_style)
                break
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"The previous blueprint was unusable: {exc}. Regenerate complete JSON for the literal topic "
                        f"{req.topic} and selected lesson {lesson_title}. Replace every placeholder with learner-facing content. "
                        "Every explanation must teach the idea, every example must be worked with numbered steps, "
                        "and every checkpoint must have enough context for a learner to answer it."
                    ),
                }
            )

    if blueprint is None:
        raise RuntimeError("Lesson planning agent did not produce a blueprint.")

    asyncio.create_task(_persist_lesson_embedding(blueprint, req.learner_id, req.topic))

    return blueprint


async def lesson_roadmap_agent(
    req: models.GenerateLessonRequest,
    learner_profile: models.LearnerProfile,
    learner_state: models.LearnerState,
    teaching_strategy: models.TeachingStrategy,
) -> models.LessonRoadmapResponse:
    constraints = req.constraints or {}
    planning_context = {
        "topic": req.topic,
        "education_level": constraints.get("education_level") or learner_profile.education_level,
        "familiarity_level": constraints.get("familiarity_level") or learner_profile.topic_familiarity or learner_state.knowledge_level,
        "pace": constraints.get("pace") or learner_profile.pace_preference or learner_state.pace_preference,
        "learning_style": constraints.get("learning_style") or learner_profile.preferred_modality or learner_state.preferred_modalities,
        "availability": constraints.get("availability") or learner_profile.learning_availability,
        "accessibility": constraints.get("accessibility") or learner_profile.accessibility,
        "teaching_strategy": teaching_strategy.model_dump(),
        "adaptation_context": constraints.get("adaptation_context", []),
    }
    prompt = (
        "Generate a personalized lesson roadmap before any lesson content is created. "
        "Return JSON only with a 'lessons' list of 4 to 8 items. Every item must include id, title, "
        "description, difficulty, estimated_duration as minutes, and objectives as a list of strings. "
        "Sequence prerequisites before advanced material and adapt the roadmap to this learner context. "
        "Make every lesson title specific enough that a teacher could teach from it; avoid vague titles such as "
        "'Core operations' unless the exact operations are named. Descriptions must say what the learner will "
        "understand, what they will practice, and how the lesson prepares the next lesson. "
        "Do not hardcode a generic plan. Do not use project context, project goals, or applied projects. "
        f"Learner roadmap context: {json.dumps(planning_context)}"
    )
    try:
        resp = await _call_layer("planning", [{"role": "user", "content": prompt}], temperature=0.2)
        payload = _json_from_model_text(resp["choices"][0]["message"]["content"])
        raw_lessons = payload.get("lessons")
        if not isinstance(raw_lessons, list) or len(raw_lessons) < 3:
            raise ValueError("roadmap requires at least three lessons")
        lessons = [_normalize_roadmap_item(item, index) for index, item in enumerate(raw_lessons)]
    except Exception as exc:
        logger.warning("Roadmap model unavailable; using adaptive roadmap fallback: %s", exc)
        lessons = _fallback_roadmap(req, planning_context)
    return models.LessonRoadmapResponse(learner_id=req.learner_id, topic=req.topic, lessons=lessons)


def _validate_blueprint(blueprint: models.LessonBlueprint):
    if len(blueprint.lesson_structure) < 4:
        raise ValueError("lesson_structure must contain at least four learning steps")
    if not blueprint.topic.strip():
        raise ValueError("topic must be explicit")
    required_section_fields = {"title", "explanation", "example", "checkpoint"}
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


def _ensure_modality_payload(blueprint: models.LessonBlueprint, lesson_title: str, learning_style: str) -> None:
    style_key = _style_key(learning_style)
    needs_visuals = style_key in {"visual", "balanced"} and not (
        blueprint.visualElements
        or blueprint.conceptMaps
        or blueprint.diagramDescriptions
        or blueprint.flowDiagrams
        or blueprint.graphData
    )
    needs_audio = style_key == "audio" and not (blueprint.audioNarration or blueprint.audioSections or blueprint.ttsContent)
    needs_practice = style_key in {"practice", "balanced"} and not (
        blueprint.practiceExercises or blueprint.interactiveQuestions
    )
    if needs_visuals or needs_audio or needs_practice:
        _apply_fallback_modalities(blueprint, lesson_title, style_key)
    _apply_style_overrides(blueprint, lesson_title, style_key, learning_style)


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
        await chroma.add_documents("lesson_assets", docs, metas, ids=ids)
    except Exception as exc:
        logger.warning("Lesson asset embedding persistence failed: %s", exc)

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


def _normalize_roadmap_item(item: Dict[str, Any], index: int) -> models.LessonRoadmapItem:
    title = str(item.get("title") or item.get("lesson_title") or f"Lesson {index + 1}").strip()
    objectives = item.get("objectives") or item.get("lesson_objectives") or []
    if not isinstance(objectives, list):
        objectives = [str(objectives)]
    return models.LessonRoadmapItem(
        id=str(item.get("id") or f"lesson-{index + 1}"),
        title=title,
        description=str(item.get("description") or item.get("summary") or f"Learn {title}."),
        difficulty=str(item.get("difficulty") or "adaptive"),
        estimated_duration=int(item.get("estimated_duration") or item.get("duration") or 30),
        objectives=[str(objective) for objective in objectives if str(objective).strip()],
    )


def _fallback_roadmap(req: models.GenerateLessonRequest, context: Dict[str, Any]) -> list[models.LessonRoadmapItem]:
    topic = req.topic
    familiarity = str(context.get("familiarity_level") or "beginner").lower()
    pace = str(context.get("pace") or "balanced").lower()
    learning_style = str(context.get("learning_style") or "Balanced Mix")
    style_key = _style_key(learning_style)
    duration = 25 if "fast" in pace else 45 if "gentle" in pace else 35
    topic_lower = topic.lower()
    if "calculus" in topic_lower and "advanced" not in familiarity:
        stages = [
            (
                "Limits as predictable change",
                "Build the idea of approaching a value, read limit notation, and estimate limits from tables, graphs, and simple formulas.",
                "beginner",
                [
                    "Explain a limit as the value a function approaches.",
                    "Estimate a limit from numeric and visual evidence.",
                    "Recognize when a two-sided limit does not exist.",
                ],
            ),
            (
                "Derivatives as instant rate of change",
                "Turn average speed into instantaneous rate, connect slopes to derivatives, and compute first derivatives from simple rules.",
                "beginner",
                [
                    "Connect secant slopes, tangent slopes, and derivatives.",
                    "Differentiate simple power functions.",
                    "Interpret a derivative in words and units.",
                ],
            ),
            (
                "Using derivatives to understand functions",
                "Use signs of derivatives to identify increasing, decreasing, and turning behavior in functions.",
                "intermediate",
                [
                    "Use f'(x) to reason about a graph.",
                    "Find and interpret critical points.",
                    "Separate calculation from interpretation.",
                ],
            ),
            (
                "Integrals as accumulated change",
                "Read area under a curve as accumulation, estimate totals from rectangles, and connect accumulation back to rates.",
                "intermediate",
                [
                    "Explain definite integrals as accumulated change.",
                    "Estimate area using rectangles.",
                    "Describe how derivatives and integrals are related.",
                ],
            ),
        ]
    elif "advanced" in familiarity:
        stages = [
            (
                "Diagnostic refresh",
                f"Identify what you already know about {topic}, then surface subtle gaps before moving quickly.",
                "advanced",
                [f"Explain the core definitions used in {topic}.", "Identify one common edge case.", "Choose a strategy for a mixed problem."],
            ),
            (
                "Formal structure and edge cases",
                f"Study the definitions, assumptions, and boundary cases that make {topic} methods valid.",
                "advanced",
                [f"Justify a method used in {topic}.", "Check assumptions before calculating.", "Explain what can fail and why."],
            ),
            (
                "Challenging mixed problems",
                f"Solve multi-step {topic} problems that require choosing and combining methods.",
                "advanced",
                ["Select a method from problem evidence.", "Carry out a multi-step solution.", "Interpret the result against the original question."],
            ),
            (
                "Transfer and explanation",
                f"Explain, justify, and transfer {topic} to unfamiliar problems with increasing independence.",
                "advanced",
                ["Teach the method back in your own words.", "Adapt it to a new case.", "Compare two possible solution paths."],
            ),
        ]
    else:
        stages = [
            (
                f"Core meaning and vocabulary of {topic}",
                f"Build the plain-language meaning, notation, and basic vocabulary needed to study {topic}.",
                "beginner",
                [f"Define the key vocabulary of {topic}.", "Connect each term to a simple example.", "Notice what information the notation gives you."],
            ),
            (
                f"Essential procedures in {topic}",
                f"Practice the main moves used when solving beginner {topic} problems and explain why each move is valid.",
                "beginner",
                ["Follow a worked example step by step.", "Name the reason for each step.", "Avoid the most common beginner error."],
            ),
            (
                f"Guided {topic} examples",
                f"Work through scaffolded examples that connect the concept, procedure, and interpretation.",
                "intermediate",
                ["Solve with guidance.", "Check the answer against the original question.", "Explain the result in words."],
            ),
            (
                f"Independent {topic} practice",
                f"Check understanding with fresh problems, self-explanations, and error correction.",
                "intermediate",
                ["Solve a new problem independently.", "Find and correct a likely mistake.", "Summarize when to use the method."],
            ),
        ]

    style_rewrites = {
        "visual": [
            f"Build a concept map to visualize the core language and notation of {topic}.",
            f"Use diagrams to see how key {topic} operations transform inputs to outputs.",
            f"Follow flow visuals through scaffolded {topic} examples.",
            f"Interpret new diagrams and graph-based representations to verify understanding.",
        ],
        "audio": [
            f"Listen to the core vocabulary and intuition behind {topic}.",
            f"Follow spoken walkthroughs for the essential {topic} operations.",
            f"Use narration-driven examples to track reasoning steps in {topic}.",
            f"Answer verbal reasoning checks on fresh {topic} scenarios.",
        ],
        "practice": [
            f"Start with a worked example to model the first {topic} solving pattern.",
            f"Complete short, guided {topic} exercises with hints and feedback.",
            f"Solve scaffolded {topic} problems before reading deeper explanations.",
            f"Attempt independent practice sets to consolidate {topic} fluency.",
        ],
        "written": [
            f"Develop precise definitions and conceptual foundations for {topic}.",
            f"Work through detailed reasoning behind each core {topic} operation.",
            f"Study long-form, step-by-step derivations in representative {topic} examples.",
            f"Write complete conceptual explanations to validate {topic} understanding.",
        ],
        "balanced": [
            f"Build intuition and notation for {topic} through concise explanation and visual cues.",
            f"Learn core {topic} operations via short examples plus guided practice.",
            f"Use scaffolded examples with mixed visual, textual, and interactive support.",
            f"Check transfer with fresh {topic} problems and concise concept summaries.",
        ],
    }
    rewrite = style_rewrites[style_key]
    stages = [(title, rewrite[index], difficulty) for index, (title, _, difficulty) in enumerate(stages)]
    return [
        models.LessonRoadmapItem(
            id=f"roadmap-{index + 1}",
            title=title,
            description=description,
            difficulty=difficulty,
            estimated_duration=duration,
            objectives=objectives,
        )
        for index, (title, description, difficulty, objectives) in enumerate(stages)
    ]


def _fallback_blueprint(req: models.GenerateLessonRequest, learning_style: str = "Balanced Mix") -> models.LessonBlueprint:
    topic = req.topic
    selected_lesson = req.selected_lesson or {}
    lesson_title = selected_lesson.get("title") or topic
    style_key = _style_key(learning_style)
    profile = _fallback_lesson_profile(topic, lesson_title)
    sections = _fallback_lesson_sections(topic, lesson_title, profile)
    blueprint = models.LessonBlueprint(
        lesson_id=f"lesson:{req.learner_id}:{uuid4()}",
        topic=topic,
        selected_lesson=selected_lesson or None,
        learning_objective=profile["objective"],
        lesson_summary=profile["summary"],
        learning_style=learning_style,
        lesson_structure=sections,
        modality_sequence=["concept", "worked example", "error check", "guided practice", "reflection"],
        interaction_points=[
            {"prompt": profile["retrieval_prompt"]},
            {"prompt": f"Before looking back, explain why the worked example uses {profile['key_action']}."},
            {"prompt": f"Find one step in the lesson where a beginner might make a mistake, then explain the safer move."},
            {"prompt": f"Create a one-sentence summary of {lesson_title} that includes both the idea and when to use it."},
        ],
        assessment_points=[
            {
                "prompt": profile["assessment_prompt"],
                "success_criteria": "The answer should define the idea, show the calculation or reasoning steps, and interpret the result in context.",
            },
            {
                "prompt": f"Explain one common misconception about {lesson_title} and how to avoid it.",
                "success_criteria": "The response should name the misconception and give a concrete correction strategy.",
            },
        ],
        estimated_lesson_duration=35,
    )
    _apply_fallback_modalities(blueprint, lesson_title, style_key)
    _apply_style_overrides(blueprint, lesson_title, style_key, learning_style)
    return blueprint


def _apply_fallback_modalities(blueprint: models.LessonBlueprint, lesson_title: str, style_key: str) -> None:
    topic = blueprint.topic
    if style_key in {"visual", "balanced"}:
        blueprint.visualElements = [
            {"type": "relationship_map", "title": f"{lesson_title} visual map", "caption": f"How the main ideas in {lesson_title} connect.", "items": ["Known information", "Core change", "Rule or pattern", "Result"]},
            {"type": "comparison", "title": "Representation match", "caption": "The same idea shown as words, symbols, and a worked case.", "items": ["Words", "Diagram", "Symbols", "Example"]},
        ]
        blueprint.conceptMaps = [
            {
                "title": f"{lesson_title} concept map",
                "nodes": [{"id": "idea", "label": lesson_title}, {"id": "input", "label": "Input"}, {"id": "process", "label": "Process"}, {"id": "output", "label": "Output"}],
                "edges": [{"from": "input", "to": "idea", "label": "frames"}, {"from": "idea", "to": "process", "label": "guides"}, {"from": "process", "to": "output", "label": "produces"}],
            }
        ]
        blueprint.diagramDescriptions = [
            {
                "title": f"{lesson_title} relationship sketch",
                "description": f"Draw {lesson_title} with arrows from input to transformation to output, then label where the key rule acts."
            },
            {
                "title": "Visual comparison",
                "description": "Show the same idea as a picture, a symbolic form, and one solved mini example."
            },
        ]
        blueprint.flowDiagrams = [
            {"title": f"{topic} flow", "steps": ["Read the situation", "Identify the relationship", "Apply the rule", "Check the result"]}
        ]
    if style_key == "audio":
        narration = " ".join(f"{step['title']}. {step['explanation']}" for step in blueprint.lesson_structure)
        blueprint.audioNarration = narration
        blueprint.ttsContent = narration
        blueprint.audioSections = [{"title": step["title"], "script": step["explanation"], "listen_for": step["checkpoint"]} for step in blueprint.lesson_structure]
    if style_key in {"practice", "balanced"}:
        blueprint.practiceExercises = [
            {"prompt": f"Try a short {lesson_title} problem before reading the explanation.", "hint": "Name what is known, then choose the next move.", "feedback": "Compare your first move with the worked example."},
            {"prompt": f"Create one fresh {topic} example and solve the first step.", "hint": "Keep the numbers or conditions simple.", "feedback": "Check whether your step follows the same relationship."},
        ]
        blueprint.interactiveQuestions = [
            {"type": "short_answer", "prompt": f"What is the first decision you make when solving {lesson_title}?"},
            {"type": "reflection", "prompt": "Which step changed your understanding the most?"},
        ]


def _apply_style_overrides(
    blueprint: models.LessonBlueprint,
    lesson_title: str,
    style_key: str,
    learning_style: str,
) -> None:
    blueprint.learning_style = learning_style

    if style_key == "visual":
        blueprint.modality_sequence = ["concept_map", "diagram_description", "visual_relationship", "checkpoint"]
        if not blueprint.diagramDescriptions:
            blueprint.diagramDescriptions = [
                {"title": f"{lesson_title} overview diagram", "description": f"Sketch {lesson_title} with labeled connections between main components."}
            ]
        for section in blueprint.lesson_structure:
            section["explanation"] = _compress_text(str(section.get("explanation", "")), max_chars=180)
            section["visual_prompt"] = f"Draw or inspect the diagram for '{section.get('title', lesson_title)}' before reading symbols."
        blueprint.assessment_points = [
            {"prompt": f"Interpret a diagram for {lesson_title} and explain what each visual relationship represents."},
            {"prompt": f"Given a visual flow of {blueprint.topic}, identify the step where the main transformation occurs."},
        ]
    elif style_key == "audio":
        blueprint.modality_sequence = ["audio_narration", "spoken_walkthrough", "listening_checkpoint", "recap"]
        narration = blueprint.ttsContent or blueprint.audioNarration or " ".join(
            f"{step.get('title', 'Section')}. {step.get('explanation', '')}" for step in blueprint.lesson_structure
        )
        blueprint.audioNarration = narration
        blueprint.ttsContent = narration
        if not blueprint.audioSections:
            blueprint.audioSections = [
                {
                    "title": step.get("title", f"Part {index + 1}"),
                    "script": step.get("explanation", ""),
                    "listen_for": step.get("checkpoint", ""),
                }
                for index, step in enumerate(blueprint.lesson_structure)
            ]
        for section in blueprint.lesson_structure:
            section["explanation"] = _compress_text(str(section.get("explanation", "")), max_chars=140)
            section["listening_focus"] = f"Listen for the reasoning move in '{section.get('title', lesson_title)}'."
        blueprint.assessment_points = [
            {"prompt": f"After listening to the explanation of {lesson_title}, summarize the core idea verbally in 2-3 sentences."},
            {"prompt": f"Describe the reasoning sequence you heard for solving a {blueprint.topic} example."},
        ]
    elif style_key == "practice":
        blueprint.modality_sequence = ["worked_example", "practice", "hint", "feedback", "explanation"]
        for section in blueprint.lesson_structure:
            example_text = str(section.get("example", section.get("checkpoint", "")))
            section["practice"] = section.get("practice") or f"Try a similar problem based on: {example_text}"
            section["hint"] = section.get("hint") or "Start by identifying known values, then choose the next operation."
            section["feedback"] = section.get("feedback") or "Check each step against the worked example path before moving on."
            section["explanation"] = _compress_text(str(section.get("explanation", "")), max_chars=220)
        blueprint.assessment_points = [
            {"prompt": f"Solve a new {lesson_title} problem and show each step."},
            {"prompt": f"Complete a numerical {blueprint.topic} exercise and explain where hints were useful."},
        ]
    elif style_key == "written":
        blueprint.modality_sequence = ["deep_explanation", "derivation", "worked_example", "theory_check"]
        blueprint.assessment_points = [
            {"prompt": f"Write a detailed conceptual explanation of {lesson_title}, including why each step is valid."},
            {"prompt": f"Explain the theory behind {blueprint.topic} and justify a derivation choice."},
        ]
    else:
        blueprint.modality_sequence = ["short_explanation", "visual", "example", "practice", "optional_narration", "checkpoint"]
        blueprint.assessment_points = [
            {"prompt": f"Use one visual and one calculation to explain {lesson_title}."},
            {"prompt": f"Solve a short {blueprint.topic} problem and summarize the concept in plain language."},
        ]


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


def _fallback_lesson_profile(topic: str, lesson_title: str) -> Dict[str, str]:
    title_lower = lesson_title.lower()
    topic_lower = topic.lower()
    if "derivative" in title_lower or ("calculus" in topic_lower and "rate" in title_lower):
        return {
            "concept": "derivative",
            "objective": "Understand derivatives as instantaneous rates of change and tangent slopes.",
            "summary": "You will learn what a derivative measures, how it grows out of average rate of change, how to compute a simple derivative, and how to interpret the answer in words and units.",
            "throughline": "A car's position after t seconds is s(t) = t^2 meters.",
            "worked_problem": "Estimate and compute the car's speed at t = 3 seconds.",
            "key_action": "a smaller and smaller time interval to move from average speed toward instant speed",
            "retrieval_prompt": "Without using a formula first, explain the difference between average speed over an interval and speed at one instant.",
            "assessment_prompt": "For h(t) = t^2 + 2t, find the derivative at t = 4 and explain what the value means.",
        }
    if "integral" in title_lower or "accumulated" in title_lower:
        return {
            "concept": "definite integral",
            "objective": "Understand integrals as accumulated change and area under a rate graph.",
            "summary": "You will learn how an integral adds small pieces of change, why area under a curve can represent a total amount, and how to estimate accumulation before using formal notation.",
            "throughline": "Water flows into a tank at r(t) liters per minute.",
            "worked_problem": "Estimate the total water added from 0 to 4 minutes when the rate is about 2, 3, 5, and 6 liters per minute across four one-minute intervals.",
            "key_action": "adding rate times time for each small interval",
            "retrieval_prompt": "Explain why multiplying a rate by a time interval gives an amount accumulated during that interval.",
            "assessment_prompt": "A machine fills boxes at rates 4, 6, and 5 boxes per minute over three one-minute intervals. Estimate the total boxes filled and explain the integral idea.",
        }
    if "limit" in title_lower or ("calculus" in topic_lower and "predictable" in title_lower):
        return {
            "concept": "limit",
            "objective": "Understand limits as the value a function approaches, even before or without using the exact input.",
            "summary": "You will learn how limits describe approaching behavior, how to read limit notation, how to estimate a limit from nearby values, and how to spot when a two-sided limit does not exist.",
            "throughline": "The function f(x) = (x^2 - 1)/(x - 1) is undefined at x = 1 but has predictable nearby values.",
            "worked_problem": "Find what f(x) approaches as x gets close to 1.",
            "key_action": "checking nearby inputs from both sides instead of only substituting the exact input",
            "retrieval_prompt": "Explain why a limit can exist even when the function value at that exact input is missing.",
            "assessment_prompt": "For g(x) = (x^2 - 4)/(x - 2), estimate the limit as x approaches 2 and explain why direct substitution is not the main idea.",
        }
    return {
        "concept": lesson_title,
        "objective": f"Understand {lesson_title} well enough to explain it, follow a worked example, and solve a similar problem independently.",
        "summary": f"You will build the core meaning of {lesson_title}, learn the procedure one step at a time, study a modeled example, and check your understanding with a fresh case.",
        "throughline": f"A simple {topic} situation where each quantity is named before any method is used.",
        "worked_problem": f"Solve a beginner-friendly {lesson_title} problem and explain each step.",
        "key_action": "the main method from the lesson only after the meaning is clear",
        "retrieval_prompt": f"Explain what {lesson_title} is trying to find or describe before naming any formula.",
        "assessment_prompt": f"Solve a short {lesson_title} problem and explain why each step is valid.",
    }


def _fallback_lesson_sections(topic: str, lesson_title: str, profile: Dict[str, str]) -> list[Dict[str, str]]:
    concept = profile["concept"]
    return [
        {
            "title": "Start with the meaning",
            "explanation": (
                f"The first job in {lesson_title} is to know what question the idea answers. In this lesson, the "
                f"central idea is {concept}. Think of it as a tool for describing behavior, not as a symbol to "
                f"memorize. We will use this throughline: {profile['throughline']} Before calculating, name the "
                "quantities, ask what is changing, and decide what the answer should describe. This lowers the "
                "chance of treating notation like a magic trick. If a formula appears later, it should feel like a "
                "compressed version of reasoning you already understand."
            ),
            "example": (
                f"Modeled thinking: 1. Read the situation: {profile['throughline']} 2. Name the input and output. "
                "The input is the variable we are allowed to change; the output is the value that responds. "
                f"3. Ask the lesson question: what does {concept} tell us about this situation? 4. Predict the "
                "kind of answer before calculating, such as a value approached, a rate of change, or an accumulated total."
            ),
            "concept_connection": (
                f"This section anchors {lesson_title} in meaning. Learners who can say what the concept measures "
                "are much more likely to choose the right method and catch unreasonable answers."
            ),
            "checkpoint": (
                f"In the throughline situation, identify the input, the output, and what {concept} is supposed to "
                "tell you. Write one sentence before using any formula."
            ),
        },
        {
            "title": "Build the method from intuition",
            "explanation": (
                f"Now connect the meaning to a method. The key move is {profile['key_action']}. Do this slowly: "
                "start with a rough idea, make the comparison or calculation more precise, then interpret the result. "
                "A common mistake is to jump straight to a rule and lose track of what the numbers mean. Instead, "
                "treat each line of work as an answer to a small question: What do I know? What changes? What am I "
                "trying to estimate or compute? When the method is built this way, the final answer is not just a "
                "number; it is a statement about the original situation."
            ),
            "example": (
                f"Worked setup for the lesson problem: {profile['worked_problem']} 1. Write down the known function "
                "or quantities. 2. Choose the input or interval the question cares about. 3. Apply the key move: "
                f"{profile['key_action']}. 4. Keep units or context attached to the result. 5. Ask whether the "
                "answer matches the behavior described in the situation."
            ),
            "concept_connection": (
                f"This turns {lesson_title} from a definition into a usable process. The learner sees why the "
                "procedure follows from the idea instead of memorizing an isolated rule."
            ),
            "checkpoint": (
                f"Use the key move for this lesson, {profile['key_action']}, on the throughline example. Explain "
                "what each step is doing in plain language."
            ),
        },
        {
            "title": "Study a worked example",
            "explanation": (
                "A worked example should show both calculation and judgment. Read each step as a reasoned choice. "
                "If a line changes the expression, ask why that change is allowed. If a number appears, ask what it "
                "means in the original setting. Good studying is active: cover the next step, predict it, then check. "
                "If your prediction differs, the gap tells you exactly what to review. The goal is not to copy the "
                f"example; the goal is to learn how an expert thinks through {lesson_title}."
            ),
            "example": (
                f"Worked example: {profile['worked_problem']} 1. Restate the goal in your own words. 2. Identify "
                f"the expression or data connected to {concept}. 3. Perform the method carefully, one small step at "
                "a time. 4. Simplify only after the meaning is clear. 5. Final answer: give the computed result, "
                "then add one sentence interpreting it in the situation. If the answer has units, include them."
            ),
            "concept_connection": (
                "This section models the full study routine: understand the question, execute the method, and "
                "interpret the answer. That is the pattern the learner should imitate on new problems."
            ),
            "checkpoint": (
                "Rework the example with the notes hidden. After each line, say why that line follows from the "
                "previous one. Mark the first step that feels unclear."
            ),
        },
        {
            "title": "Avoid common mistakes",
            "explanation": (
                f"Most confusion in {lesson_title} comes from mixing up the object being studied with the tool used "
                "to study it. Another common mistake is treating notation as instructions without checking meaning. "
                "A safer habit is to pause after every result and ask: What does this number or expression describe? "
                "Does it answer the original question? Are there restrictions, missing values, units, or assumptions "
                "that matter? This habit catches many errors before they become habits."
            ),
            "example": (
                "Error check: Suppose a learner gets a final number but cannot say what it means. That answer is not "
                "finished. 1. Return to the problem statement. 2. Name the quantity the answer represents. 3. Check "
                "whether the sign, size, and units make sense. 4. If something conflicts with the situation, revisit "
                "the step where the method was chosen or simplified."
            ),
            "concept_connection": (
                f"Error checking is part of learning {lesson_title}, not an extra step. It protects understanding "
                "and prepares the learner for independent practice."
            ),
            "checkpoint": (
                f"Name one mistake someone might make while using {lesson_title}. Then write the question you would "
                "ask yourself to catch that mistake."
            ),
        },
        {
            "title": "Try a fresh problem",
            "explanation": (
                "Independent practice should be close enough to the example to feel possible, but different enough "
                "to require thinking. Start by restating the problem, then choose the method, then solve. Do not look "
                "back until you have made a genuine attempt. If you get stuck, identify the exact decision point: "
                "Was it understanding the question, choosing the method, doing the algebra or procedure, or "
                "interpreting the answer? That diagnosis makes review efficient."
            ),
            "example": (
                f"Practice model: {profile['assessment_prompt']} 1. Restate what is being asked. 2. List the known "
                f"quantities. 3. Apply the {concept} idea using the lesson method. 4. Write the final result. "
                "5. Add a one-sentence interpretation. 6. Compare your work with the success criteria in the "
                "assessment panel."
            ),
            "concept_connection": (
                f"This final section moves {lesson_title} from recognition to usable skill. The learner practices "
                "choosing and explaining the method, which is what makes the lesson teachable."
            ),
            "checkpoint": (
                f"Complete the fresh problem: {profile['assessment_prompt']} Include the method, the answer, and a "
                "plain-language interpretation."
            ),
        },
    ]


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
