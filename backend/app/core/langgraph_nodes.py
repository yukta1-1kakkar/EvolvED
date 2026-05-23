from typing import Any, Dict
from app.core import models
import asyncio
from app.ai.openai_client import call_chat_model, create_embedding
from app.core.chroma_client import ChromaClient
from app.core.config import settings


chroma = ChromaClient()


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


async def learner_agent(profile_or_state: Any) -> models.LearnerState:
    if isinstance(profile_or_state, models.LearnerState):
        return profile_or_state
    profile = profile_or_state
    # Simple initialization; could be extended with historical DB queries
    state = models.LearnerState(
        learner_id=profile.learner_id,
        knowledge_level=profile.topic_familiarity or "novice",
        preferred_modalities=profile.preferred_modality,
        confidence_score=0.5,
        engagement_score=0.5,
    )
    return state


async def pedagogy_agent(state: Dict[str, Any]) -> models.TeachingStrategy:
    # Build a detailed prompt for pedagogical reasoning using the required schema
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
        resp = await call_chat_model(messages, model=settings.pedagogy_model, temperature=0.0)
        text = resp["choices"][0]["message"]["content"]
    except Exception:
        text = "{}"
    import json

    try:
        payload = json.loads(text)
    except Exception:
        # Fallback heuristic parsing
        payload = {"strategy_type": "scaffolded", "recommended_modalities": ["text", "visual"], "difficulty_level": "adaptive", "pacing_strategy": "moderate", "interaction_density": "medium"}

    return models.TeachingStrategy(**payload)


async def lesson_planning_agent(req: models.GenerateLessonRequest) -> models.LessonBlueprint:
    prompt = (
        f"Create a lesson blueprint for learner {req.learner_id} on topic {req.topic}."
        " Provide steps, modality sequence, interaction points, assessment points, and estimated duration. Return JSON matching LessonBlueprint."
    )
    messages = [{"role": "user", "content": prompt}]
    try:
        resp = await call_chat_model(messages, model=settings.generation_model)
        text = resp["choices"][0]["message"]["content"]
    except Exception:
        return _fallback_lesson(req.learner_id, req.topic)
    import json

    try:
        payload = json.loads(text)
    except Exception:
        return _fallback_lesson(req.learner_id, req.topic)

    # Optionally persist lesson blueprint embeddings to Chroma
    try:
        docs = [text]
        metas = [{"learner_id": req.learner_id, "topic": req.topic}]
        await chroma.add_documents("lessons", docs, metas, ids=[payload.get("lesson_id")])
    except Exception:
        pass

    return models.LessonBlueprint(**payload)


async def content_generation_agent(blueprint: models.LessonBlueprint) -> models.GeneratedContent:
    # Generate text explanations and examples for each step using fast model
    assets = []
    for step in blueprint.lesson_structure:
        prompt = f"Generate explanation for step {step}. Keep it concise and instructive."
        messages = [{"role": "user", "content": prompt}]
        try:
            resp = await call_chat_model(messages, model=settings.generation_model)
            content = resp["choices"][0]["message"]["content"]
        except Exception:
            content = step.get("content") or step.get("activity") or "Practice the concept with the interactive visualization."
        assets.append({"id": f"asset:{blueprint.lesson_id}:{step.get('step')}", "type": "text", "content": content})

    # store content embeddings
    try:
        docs = [a["content"] for a in assets]
        metas = [{"lesson_id": blueprint.lesson_id, "type": a["type"]} for a in assets]
        ids = [a["id"] for a in assets]
        await chroma.add_documents("lesson_assets", docs, metas, ids=ids)
    except Exception:
        pass

    return models.GeneratedContent(lesson_assets=assets)


async def interactive_agent(state: Dict[str, Any]) -> Dict[str, Any]:
    return {"status": "interactive-ready"}


async def assessment_agent(sub: models.AssessmentSubmission) -> models.AssessmentResult:
    # Use LLM to grade free-text answers when needed
    scores = {}
    for qid, ans in sub.answers.items():
        if isinstance(ans, (str,)):
            messages = [{"role": "user", "content": f"Score the following answer on 0-1 scale for correctness: {ans}"}]
            resp = await call_chat_model(messages, model=settings.generation_model, temperature=0.0)
            text = resp["choices"][0]["message"]["content"]
            try:
                score = float(text.strip())
            except Exception:
                score = 1.0
            scores[qid] = score
        else:
            scores[qid] = 1.0

    return models.AssessmentResult(learner_id=sub.learner_id, session_id=sub.session_id, quiz_scores=scores, mastery_estimates=scores)


async def adaptation_agent(req: models.AdaptationRequest) -> models.AdaptationDecision:
    # Simple rule-based adaptation; in future use LLM to synthesize optimal interventions
    assessment = req.assessment_state.get("mastery_scores", {})
    weak = [k for k, v in assessment.items() if v < 0.7]
    decision = {"action": "remediate" if weak else "advance", "targets": weak}
    return models.AdaptationDecision(learner_id=req.learner_id, session_id=req.session_id, adaptations=decision)


async def evolutionary_agent(state: Dict[str, Any]) -> Dict[str, Any]:
    # Placeholder for evolutionary optimization using embeddings and performance data
    return {"status": "evolution-step-completed"}
