from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from app.core import models, repository, langgraph_nodes
from app.langgraph import graph as lg_graph
from typing import Any
from pydantic import BaseModel
from app.ai.factory import get_provider

provider = get_provider()
router = APIRouter()


@router.post("/auth/signup", response_model=models.AuthUser)
async def signup(req: models.SignupRequest):
    try:
        return await repository.AsyncRepository().register_learner(req)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/auth/login", response_model=models.AuthUser)
async def login(req: models.LoginRequest):
    try:
        return await repository.AsyncRepository().authenticate(req)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/learner-profile", response_model=models.LearnerState)
async def create_learner(profile: models.LearnerProfile):
    repo = repository.AsyncRepository()
    learner = await repo.upsert_learner(profile)
    state = await langgraph_nodes.learner_agent(learner)
    return state


@router.post("/generate-lesson", response_model=models.LessonBlueprint)
async def generate_lesson(req: models.GenerateLessonRequest):
    repo = repository.AsyncRepository()
    learner_profile = await repo.get_learner_profile(req.learner_id)
    learner_state = await repo.get_learner_state(req.learner_id)
    topic = req.topic.strip() or learner_profile.topic or learner_profile.learning_goal or "foundational learning"
    try:
        constraints = {**(req.constraints or {}), "adaptation_context": learner_state.adaptation_history[-1:] or []}
        package = await lg_graph.generate_lesson_package(learner_profile, learner_state, topic, req.project_context or learner_profile.learning_project, constraints)
        lesson = package["lesson"]
        await repo.persist_lesson(req.learner_id, lesson, {
            "teaching_strategy": package["teaching_strategy"].model_dump(),
            "generated_content": package["generated_content"].model_dump(),
        })
        return lesson
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/teaching-strategy", response_model=models.TeachingStrategy)
async def get_teaching_strategy(req: models.GenerateLessonRequest):
    repo = repository.AsyncRepository()
    learner_profile = await repo.get_learner_profile(req.learner_id)
    topic = req.topic.strip() or learner_profile.topic or learner_profile.learning_goal or "foundational learning"
    try:
        return await lg_graph.generate_strategy(learner_profile, topic)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/submit-assessment", response_model=models.AssessmentResult)
async def submit_assessment(sub: models.AssessmentSubmission):
    repo = repository.AsyncRepository()
    try:
        result = await langgraph_nodes.assessment_agent(sub)
        state = await repo.get_learner_state(sub.learner_id)
        decision = await langgraph_nodes.adaptation_agent(models.AdaptationRequest(learner_id=sub.learner_id, session_id=sub.session_id, assessment_state=result.model_dump()))
        evolved = await langgraph_nodes.evolutionary_agent({"learner_model": state.model_dump(), "assessment": result.model_dump(), "adaptation": decision.adaptations})
        result.adaptation = decision.adaptations
        await repo.save_assessment_and_evolve(sub, result, decision, evolved)
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/adapt-learning", response_model=models.AdaptationDecision)
async def adapt_learning(req: models.AdaptationRequest):
    try:
        return await langgraph_nodes.adaptation_agent(req)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/generate-quiz", response_model=models.QuizResponse)
async def generate_quiz(req: models.GenerateQuizRequest):
    repo = repository.AsyncRepository()
    session_state = await repo.get_session_state(req.learner_id, req.session_id)
    if not session_state:
        raise HTTPException(status_code=404, detail="Lesson session was not found.")
    try:
        quiz = await langgraph_nodes.quiz_agent(req, session_state)
        await repo.save_quiz(req.learner_id, quiz, (session_state.get("lesson") or {}).get("topic"))
        return quiz
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/tutor-interaction", response_model=models.TutorInteractionResponse)
async def tutor_interaction(req: models.TutorInteractionRequest):
    repo = repository.AsyncRepository()
    session_state = await repo.get_session_state(req.learner_id, req.session_id)
    if not session_state:
        raise HTTPException(status_code=404, detail="Lesson session was not found.")
    try:
        answer = await langgraph_nodes.interactive_agent(req, session_state)
        await repo.save_interaction(req, answer)
        await langgraph_nodes._persist_lesson_embedding(
            models.LessonBlueprint(**session_state["lesson"]),
            req.learner_id,
            f"interaction:{req.action}:{req.question}:{answer.answer}",
        )
        return answer
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/retrieve-memory")
async def retrieve_memory(q: models.RetrieveMemoryRequest):
    from app.core.chroma_client import ChromaClient
    cc = ChromaClient()
    hits = await cc.semantic_search("lessons", q.query, top_k=5, where={"learner_id": q.learner_id})
    return {"results": hits}


@router.post("/save-lesson")
async def save_lesson(req: models.SaveLessonRequest):
    """Persist updated lesson structure to the DB (sessions.state JSON).

    This will create a learner record if missing and upsert a session by lesson_id.
    """
    repo = repository.AsyncRepository()
    try:
        res = await repo.save_lesson_blueprint(req.learner_id, req.lesson_id, req.updated_structure)
        return {"status": "ok", "saved": res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/curriculum")
async def get_curriculum():
    import json
    from pathlib import Path

    p = Path(__file__).resolve().parents[2] / "data" / "initial_curriculum.json"
    if not p.exists():
        return {"items": []}
    with open(p, "r", encoding="utf-8") as f:
        items = json.load(f)
    return {"items": items}


@router.get("/progress", response_model=models.ProgressResponse)
async def get_progress(learner_id: str):
    repo = repository.AsyncRepository()
    prog = await repo.get_progress(learner_id)
    return prog


@router.get("/analytics", response_model=models.AnalyticsResponse)
async def get_analytics(learner_id: str):
    repo = repository.AsyncRepository()
    return await repo.get_analytics(learner_id)


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None


@router.post("/tts")
async def tts(req: TTSRequest):
    try:
        # Note: This assumes the provider has a synthesize_speech method.
        # If using Gemini (which doesn't have TTS), we might need to handle this
        # or use the BedrockProvider explicitly if the active provider is Gemini.
        if hasattr(provider, "synthesize_speech"):
            audio = await provider.synthesize_speech(req.text, voice=req.voice or "Joanna")
        else:
            # Fallback or error handling
            from app.ai.bedrock_provider import BedrockProvider
            fallback_provider = BedrockProvider()
            audio = await fallback_provider.synthesize_speech(req.text, voice=req.voice or "Joanna")
        return Response(content=audio, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
