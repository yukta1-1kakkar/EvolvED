from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from app.core import models, repository, langgraph_nodes
from app.langgraph import graph as lg_graph
from typing import Any
from pydantic import BaseModel
from app.ai.factory import get_provider

provider = get_provider()
router = APIRouter()


@router.post("/learner-profile", response_model=models.LearnerState)
async def create_learner(profile: models.LearnerProfile):
    repo = repository.AsyncRepository()
    learner = await repo.upsert_learner(profile)
    state = await langgraph_nodes.learner_agent(learner)
    return state


@router.post("/generate-lesson", response_model=models.LessonBlueprint)
async def generate_lesson(req: models.GenerateLessonRequest):
    # run full orchestration for this learner+topic
    learner_profile = models.LearnerProfile(
        learner_id=req.learner_id,
        topic=req.topic,
    )
    package = await lg_graph.generate_for_learner(learner_profile, req.topic)
    return package["lesson_blueprint"]


@router.post("/submit-assessment", response_model=models.AssessmentResult)
async def submit_assessment(sub: models.AssessmentSubmission):
    result = await langgraph_nodes.assessment_agent(sub)
    return result


@router.post("/adapt-learning", response_model=models.AdaptationDecision)
async def adapt_learning(req: models.AdaptationRequest):
    decision = await langgraph_nodes.adaptation_agent(req)
    return decision


@router.post("/retrieve-memory")
async def retrieve_memory(q: models.RetrieveMemoryRequest):
    from app.core.chroma_client import ChromaClient
    cc = ChromaClient()
    hits = await cc.semantic_search("lessons", q.query, top_k=5)
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
