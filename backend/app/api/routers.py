import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from app.core import models, repository, langgraph_nodes
from app.core.audio_generator import generate_lesson_audio, synthesize_lesson_speech
from app.core.media import MEDIA_ROOT
from app.langgraph import graph as lg_graph
from typing import Any
from pydantic import BaseModel
from app.ai.factory import get_provider

provider = get_provider()
router = APIRouter()
logger = logging.getLogger(__name__)


def _cleanup_media_assets(lesson: models.LessonBlueprint, assets: list[dict[str, Any]]) -> None:
    for asset in assets:
        for field in ("audioUrl",):
            filename = Path(str(asset.get(field) or "")).name
            if filename:
                (MEDIA_ROOT / filename).unlink(missing_ok=True)
        if asset in lesson.visualElements:
            lesson.visualElements.remove(asset)


async def _finalize_lesson_media(lesson: models.LessonBlueprint) -> None:
    style = langgraph_nodes._lesson_style_key(lesson.learning_style or "")
    logger.info("Lesson multimedia finalization request: lesson_id=%s learning_style=%s", lesson.lesson_id, style)

    generated_assets: list[dict[str, Any]] = []
    try:
        if style == "auditory":
            try:
                audio_asset = await generate_lesson_audio(lesson, provider)
                generated_assets.append(audio_asset)
                lesson.visualElements.append(audio_asset)
            except Exception as exc:
                logger.warning(
                    "Lesson stored audio generation failed; continuing with narration text fallback: lesson_id=%s error=%s",
                    lesson.lesson_id,
                    exc,
                )
    except Exception:
        _cleanup_media_assets(lesson, generated_assets)
        logger.exception("Lesson multimedia finalization failed and generated assets were cleaned up: lesson_id=%s", lesson.lesson_id)
        raise

    audio = [item for item in lesson.visualElements if item.get("type") == "audio" and item.get("audioUrl")]
    visuals = [item for item in lesson.visualElements if item.get("type") != "audio"]
    try:
        if style == "visual" and (not visuals or not lesson.diagramDescriptions):
            raise RuntimeError("Visual lesson is incomplete: visual assets and diagrams are required")
        if style == "auditory" and not (lesson.audioNarration or lesson.ttsContent):
            raise RuntimeError("Auditory lesson is incomplete: narration text is required")
        if style == "reading_writing" and not lesson.lesson_structure:
            raise RuntimeError("Reading/writing lesson is incomplete: structured written explanations are required")
        if not lesson.lesson_structure:
            raise RuntimeError("Lesson is incomplete: structured written explanations are required")
    except Exception:
        _cleanup_media_assets(lesson, generated_assets)
        logger.exception("Lesson modality validation failed and generated assets were cleaned up: lesson_id=%s", lesson.lesson_id)
        raise
    logger.info(
        "Lesson multimedia finalization response: lesson_id=%s audio=%s visuals=%s practice=%s",
        lesson.lesson_id,
        len(audio),
        len(visuals),
        len(lesson.practiceExercises),
    )


async def _retry_database(operation, label: str, attempts: int = 3):
    last_error = None
    for attempt in range(attempts):
        try:
            return await operation()
        except Exception as exc:
            last_error = exc
            if attempt == attempts - 1:
                break
            delay = 0.5 * (2**attempt)
            logger.warning("Database %s attempt %s/%s failed; retrying in %.1fs: %s", label, attempt + 1, attempts, delay, exc)
            await asyncio.sleep(delay)
    raise RuntimeError(f"Database {label} failed after {attempts} attempts: {last_error}") from last_error


async def _learner_context(repo: repository.AsyncRepository, learner_id: str):
    async def load():
        profile = await repo.get_learner_profile(learner_id)
        state = await repo.get_learner_state(learner_id)
        return profile, state

    return await _retry_database(load, "learner context load")


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
    try:
        learner_profile, learner_state = await _learner_context(repo, req.learner_id)
        roadmap_topic = req.topic.strip() or learner_profile.topic or learner_profile.learning_goal or "foundational learning"
        selected_lesson = req.selected_lesson or (req.constraints or {}).get("selected_lesson")
        lesson_topic = (
            str(selected_lesson.get("title")).strip()
            if isinstance(selected_lesson, dict) and selected_lesson.get("title")
            else roadmap_topic
        )
        constraints = {
            **(req.constraints or {}),
            "roadmap_topic": roadmap_topic,
            "selected_lesson": selected_lesson,
            "adaptation_context": learner_state.adaptation_history[-1:] or [],
        }
        package = await lg_graph.generate_lesson_package(learner_profile, learner_state, lesson_topic, constraints)
        lesson = package["lesson"]
        await _finalize_lesson_media(lesson)
        await _retry_database(
            lambda: repo.persist_lesson(req.learner_id, lesson, {
                "teaching_strategy": package["teaching_strategy"].model_dump(),
                "generated_content": package["generated_content"].model_dump(),
            }),
            "lesson persistence",
        )
        return lesson
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/generate-roadmap", response_model=models.LessonRoadmapResponse)
async def generate_roadmap(req: models.GenerateLessonRequest):
    repo = repository.AsyncRepository()
    try:
        learner_profile, learner_state = await _learner_context(repo, req.learner_id)
        topic = req.topic.strip() or learner_profile.topic or learner_profile.learning_goal or "foundational learning"
        constraints = {**(req.constraints or {}), "adaptation_context": learner_state.adaptation_history[-1:] or []}
        roadmap = await lg_graph.generate_roadmap(learner_profile, learner_state, topic, constraints)
        await _retry_database(lambda: repo.persist_roadmap(req.learner_id, roadmap), "roadmap persistence")
        return roadmap
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
        session_state = await repo.get_session_state(sub.learner_id, sub.session_id)
        result = await langgraph_nodes.assessment_agent(sub, session_state)
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
        try:
            await repo.save_interaction(req, answer)
        except Exception as exc:
            logger.warning("Tutor interaction persistence failed; returning tutor answer anyway: session_id=%s error=%s", req.session_id, exc)
        try:
            await langgraph_nodes._persist_lesson_embedding(
                models.LessonBlueprint(**session_state["lesson"]),
                req.learner_id,
                f"interaction:{req.action}:{req.question}:{answer.answer}",
            )
        except Exception as exc:
            logger.warning("Tutor interaction embedding failed; returning tutor answer anyway: session_id=%s error=%s", req.session_id, exc)
        return answer
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/retrieve-memory")
async def retrieve_memory(q: models.RetrieveMemoryRequest):
    from app.core.chroma_client import ChromaClient
    cc = ChromaClient()
    hits = await cc.semantic_search(langgraph_nodes.lesson_embedding_collection(), q.query, top_k=5, where={"learner_id": q.learner_id})
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
    logger.info("Lesson audio generation request: text_length=%s voice=%s", len(req.text), req.voice or "Joanna")
    try:
        audio, content_type, _, source = await synthesize_lesson_speech(req.text, provider, voice=req.voice or "Joanna")
        logger.info("Lesson audio generation response: bytes=%s content_type=%s source=%s", len(audio), content_type, source)
        return Response(content=audio, media_type=content_type, headers={"Accept-Ranges": "bytes", "Cache-Control": "no-store"})
    except Exception as exc:
        detail = str(exc)
        logger.exception("Lesson TTS synthesis failed")
        raise HTTPException(status_code=503, detail=f"Lesson audio synthesis is temporarily unavailable: {detail}") from exc
