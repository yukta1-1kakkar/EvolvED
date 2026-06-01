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
    project_context = req.project_context or f"a practical {req.topic} project"
    prompt = (
        f"Create a lesson blueprint for learner {req.learner_id} on the literal topic: {req.topic}."
        f" The learner will apply the lesson in this literal project: {project_context}."
        f" Learner state: {learner_state.model_dump_json()}."
        f" Teaching strategy selected by the pedagogy agent: {teaching_strategy.model_dump_json()}."
        f" Additional constraints: {json.dumps(req.constraints or {})}."
        " Return ONLY a JSON object with these fields: 'lesson_id', 'topic', 'project_context',"
        " 'learning_objective', 'lesson_summary', 'lesson_structure' (list of dicts),"
        " 'modality_sequence' (list of strings), 'interaction_points' (list of dicts),"
        " 'assessment_points' (list of dicts), and 'estimated_lesson_duration' (int)."
        " Return 4 to 6 lesson_structure items. Each item must contain 'title', 'explanation',"
        " 'example', 'project_connection', and 'checkpoint'. Write complete learner-facing"
        " explanations that teach the topic, not a plan for teaching it. Use the project throughout"
        " to make the lesson concrete. Include learner-facing prompts in interaction_points and assessment_points."
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
                blueprint = _fallback_blueprint(req, project_context)
                break
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"The previous blueprint was unusable: {exc}. Regenerate complete JSON for the literal topic "
                        f"{req.topic} applied to the literal project {project_context}. Replace every placeholder with learner-facing content."
                    ),
                }
            )

    if blueprint is None:
        raise RuntimeError("Lesson planning agent did not produce a blueprint.")

    asyncio.create_task(_persist_lesson_embedding(blueprint, req.learner_id, req.topic))

    return blueprint


def _validate_blueprint(blueprint: models.LessonBlueprint):
    if len(blueprint.lesson_structure) < 4:
        raise ValueError("lesson_structure must contain at least four learning steps")
    if not blueprint.topic.strip() or not blueprint.project_context.strip():
        raise ValueError("topic and project_context must be explicit")
    required_section_fields = {"title", "explanation", "example", "project_connection", "checkpoint"}
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
        answer = f"Here is a simpler way to think about it: {lesson.get('lesson_summary', '')} Focus on this project connection: {lesson.get('project_context', '')}."
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


async def assessment_agent(sub: models.AssessmentSubmission) -> models.AssessmentResult:
    prompt = (
        "Evaluate this learner assessment. Return JSON only with quiz_scores (object of 0-1 scores keyed by question), "
        "mastery_estimates (object of 0-1 concept scores), score (0-1 overall), strengths (list), weaknesses (list), "
        "misconceptions (list), and detailed_feedback (string). "
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


def _fallback_blueprint(req: models.GenerateLessonRequest, project_context: str) -> models.LessonBlueprint:
    topic = req.topic
    sections = [
        ("Build the core idea", f"{topic} becomes useful when you can describe its central idea in plain language and recognize what changes in a real situation.", f"Identify the inputs, outputs, and one changing quantity in {project_context}."),
        ("Work through an example", f"Start with a small example of {topic}, label each quantity, and explain why each step follows from the previous one.", f"Create one simplified example from {project_context} and solve it step by step."),
        ("Connect the idea to the project", f"Now apply {topic} directly to the project. Compare two possible choices and explain how the concept helps you decide between them.", f"Use {topic} to compare two design choices for {project_context}."),
        ("Check and extend your understanding", f"Summarize the concept, test it with a fresh case, and name one assumption that could change your result.", f"Explain how you would validate your use of {topic} in {project_context}."),
    ]
    return models.LessonBlueprint(
        lesson_id=f"lesson:{req.learner_id}:{uuid4()}",
        topic=topic,
        project_context=project_context,
        learning_objective=f"Understand {topic} and apply it to {project_context}.",
        lesson_summary=f"This lesson teaches {topic} through a practical project so each idea has a concrete use.",
        lesson_structure=[
            {"title": title, "explanation": explanation, "example": example, "project_connection": project, "checkpoint": checkpoint}
            for title, explanation, checkpoint in sections
            for example, project in [(checkpoint, f"Keep connecting each decision back to {project_context}.")]
        ],
        modality_sequence=["text", "practice", "project_application", "reflection"],
        interaction_points=[{"prompt": f"Explain the hardest part of {topic} in your own words."}],
        assessment_points=[{"prompt": f"How would you use {topic} in {project_context}?"}],
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
