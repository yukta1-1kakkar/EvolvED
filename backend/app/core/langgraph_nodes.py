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
        logger.warning("%s model %s failed; retrying with %s: %s", layer, primary, fallback, exc)
        return await provider.call_chat_model(messages, model=fallback, **kwargs)


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

    try:
        return json.loads(cleaned)
    except Exception:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return json.loads(cleaned[start : end + 1])
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
        resp = await provider.call_chat_model(messages, model=ModelRouter.get_model("pedagogy"), temperature=0.0)
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
    prompt = (
        f"Create learner-facing lesson content for learner {req.learner_id}."
        f" Overall topic: {req.topic}. Selected lesson: {json.dumps(selected_lesson) if selected_lesson else lesson_title}."
        f" Lesson objectives: {json.dumps(lesson_objectives)}."
        f" Learning style is a first-class delivery constraint: {learning_style}."
        f" Learner state: {learner_state.model_dump_json()}."
        f" Teaching strategy selected by the pedagogy agent: {teaching_strategy.model_dump_json()}."
        f" Additional constraints: {json.dumps(req.constraints or {})}."
        f" Modality-specific contract: {json.dumps(modality_contract)}."
        " Return ONLY a JSON object with these fields: 'lesson_id', 'topic', 'learning_style', 'selected_lesson',"
        " 'learning_objective', 'lesson_summary', 'lesson_structure' (list of dicts),"
        " 'modality_sequence' (list of strings), 'interaction_points' (list of dicts),"
        " 'assessment_points' (list of dicts), and 'estimated_lesson_duration' (int)."
        " Include optional modality fields only when relevant: 'visualElements', 'conceptMaps',"
        " 'diagramDescriptions', 'flowDiagrams', 'graphData', 'audioNarration', 'audioSections', 'ttsContent',"
        " 'practiceExercises', and 'interactiveQuestions'."
        " Return 4 to 6 lesson_structure items. Each item must contain 'title', 'explanation',"
        " 'example', 'concept_connection', and 'checkpoint'. The lesson_structure must change by learning style:"
        " visual lessons use short captions paired with visual data, audio lessons use concise reading text plus narration,"
        " practice-first lessons begin with worked examples and exercises, detailed-written lessons use longer explanations,"
        " and balanced lessons mix concise text, visuals, examples, practice, and optional narration."
        " Adapt examples to the learner's level,"
        " pace, modality, education level, availability, and accessibility needs. Include learner-facing prompts"
        " in interaction_points and assessment_points."
        " Do not use projects, project goals, applied projects, or project context to plan or teach this lesson."
        " Never emit placeholders such as [Topic], [Concept], TODO, or template text. Use the literal topic everywhere it is needed."
    )
    messages = [{"role": "user", "content": prompt}]
    blueprint = None
    for attempt in range(2):
        try:
            resp = await provider.call_chat_model(messages, model=ModelRouter.get_model("planning"))
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
                        f"{req.topic} and selected lesson {lesson_title}. Replace every placeholder with learner-facing content."
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
        if len(str(section.get("explanation", "")).strip()) < 35:
            raise ValueError(f"lesson_structure item {index + 1} needs a complete explanation")
    serialized = json.dumps(blueprint.model_dump()).lower()
    placeholders = ["[topic]", "[concept]", "todo", "insert topic", "placeholder"]
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
        resp = await _call_layer("quiz", [{"role": "user", "content": prompt}], temperature=0.2)
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
    if "advanced" in familiarity:
        stages = [
            ("Diagnostic refresh", "Identify what you already know and surface subtle gaps.", "advanced"),
            ("Deeper structure", f"Study the formal structure and edge cases behind {topic}.", "advanced"),
            ("Challenging applications", f"Solve multi-step {topic} problems with increasing independence.", "advanced"),
            ("Transfer and proof", f"Explain, justify, and transfer {topic} to unfamiliar problems.", "advanced"),
        ]
    else:
        stages = [
            ("Intuition and vocabulary", f"Build the meaning, notation, and basic language of {topic}.", "beginner"),
            ("Core operations", f"Practice the essential moves used when working with {topic}.", "beginner"),
            ("Guided examples", f"Work through scaffolded {topic} examples step by step.", "intermediate"),
            ("Independent practice", f"Check understanding with fresh {topic} problems.", "intermediate"),
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
            objectives=[description],
        )
        for index, (title, description, difficulty) in enumerate(stages)
    ]


