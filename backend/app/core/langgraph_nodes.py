from typing import Any, Dict
import logging
import json
import re

from pydantic import ValidationError

from app.core import models
from app.ai.factory import get_provider
from app.ai.router import ModelRouter
from app.core.chroma_client import ChromaClient
from app.core.config import settings


provider = get_provider()
chroma = ChromaClient()
logger = logging.getLogger(__name__)


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


def _fallback_lesson(learner_id: str, topic: str) -> models.LessonBlueprint:
    return models.LessonBlueprint(
        lesson_id=f"lesson:{learner_id}:{topic}",
        lesson_structure=[
            {
                "step": 1,
                "activity": f"Build intuition for {topic}",
                "content": f"Start with the core idea of {topic}. Try the vectors [1, 0], [0, 1], and [1, 1] in the visualizer.",
            },
            {
                "step": 2,
                "activity": "Apply a transformation",
                "content": "Use the matrix [[1, 1], [0, 1]] and compare each original vector with its transformed image.",
            },
            {
                "step": 3,
                "activity": "Check understanding",
                "content": "Explain what changed, what stayed fixed, and how the determinant affects area.",
            },
        ],
        modality_sequence=["text", "visual", "interactive"],
        interaction_points=[{"step": 2, "type": "matrix_visualization"}],
        assessment_points=[{"step": 3, "type": "reflection"}],
        estimated_lesson_duration=12,
    )


def _fallback_strategy() -> models.TeachingStrategy:
    return models.TeachingStrategy(
        strategy_type="scaffolded",
        recommended_modalities=["text", "visual", "interactive"],
        difficulty_level="adaptive",
        pacing_strategy="moderate",
        interaction_density="medium",
    )


async def learner_agent(profile_or_state: Any) -> models.LearnerState:
    if isinstance(profile_or_state, models.LearnerState):
        return profile_or_state
    profile = profile_or_state
    state = models.LearnerState(
        learner_id=profile.learner_id,
        knowledge_level=profile.topic_familiarity or "novice",
        preferred_modalities=profile.preferred_modality,
        confidence_score=0.5,
        engagement_score=0.5,
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
        logger.warning("Pedagogy generation failed; using the default strategy: %s", exc)
        return _fallback_strategy()

    try:
        payload = _json_from_model_text(text)
        # Normalize
        normalized = {}
        # Ensure we capture all required fields even if missing from model response
        # Defaulting missing values to prevent ValidationError
        normalized["strategy_type"] = payload.get("strategy_type") or payload.get("strategyType") or "scaffolded"
        normalized["recommended_modalities"] = payload.get("recommended_modalities") or payload.get("recommendedModalities") or ["text"]
        normalized["difficulty_level"] = payload.get("difficulty_level") or payload.get("difficultyLevel") or "adaptive"
        normalized["pacing_strategy"] = payload.get("pacing_strategy") or payload.get("pacingStrategy") or "moderate"
        normalized["interaction_density"] = payload.get("interaction_density") or payload.get("interactionDensity") or "medium"

        return models.TeachingStrategy(**normalized)
    except (ValueError, TypeError, ValidationError) as exc:
        logger.warning("Pedagogy response was invalid (%s); using the default strategy", exc)
        return _fallback_strategy()


async def lesson_planning_agent(req: models.GenerateLessonRequest) -> models.LessonBlueprint:
    prompt = (
        f"Create a lesson blueprint for learner {req.learner_id} on topic {req.topic}."
        " Return ONLY a JSON object with the following fields: 'lesson_id', 'lesson_structure' (list of dicts), 'modality_sequence' (list of strings), 'interaction_points' (list of dicts), 'assessment_points' (list of dicts), and 'estimated_lesson_duration' (int)."
    )
    messages = [{"role": "user", "content": prompt}]
    try:
        resp = await provider.call_chat_model(messages, model=ModelRouter.get_model("planning"))
        text = resp["choices"][0]["message"]["content"]
    except Exception as exc:
        logger.warning("Lesson planning failed; using the default lesson: %s", exc)
        return _fallback_lesson(req.learner_id, req.topic)

    try:
        payload = _json_from_model_text(text)
        blueprint = models.LessonBlueprint(**payload)
    except (ValueError, TypeError, ValidationError) as exc:
        logger.warning("Lesson response was invalid (%s); using the default lesson", exc)
        return _fallback_lesson(req.learner_id, req.topic)

    try:
        docs = [json.dumps(blueprint.model_dump())]
        metas = [{"learner_id": req.learner_id, "topic": req.topic}]
        await chroma.add_documents("lessons", docs, metas, ids=[blueprint.lesson_id])
    except Exception as exc:
        logger.warning("Lesson embedding persistence failed: %s", exc)

    return blueprint


async def content_generation_agent(blueprint: models.LessonBlueprint) -> models.GeneratedContent:
    assets = []
    for index, step in enumerate(blueprint.lesson_structure):
        step_id = step.get('step') or str(index)
        prompt = f"Generate explanation for step {step}. Keep it concise and instructive."
        messages = [{"role": "user", "content": prompt}]
        try:
            resp = await provider.call_chat_model(messages, model=ModelRouter.get_model("content"))
            content = resp["choices"][0]["message"]["content"]
        except Exception:
            content = step.get("content") or step.get("activity") or "Practice the concept with the interactive visualization."
        assets.append({"id": f"asset:{blueprint.lesson_id}:{step_id}", "type": "text", "content": content})

    try:
        docs = [a["content"] for a in assets]
        metas = [{"lesson_id": blueprint.lesson_id, "type": a["type"]} for a in assets]
        ids = [a["id"] for a in assets]
        await chroma.add_documents("lesson_assets", docs, metas, ids=ids)
    except Exception as exc:
        logger.warning("Lesson asset embedding persistence failed: %s", exc)

    return models.GeneratedContent(lesson_assets=assets)


async def interactive_agent(state: Dict[str, Any]) -> Dict[str, Any]:
    return {"status": "interactive-ready"}


async def assessment_agent(sub: models.AssessmentSubmission) -> models.AssessmentResult:
    scores = {}
    for qid, ans in sub.answers.items():
        if isinstance(ans, (str,)):
            try:
                messages = [{"role": "user", "content": f"Score the following answer on 0-1 scale for correctness. Return only a number: {ans}"}]
                resp = await provider.call_chat_model(messages, model=ModelRouter.get_model("assessment"), temperature=0.0, max_tokens=16)
                text = resp["choices"][0]["message"]["content"]
                score = max(0.0, min(1.0, float(text.strip())))
            except Exception:
                score = 0.5
            scores[qid] = score
        else:
            scores[qid] = 1.0

    return models.AssessmentResult(learner_id=sub.learner_id, session_id=sub.session_id, quiz_scores=scores, mastery_estimates=scores)


async def adaptation_agent(req: models.AdaptationRequest) -> models.AdaptationDecision:
    assessment = req.assessment_state.get("mastery_scores", {})
    weak = [k for k, v in assessment.items() if v < 0.7]
    decision = {"action": "remediate" if weak else "advance", "targets": weak}
    return models.AdaptationDecision(learner_id=req.learner_id, session_id=req.session_id, adaptations=decision)


async def evolutionary_agent(state: Dict[str, Any]) -> Dict[str, Any]:
    return {"status": "evolution-step-completed"}
