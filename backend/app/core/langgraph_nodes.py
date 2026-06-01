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
    prompt = (
        f"Create learner-facing lesson content for learner {req.learner_id}."
        f" Overall topic: {req.topic}. Selected lesson: {json.dumps(selected_lesson) if selected_lesson else lesson_title}."
        f" Lesson objectives: {json.dumps(lesson_objectives)}."
        f" Learner state: {learner_state.model_dump_json()}."
        f" Teaching strategy selected by the pedagogy agent: {teaching_strategy.model_dump_json()}."
        f" Additional constraints: {json.dumps(req.constraints or {})}."
        " Return ONLY a JSON object with these fields: 'lesson_id', 'topic', 'selected_lesson',"
        " 'learning_objective', 'lesson_summary', 'lesson_structure' (list of dicts),"
        " 'modality_sequence' (list of strings), 'interaction_points' (list of dicts),"
        " 'assessment_points' (list of dicts), and 'estimated_lesson_duration' (int)."
        " Return 4 to 6 lesson_structure items. Each item must contain 'title', 'explanation',"
        " 'example', 'concept_connection', and 'checkpoint'. Write complete learner-facing"
        " explanations that teach foundational concepts before applications. Adapt examples to the learner's level,"
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
            blueprint = candidate
            break
        except Exception as exc:
            if attempt == 1:
                logger.warning("Lesson planning model unavailable; using structured lesson fallback: %s", exc)
                blueprint = _fallback_blueprint(req)
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
        if len(str(section.get("explanation", "")).strip()) < 80:
            raise ValueError(f"lesson_structure item {index + 1} needs a complete explanation")
    serialized = json.dumps(blueprint.model_dump()).lower()
    placeholders = ["[topic]", "[concept]", "todo", "insert topic", "placeholder"]
    found = next((placeholder for placeholder in placeholders if placeholder in serialized), None)
    if found:
        raise ValueError(f"blueprint contains unresolved placeholder {found}")


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
    prompt = (
        "Generate an adaptive quiz for this lesson. Return JSON only with a 'questions' list of 4 items. "
        "Use a mix of mcq, short_answer, and conceptual_reasoning. Every item must include id, type, prompt, "
        "expected_answer, concept, and explanation. MCQ items must also include options. "
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
        questions = _fallback_questions(lesson)
    return models.QuizResponse(quiz_id=f"quiz:{uuid4()}", session_id=req.session_id, questions=questions)


async def assessment_agent(sub: models.AssessmentSubmission, session_state: Dict[str, Any] | None = None) -> models.AssessmentResult:
    lesson = (session_state or {}).get("lesson", {})
    assessment_context = {
        "selected_lesson": lesson.get("selected_lesson"),
        "learning_objective": lesson.get("learning_objective"),
        "assessment_points": lesson.get("assessment_points"),
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


def _fallback_blueprint(req: models.GenerateLessonRequest) -> models.LessonBlueprint:
    topic = req.topic
    selected_lesson = req.selected_lesson or {}
    lesson_title = selected_lesson.get("title") or topic
    sections = [
        ("Build the core idea", f"{lesson_title} starts with the meaning behind the notation and the reason each step is valid. Focus on naming the quantities, seeing what changes, and explaining the idea in plain language.", f"State the central idea of {lesson_title} in your own words."),
        ("Work through an example", f"Use a small example of {lesson_title}, label each quantity, and explain why each operation follows from the previous one before moving to shortcuts.", f"Solve a simple {lesson_title} example step by step."),
        ("Compare representations", f"Look at the same {topic} idea through words, symbols, and a worked example so the concept is not tied to one format.", f"Translate one {lesson_title} example into another representation."),
        ("Check and extend understanding", f"Summarize the lesson, test it with a fresh case, and name one condition that would change the method or result.", f"Explain when this {topic} method should be used."),
    ]
    return models.LessonBlueprint(
        lesson_id=f"lesson:{req.learner_id}:{uuid4()}",
        topic=topic,
        selected_lesson=selected_lesson or None,
        learning_objective=f"Understand {lesson_title} as part of {topic}.",
        lesson_summary=f"This lesson teaches {lesson_title} with concept-first explanations, examples, and checks for understanding.",
        lesson_structure=[
            {"title": title, "explanation": explanation, "example": example, "concept_connection": concept, "checkpoint": checkpoint}
            for title, explanation, checkpoint in sections
            for example, concept in [(checkpoint, f"This step supports the lesson objective: understand {lesson_title}.")]
        ],
        modality_sequence=["text", "example", "practice", "reflection"],
        interaction_points=[{"prompt": f"Explain the hardest part of {topic} in your own words."}],
        assessment_points=[{"prompt": f"Explain the key idea from {lesson_title} and solve a short example."}],
        estimated_lesson_duration=35,
    )


def _fallback_questions(lesson: Dict[str, Any]) -> list[Dict[str, Any]]:
    topic = lesson.get("topic", "the topic")
    sections = lesson.get("lesson_structure") or []
    return [
        {
            "id": f"checkpoint-{index + 1}",
            "type": "conceptual_reasoning" if index else "short_answer",
            "prompt": section.get("checkpoint") or f"Explain the key idea from {section.get('title', topic)}.",
            "expected_answer": section.get("explanation", ""),
            "concept": section.get("title", topic),
            "explanation": section.get("project_connection", ""),
        }
        for index, section in enumerate(sections[:4])
    ]


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