def _fallback_blueprint(req: models.GenerateLessonRequest, learning_style: str = "Balanced Mix") -> models.LessonBlueprint:
    topic = req.topic
    selected_lesson = req.selected_lesson or {}
    lesson_title = selected_lesson.get("title") or topic
    style_key = _style_key(learning_style)
    if style_key == "visual":
        sections = [
            ("Map the big idea", f"Start with a visual map: place {lesson_title} at the center, then connect inputs, changes, rules, and outputs.", "Sketch the map and label one relationship."),
            ("Follow the flow", f"Trace the process as arrows from what is known to what must be found, keeping each arrow as one visible reasoning move.", "Point to the arrow where the main transformation happens."),
            ("Compare views", f"Look at {topic} as a diagram, a table, and a compact formula so the same idea is visible in multiple forms.", "Match each visual feature to the symbol it represents."),
            ("Use the picture", f"Solve a fresh case by reading the diagram first, then use symbols only to confirm what the visual already suggests.", "Name the visual clue that guided your answer."),
        ]
        modality_sequence = ["concept_map", "flow_diagram", "visual_example", "checkpoint"]
    elif style_key == "audio":
        sections = [
            ("Listen for the core idea", f"Hear {lesson_title} as a short spoken story: what changes, why it changes, and what result to listen for.", "Say the core idea aloud in one sentence."),
            ("Spoken walkthrough", f"Follow a narrated example where each step explains what to notice before naming the formal move.", "Pause and predict the next spoken step."),
            ("Memory cue", f"Use a repeatable phrase for {topic} so the method is easy to recall without rereading a paragraph.", "Repeat the cue and explain when it applies."),
            ("Listening check", f"Answer a short oral checkpoint, then compare your response with the summary.", "Record or say the answer before looking back."),
        ]
        modality_sequence = ["audio_narration", "spoken_example", "listening_check", "reflection"]
    elif style_key == "practice":
        sections = [
            ("Worked example first", f"Begin with a complete {lesson_title} example and observe each decision before studying the rule.", "Identify the first decision in the example."),
            ("Guided practice", f"Try a similar case with hints after each move, then compare your step with the worked path.", "Complete the next step before reading the hint."),
            ("Feedback and fix", f"Check the answer, name the mistake that would most likely happen, and correct it immediately.", "Explain one correction in your own words."),
            ("Mini explanation", f"Now summarize the rule behind the practice so the method connects back to the concept.", "State the rule and solve one fresh case."),
        ]
        modality_sequence = ["worked_example", "practice", "feedback", "mini_explanation"]
    elif style_key == "written":
        sections = [
            ("Build the core idea", f"{lesson_title} starts with the meaning behind the notation and the reason each step is valid. Define the quantities, describe what changes, and connect the idea to the broader structure of {topic}.", f"State the central idea of {lesson_title} in your own words."),
            ("Reason step by step", f"Work through the logic carefully: begin from known definitions, justify each transformation, and explain why no step changes the meaning of the expression or situation.", f"Justify one step without using a shortcut."),
            ("Derive through an example", f"Use a representative example of {lesson_title}, label each quantity, show the formal reasoning, and explain how the method generalizes beyond this single case.", f"Solve a simple {lesson_title} example step by step."),
            ("Check and extend understanding", f"Summarize the lesson, test it with a fresh case, and name a condition that would change the method, interpretation, or result.", f"Explain when this {topic} method should be used."),
        ]
        modality_sequence = ["detailed_explanation", "derivation", "worked_example", "assessment"]
    else:
        sections = [
            ("Build the core idea", f"Start with a concise explanation of {lesson_title}, then anchor it with one visual relationship and one plain-language example.", f"State the central idea of {lesson_title} in your own words."),
            ("See and try", f"Compare a small diagram with a worked example so the visual pattern and the symbolic step support each other.", f"Match the visual cue to the example step."),
            ("Practice with support", f"Try a short exercise, use feedback to repair the first mistake, and connect the move back to the concept.", f"Solve a simple {lesson_title} example step by step."),
            ("Wrap and check", f"Summarize the idea, listen to or read a quick recap, and answer one checkpoint to confirm transfer.", f"Explain when this {topic} method should be used."),
        ]
        modality_sequence = ["explanation", "visual", "practice", "recap"]

    blueprint = models.LessonBlueprint(
        lesson_id=f"lesson:{req.learner_id}:{uuid4()}",
        topic=topic,
        selected_lesson=selected_lesson or None,
        learning_objective=f"Understand {lesson_title} as part of {topic}.",
        lesson_summary=f"This lesson teaches {lesson_title} through a {learning_style.lower()} experience.",
        learning_style=learning_style,
        lesson_structure=[
            {"title": title, "explanation": explanation, "example": example, "concept_connection": concept, "checkpoint": checkpoint}
            for title, explanation, checkpoint in sections
            for example, concept in [(checkpoint, f"This step supports the lesson objective: understand {lesson_title}.")]
        ],
        modality_sequence=modality_sequence,
        interaction_points=[{"prompt": f"Explain the hardest part of {topic} in your own words."}],
        assessment_points=[{"prompt": f"Explain the key idea from {lesson_title} and solve a short example."}],
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
