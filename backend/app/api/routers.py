import asyncio
import logging
import re
import zlib
import zipfile
from time import perf_counter
from datetime import datetime, timezone
from pathlib import Path
import io
import json
import xml.etree.ElementTree as ET

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from app.core import models, repository, langgraph_nodes
from app.core.guardrails import moderation_flags, redact_inappropriate_content
from app.core.audio_generator import generate_lesson_audio, synthesize_lesson_speech
from app.core.media import MEDIA_ROOT
from app.langgraph import graph as lg_graph
from typing import Any
from pydantic import BaseModel
from app.ai.factory import get_provider

provider = get_provider()
logger = logging.getLogger(__name__)
SESSION_COOKIE = "evolved_session"


async def _require_session(request: Request) -> None:
    if request.url.path in {"/auth/signup", "/auth/login"}:
        return
    token = request.cookies.get(SESSION_COOKIE, "")
    actor = await repository.AsyncRepository().authenticate_session(token) if token else None
    if not actor:
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")
    request.state.auth_user = actor


def _require_identity(request: Request, expected_id: str, role: str | None = None) -> None:
    actor = getattr(request.state, "auth_user", None) or {}
    if actor.get("id") != expected_id or (role and actor.get("role") != role):
        raise HTTPException(status_code=403, detail="You do not have permission to access this account data.")


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/",
    )


router = APIRouter(dependencies=[Depends(_require_session)])


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
            logger.warning("Database %s attempt %s/%s failed; retrying in %.1fs: %s: %r", label, attempt + 1, attempts, delay, type(exc).__name__, exc)
            await asyncio.sleep(delay)
    error_name = type(last_error).__name__ if last_error else "UnknownError"
    raise RuntimeError(f"Database {label} failed after {attempts} attempts: {error_name}: {last_error!r}") from last_error


def _normalize_generated_value(value: Any) -> Any:
    if isinstance(value, str):
        normalized = re.sub(r"\s{2,}", " ", re.sub(r"\s*\u2014\s*", ", ", value)).strip()
        return redact_inappropriate_content(normalized)
    if isinstance(value, list):
        return [_normalize_generated_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_generated_value(item) for key, item in value.items()}
    return value


def _normalize_generated_model(model):
    return model.__class__(**_normalize_generated_value(model.model_dump()))


def _updated_learner_model(
    current: dict[str, Any],
    assessment: models.AssessmentResult,
    adaptation: models.AdaptationDecision,
) -> dict[str, Any]:
    """Apply assessment signals to stored learner state; this is persistence logic, not an agent."""
    updated = dict(current)
    mastery = assessment.mastery_estimates
    history = [*(updated.get("adaptation_history") or []), adaptation.adaptations]
    scores = list(mastery.values())
    updated.update({
        "weak_topics": [key for key, value in mastery.items() if float(value) < 0.7],
        "strong_topics": [key for key, value in mastery.items() if float(value) >= 0.8],
        "confidence_score": sum(scores) / len(scores) if scores else updated.get("confidence_score", 0.0),
        "engagement_score": min(1.0, float(updated.get("engagement_score", 0.0)) + 0.1),
        "misconception_registry": assessment.misconceptions,
        "adaptation_history": history[-10:],
        "latest_adaptation": adaptation.adaptations,
    })
    return updated


async def _learner_context(repo: repository.AsyncRepository, learner_id: str):
    try:
        return await _retry_database(lambda: repo.get_learner_context(learner_id), "learner context load", attempts=1)
    except Exception as exc:
        logger.warning("Using default learner context because database is unavailable: learner_id=%s error=%s: %r", learner_id, type(exc).__name__, exc)
        return models.LearnerProfile(learner_id=learner_id), models.LearnerState(learner_id=learner_id)


@router.post("/auth/signup", response_model=models.AuthUser)
async def signup(req: models.SignupRequest, request: Request, response: Response):
    try:
        repo = repository.AsyncRepository()
        user = await repo.register_learner(req)
        _set_session_cookie(response, request, await repo.issue_auth_session(user))
        return user
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/auth/login", response_model=models.AuthUser)
async def login(req: models.LoginRequest, request: Request, response: Response):
    try:
        repo = repository.AsyncRepository()
        user = await repo.authenticate(req)
        _set_session_cookie(response, request, await repo.issue_auth_session(user))
        return user
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        await repository.AsyncRepository().revoke_auth_session(token)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.post("/classes", response_model=models.ClassSummary)
async def create_class(req: models.ClassCreateRequest, request: Request):
    _require_identity(request, req.leader_id, "module_leader")
    try:
        return await repository.AsyncRepository().create_class(req)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/classes/join", response_model=models.ClassSummary)
async def join_class(req: models.JoinClassRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    try:
        return await repository.AsyncRepository().join_class(req)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/student/classroom", response_model=models.StudentClassroomResponse)
async def student_classroom(request: Request, learner_id: str):
    _require_identity(request, learner_id, "student")
    try:
        return await repository.AsyncRepository().student_classroom(learner_id)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/student/notifications/stream")
async def student_notification_stream(request: Request, learner_id: str):
    _require_identity(request, learner_id, "student")
    async def events():
        repo = repository.AsyncRepository()
        initial = await repo.student_classroom(learner_id)
        known = {item.alert_id for item in initial.alerts}
        yield ": connected\n\n"
        while True:
            await asyncio.sleep(1)
            classroom = await repo.student_classroom(learner_id)
            fresh = [item for item in reversed(classroom.alerts) if item.alert_id not in known]
            for alert in fresh:
                known.add(alert.alert_id)
                yield f"event: notification\ndata: {alert.model_dump_json()}\n\n"
            if not fresh:
                yield ": heartbeat\n\n"

    try:
        await repository.AsyncRepository().student_classroom(learner_id)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/student/content/complete", response_model=models.PublishedContentCompletionResponse)
async def complete_published_content(req: models.PublishedContentCompletionRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    try:
        return await repository.AsyncRepository().complete_published_content(req)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/student/content/start")
async def start_published_content(req: models.PublishedContentCompletionRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    try:
        return await repository.AsyncRepository().start_published_content(req)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/student/content/page-timing")
async def record_published_content_page_timing(req: models.PublishedContentPageTimingRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    try:
        return await repository.AsyncRepository().record_published_content_page_timing(req)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/student/adaptive/page-timing")
async def record_adaptive_page_timing(req: models.AdaptivePageTimingRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    try:
        return await repository.AsyncRepository().record_adaptive_page_timing(req)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/teacher/dashboard", response_model=models.TeacherDashboardResponse)
async def teacher_dashboard(request: Request, leader_id: str):
    _require_identity(request, leader_id, "module_leader")
    try:
        return await repository.AsyncRepository().teacher_dashboard(leader_id)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/teacher/students/{student_id}/analytics", response_model=models.StudentAnalyticsResponse)
async def teacher_student_analytics(request: Request, student_id: str, leader_id: str):
    _require_identity(request, leader_id, "module_leader")
    try:
        return await repository.AsyncRepository().teacher_student_analytics(leader_id, student_id)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/content-drafts", response_model=models.ContentDraftResponse)
async def create_content_draft(req: models.ContentDraftRequest, request: Request):
    _require_identity(request, req.leader_id, "module_leader")
    try:
        return await repository.AsyncRepository().create_content_draft(req)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/content-drafts/upload", response_model=models.ContentDraftResponse)
async def upload_content_draft(
    request: Request,
    leader_id: str = Form(...),
    kind: str = Form(...),
    title: str = Form(...),
    class_id: str | None = Form(None),
    minimum_pass_percent: float | None = Form(None),
    notes: str = Form(""),
    file: UploadFile | None = File(None),
):
    _require_identity(request, leader_id, "module_leader")
    if kind not in {"lesson", "assessment"}:
        raise HTTPException(status_code=422, detail="Draft kind must be lesson or assessment.")
    source: dict[str, Any] = {"notes": notes.strip()}
    if kind == "assessment":
        threshold = max(0.0, min(100.0, float(minimum_pass_percent if minimum_pass_percent is not None else 50.0)))
        source["minimum_pass_percent"] = threshold
        source["minimum_pass_score"] = threshold / 100.0
    if file:
        content = await file.read()
        source.update(_uploaded_source(file.filename or "uploaded-source", content))
    if not source.get("text") and notes.strip():
        source["text"] = notes.strip()
    if not source.get("text"):
        source.update(_fallback_uploaded_source(title, file.filename if file else title))
    try:
        return await repository.AsyncRepository().create_content_draft(
            models.ContentDraftRequest(
                leader_id=leader_id,
                class_id=class_id or None,
                kind=kind,
                title=title,
                source_material=source,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/content-drafts/{draft_id}/approval", response_model=models.ContentDraftResponse)
async def approve_content_draft(draft_id: str, req: models.ApprovalRequest, request: Request):
    _require_identity(request, req.leader_id, "module_leader")
    try:
        return await repository.AsyncRepository().approve_content_draft(draft_id, req)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _uploaded_source(filename: str, content: bytes) -> dict[str, Any]:
    suffix = Path(filename).suffix.lower()
    extractors = {
        ".txt": _decode_text,
        ".md": _decode_text,
        ".markdown": _decode_text,
        ".docx": _extract_docx,
        ".pptx": _extract_pptx,
        ".pdf": _extract_pdf,
    }
    if suffix not in extractors:
        raise HTTPException(status_code=415, detail="Supported uploads: PDF, PPTX, DOCX, Markdown, and text.")
    try:
        text = _clean_extracted_text(extractors[suffix](content))
    except Exception as exc:
        logger.warning("Upload text extraction failed; using review scaffold: filename=%s error=%s: %r", filename, type(exc).__name__, exc)
        text = ""
    extraction_warning = ""
    if not _is_readable_source_text(text):
        if suffix == ".pdf" and _has_pdf_text_layer(text):
            extraction_warning = "PDF text was extracted with low confidence. Review the draft against the source before publishing."
        else:
            text = _fallback_source_text(filename, suffix)
            extraction_warning = (
                "This file did not expose selectable text to the server. The draft is a review scaffold from the file name; "
                "paste OCR text or notes for source-faithful content."
            )
    result = {
        "filename": Path(filename).name,
        "content_type": suffix.lstrip("."),
        "text": text[:60000],
        "characters": len(text),
    }
    if extraction_warning:
        result["extraction_warning"] = extraction_warning
    return result


def _fallback_uploaded_source(title: str, filename: str | None = None) -> dict[str, Any]:
    label = Path(filename or title or "draft source").stem
    suffix = Path(filename or "").suffix.lower().lstrip(".")
    text = _fallback_source_text(label, f".{suffix}" if suffix else ".txt")
    return {
        "filename": Path(filename).name if filename else "",
        "content_type": suffix or "text",
        "text": text,
        "characters": len(text),
        "extraction_warning": (
            "No selectable text reached the server. EvolvED generated a teacher-review scaffold from the draft title or file name; "
            "paste source text for a source-faithful lesson."
        ),
    }


def _decode_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def _extract_docx(content: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = [
                name for name in archive.namelist()
                if name.startswith("word/")
                and name.endswith(".xml")
                and not name.startswith(("word/theme/", "word/styles", "word/settings", "word/fontTable", "word/numbering"))
            ]
            preferred = [
                name for name in names
                if name in {"word/document.xml"} or name.startswith(("word/header", "word/footer", "word/footnotes", "word/endnotes", "word/comments"))
            ]
            return "\n".join(_xml_text(archive.read(name)) for name in (preferred or names))
    except zipfile.BadZipFile:
        return _decode_text(content)


def _extract_pptx(content: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        names = sorted(name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
        return "\n".join(_xml_text(archive.read(name)) for name in names)


def _xml_text(content: bytes) -> str:
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return ""
    values = [node.text.strip() for node in root.iter() if node.text and node.text.strip()]
    return " ".join(values)


def _extract_pdf(content: bytes) -> str:
    library_text = _extract_pdf_with_library(content)
    if library_text.strip():
        return library_text
    chunks: list[str] = []
    for stream in _pdf_streams(content):
        chunks.extend(_pdf_text_chunks(stream.decode("latin-1", errors="ignore")))
    if not chunks:
        chunks.extend(_pdf_text_chunks(content.decode("latin-1", errors="ignore")))
    return " ".join(chunks)


def _extract_pdf_with_library(content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    try:
        reader = PdfReader(io.BytesIO(content))
        return "\n".join((page.extract_text() or "").strip() for page in reader.pages)
    except Exception as exc:
        logger.warning("PDF library extraction failed; falling back to stream parser: %s: %r", type(exc).__name__, exc)
        return ""


def _pdf_streams(content: bytes) -> list[bytes]:
    streams = []
    for match in re.finditer(rb"<<(?P<meta>.*?)>>\s*stream\r?\n(?P<data>.*?)\r?\nendstream", content, flags=re.S):
        data = match.group("data").strip(b"\r\n")
        meta = match.group("meta")
        if b"/FlateDecode" in meta:
            try:
                data = zlib.decompress(data)
            except zlib.error:
                continue
        streams.append(data)
    return streams


def _pdf_text_chunks(value: str) -> list[str]:
    chunks: list[str] = []
    for array in re.findall(r"\[(.*?)\]\s*TJ", value, flags=re.S):
        parts = [_decode_pdf_string(item) for item in re.findall(r"\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>", array)]
        joined = "".join(part for part in parts if part)
        if joined.strip():
            chunks.append(joined)
    for token in re.findall(r"(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>)\s*(?:Tj|'|\")", value):
        decoded = _decode_pdf_string(token)
        if decoded.strip():
            chunks.append(decoded)
    return chunks


def _decode_pdf_string(token: str) -> str:
    if token.startswith("<"):
        raw_hex = re.sub(r"\s+", "", token.strip("<>"))
        if len(raw_hex) % 2:
            raw_hex += "0"
        try:
            data = bytes.fromhex(raw_hex)
        except ValueError:
            return ""
        for encoding in ("utf-16-be", "latin-1"):
            text = data.decode(encoding, errors="ignore")
            if sum(ch.isalpha() for ch in text) >= 3:
                return text
        return data.decode("latin-1", errors="ignore")
    body = token[1:-1]
    output = []
    index = 0
    escapes = {"n": "\n", "r": "\n", "t": "\t", "b": "", "f": "", "(": "(", ")": ")", "\\": "\\"}
    while index < len(body):
        char = body[index]
        if char != "\\":
            output.append(char)
            index += 1
            continue
        index += 1
        if index >= len(body):
            break
        escaped = body[index]
        if escaped in escapes:
            output.append(escapes[escaped])
            index += 1
            continue
        if escaped in "01234567":
            octal = escaped
            index += 1
            while index < len(body) and len(octal) < 3 and body[index] in "01234567":
                octal += body[index]
                index += 1
            output.append(chr(int(octal, 8)))
            continue
        output.append(escaped)
        index += 1
    return "".join(output)


def _clean_extracted_text(value: str) -> str:
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]+", " ", text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line).strip()


def _is_readable_source_text(value: str) -> bool:
    words = re.findall(r"[A-Za-z][A-Za-z-]{2,}", value)
    if len(words) < 20:
        return False
    lower = value.lower()
    pdf_markers = sum(lower.count(marker) for marker in (" obj", " endobj", " xref", " trailer", " linearized", " startxref"))
    digit_ratio = sum(char.isdigit() for char in value) / max(1, len(value))
    alpha_ratio = sum(char.isalpha() for char in value) / max(1, len(value))
    return not (
        value.startswith("PDF-")
        or pdf_markers >= 3
        or (digit_ratio > 0.28 and alpha_ratio < 0.45)
    )


def _has_pdf_text_layer(value: str) -> bool:
    words = re.findall(r"[A-Za-z][A-Za-z-]{2,}", value)
    alpha_ratio = sum(char.isalpha() for char in value) / max(1, len(value))
    return len(words) >= 12 and alpha_ratio >= 0.35


def _fallback_source_text(filename: str, suffix: str) -> str:
    title = _clean_extracted_text(re.sub(r"[_-]+", " ", Path(filename).stem)) or "uploaded PDF"
    file_type = suffix.lstrip(".").upper() or "file"
    return (
        f"The uploaded {file_type} is titled {title}. The file appears to be scanned, image based, or otherwise missing selectable text, "
        "so the server could not read the page text directly. Create a cautious lesson draft for teacher review with these parts: "
        "source overview, key vocabulary to extract from the chapter, guided reading steps, discussion prompts, practice activities, "
        "and an assessment checklist. The module leader should paste OCR text or teacher notes to make the final lesson fully faithful to the file."
    )


@router.post("/learner-profile", response_model=models.LearnerState)
async def create_learner(profile: models.LearnerProfile, request: Request):
    _require_identity(request, profile.learner_id, "student")
    repo = repository.AsyncRepository()
    learner = await repo.upsert_learner(profile)
    state = await langgraph_nodes.learner_agent(learner)
    return state


@router.post("/generate-lesson", response_model=models.LessonBlueprint)
async def generate_lesson(req: models.GenerateLessonRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
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
        lesson = _normalize_generated_model(package["lesson"])
        teaching_strategy = _normalize_generated_value(package["teaching_strategy"].model_dump())
        generated_content = _normalize_generated_value(package["generated_content"].model_dump())
        await _finalize_lesson_media(lesson)
        await _retry_database(
            lambda: repo.persist_lesson(req.learner_id, lesson, {
                "teaching_strategy": teaching_strategy,
                "generated_content": generated_content,
            }),
            "lesson persistence",
        )
        return lesson
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/generate-roadmap", response_model=models.LessonRoadmapResponse)
async def generate_roadmap(req: models.GenerateLessonRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    repo = repository.AsyncRepository()
    try:
        learner_profile, learner_state = await _learner_context(repo, req.learner_id)
        topic = req.topic.strip() or learner_profile.topic or learner_profile.learning_goal or "foundational learning"
        constraints = {**(req.constraints or {}), "adaptation_context": learner_state.adaptation_history[-1:] or []}
        roadmap = _normalize_generated_model(await lg_graph.generate_roadmap(learner_profile, learner_state, topic, constraints))
        await _retry_database(lambda: repo.persist_roadmap(req.learner_id, roadmap), "roadmap persistence")
        return roadmap
    except Exception as exc:
        logger.exception("Roadmap generation failed; returning fallback roadmap: learner_id=%s topic=%s", req.learner_id, req.topic)
        topic = req.topic.strip() or "foundational learning"
        roadmap = _normalize_generated_model(_fallback_roadmap(req.learner_id, topic, req.constraints or {}))
        try:
            await _retry_database(lambda: repo.persist_roadmap(req.learner_id, roadmap), "fallback roadmap persistence")
        except Exception:
            logger.exception("Fallback roadmap persistence failed; returning roadmap without stored session")
        return roadmap


def _fallback_roadmap(learner_id: str, topic: str, constraints: dict[str, Any]) -> models.LessonRoadmapResponse:
    pace = str(constraints.get("pace") or "balanced").lower()
    duration = 18 if "fast" in pace else 35 if "thorough" in pace or "gentle" in pace else 25
    stages = _syllabus_stages(topic) or [
        ("Core intuition", "Build the mental model and vocabulary for the topic.", "Beginner"),
        ("Worked examples", "Solve guided examples that expose the main pattern.", "Beginner"),
        ("Common mistakes", "Compare correct reasoning with tempting incorrect shortcuts.", "Intermediate"),
        ("Independent practice", "Apply the method to new questions with feedback.", "Intermediate"),
        ("Mixed challenge", "Connect the idea with nearby concepts and harder cases.", "Advanced"),
    ]
    return models.LessonRoadmapResponse(
        learner_id=learner_id,
        topic=topic,
        generation_source="fallback",
        generation_model="deterministic-roadmap",
        lessons=[
            models.LessonRoadmapItem(
                id=f"fallback-{index + 1}",
                title=f"{topic} {title}",
                description=description,
                difficulty=difficulty,
                estimated_duration=duration,
                objectives=[f"Explain {topic} clearly", "Solve one checkpoint correctly"],
            )
            for index, (title, description, difficulty) in enumerate(stages)
        ],
    )


def _syllabus_stages(topic: str) -> list[tuple[str, str, str]]:
    normalized = topic.strip().lower()
    if "linear" in normalized and "algebra" in normalized:
        return [
            ("Vectors", "Represent quantities with magnitude and direction, then operate on components geometrically and symbolically.", "Beginner"),
            ("Matrices", "Use arrays of numbers to represent linear maps, transformations, and systems of equations.", "Beginner"),
            ("Norms", "Measure vector and matrix size, distance, error, and stability with common norm choices.", "Intermediate"),
            ("Projections", "Map vectors onto lines, planes, or subspaces and connect projections to approximation.", "Intermediate"),
            ("Eigenvalues", "Find invariant directions and scaling factors for linear transformations.", "Advanced"),
            ("Diagonalisation", "Use eigenvectors to rewrite suitable matrices in a simpler diagonal form.", "Advanced"),
        ]
    if "calculus" in normalized:
        return [
            ("Limits", "Reason about the value a function approaches and use limits as the foundation for change.", "Beginner"),
            ("Derivatives", "Measure instantaneous rate of change with slopes, tangent lines, and derivative rules.", "Beginner"),
            ("Gradients", "Extend derivatives to multivariable functions and direction of steepest ascent.", "Intermediate"),
            ("Multivariable calculus", "Study functions with several inputs using partial derivatives, level curves, and directional change.", "Intermediate"),
            ("Hessians", "Use second partial derivatives to understand curvature and optimization behavior.", "Advanced"),
        ]
    return []


@router.post("/teaching-strategy", response_model=models.TeachingStrategy)
async def get_teaching_strategy(req: models.GenerateLessonRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    repo = repository.AsyncRepository()
    learner_profile, learner_state = await _learner_context(repo, req.learner_id)
    topic = req.topic.strip() or learner_profile.topic or learner_profile.learning_goal or "foundational learning"
    constraints = req.constraints or {}
    try:
        return await langgraph_nodes.pedagogy_agent(
            {
                "learner_profile": learner_profile.model_dump(),
                "learner_state": learner_state.model_dump(),
                "topic_context": {
                    "current_topic": topic,
                    "constraints": constraints,
                    "adaptation_context": learner_state.adaptation_history[-3:],
                    "weak_topics": learner_state.weak_topics,
                    "strong_topics": learner_state.strong_topics,
                    "confidence_score": learner_state.confidence_score,
                    "cognitive_load_estimate": learner_state.cognitive_load_estimate,
                },
            }
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/submit-assessment", response_model=models.AssessmentResult)
async def submit_assessment(sub: models.AssessmentSubmission, request: Request):
    _require_identity(request, sub.learner_id, "student")
    repo = repository.AsyncRepository()
    started = perf_counter()
    try:
        logger.info("Assessment submit started: learner_id=%s session_id=%s answers=%s", sub.learner_id, sub.session_id, len(sub.answers))
        session_state = await repo.get_session_state(sub.learner_id, sub.session_id)
        if sub.session_id.startswith("published:") and not session_state.get("published_assessment"):
            raise ValueError("This published assessment is unavailable or you are not enrolled in its class.")
        logger.info("Assessment submit session loaded: session_id=%s elapsed=%.2fs", sub.session_id, perf_counter() - started)
        result = _normalize_generated_model(await langgraph_nodes.assessment_agent(sub, session_state))
        logger.info("Assessment submit graded: session_id=%s score=%.3f elapsed=%.2fs", sub.session_id, result.score, perf_counter() - started)
        state = await repo.get_learner_state(sub.learner_id)
        decision = _normalize_generated_model(await langgraph_nodes.adaptation_agent(models.AdaptationRequest(learner_id=sub.learner_id, session_id=sub.session_id, assessment_state=result.model_dump())))
        logger.info("Assessment submit adapted: session_id=%s elapsed=%.2fs", sub.session_id, perf_counter() - started)
        updated_learner_model = _updated_learner_model(state.model_dump(), result, decision)
        result.adaptation = decision.adaptations
        await repo.save_assessment(sub, result, decision, updated_learner_model)
        if sub.session_id.startswith("published:"):
            await repo.complete_published_content(
                models.PublishedContentCompletionRequest(
                    learner_id=sub.learner_id,
                    draft_id=sub.session_id.removeprefix("published:"),
                ),
                score=result.score,
                evaluation=result.detailed_feedback,
            )
        logger.info("Assessment submit completed: session_id=%s elapsed=%.2fs", sub.session_id, perf_counter() - started)
        return result
    except Exception as exc:
        logger.exception("Assessment submit failed: learner_id=%s session_id=%s elapsed=%.2fs", sub.learner_id, sub.session_id, perf_counter() - started)
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/adapt-learning", response_model=models.AdaptationDecision)
async def adapt_learning(req: models.AdaptationRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    try:
        return _normalize_generated_model(await langgraph_nodes.adaptation_agent(req))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/generate-quiz", response_model=models.QuizResponse)
async def generate_quiz(req: models.GenerateQuizRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    repo = repository.AsyncRepository()
    session_state = await repo.get_session_state(req.learner_id, req.session_id)
    if not session_state:
        raise HTTPException(status_code=404, detail="Lesson session was not found.")
    try:
        quiz = _normalize_generated_model(await langgraph_nodes.assessment_agent(req, session_state))
        await repo.save_quiz(req.learner_id, quiz, (session_state.get("lesson") or {}).get("topic"))
        return quiz
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/tutor-interaction", response_model=models.TutorInteractionResponse)
async def tutor_interaction(req: models.TutorInteractionRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    repo = repository.AsyncRepository()
    session_state = await repo.get_session_state(req.learner_id, req.session_id)
    if not session_state:
        raise HTTPException(status_code=404, detail="Lesson session was not found.")
    try:
        answer = _normalize_generated_model(await langgraph_nodes.interactive_agent(req, session_state))
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
async def retrieve_memory(q: models.RetrieveMemoryRequest, request: Request) -> models.RetrieveMemoryResponse:
    _require_identity(request, q.learner_id, "student")
    from app.core.chroma_client import ChromaClient
    cc = ChromaClient()
    hits = await cc.semantic_search(langgraph_nodes.lesson_embedding_collection(), q.query, top_k=5, where={"learner_id": q.learner_id})
    results = [_memory_hit_to_response(hit, q.query) for hit in hits]
    concepts = []
    seen = set()
    for item in results:
        key = item.concept.lower()
        if key not in seen:
            seen.add(key)
            concepts.append(item.concept)
    return models.RetrieveMemoryResponse(query=q.query, results=results, concepts=concepts)


def _memory_hit_to_response(hit: dict[str, Any], query: str) -> models.RetrievedMemory:
    metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
    content = str(hit.get("content") or "")
    concept = str(metadata.get("concept") or metadata.get("topic") or metadata.get("title") or "Memory").strip() or "Memory"
    source = str(metadata.get("source") or metadata.get("kind") or metadata.get("type") or "lesson").strip() or "lesson"
    distance = hit.get("distance")
    try:
        score = 1 / (1 + max(0.0, float(distance)))
    except (TypeError, ValueError):
        score = 0.0
    snippet = _compact_memory_snippet(content)
    return models.RetrievedMemory(
        id=str(hit.get("id") or concept),
        concept=concept,
        source=source,
        snippet=snippet,
        score=round(score, 3),
        created_at=str(metadata.get("created_at") or metadata.get("timestamp") or "") or None,
        why=f"Matched your query about {_compact_memory_snippet(query, 12).lower()} in prior {source} memory.",
        metadata=metadata,
    )


def _compact_memory_snippet(value: str, max_words: int = 34) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return "Stored learner memory without text content."
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]).rstrip(".,;:") + "."


@router.post("/peer-feedback", response_model=models.PeerFeedbackResponse)
async def peer_feedback(req: models.PeerFeedbackRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
    try:
        record = await repository.AsyncRepository().save_peer_feedback(req, moderation_flags(req.comment))
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Peer feedback persistence failed")
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return models.PeerFeedbackResponse(saved=record)


@router.post("/save-lesson")
async def save_lesson(req: models.SaveLessonRequest, request: Request):
    _require_identity(request, req.learner_id, "student")
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
async def get_progress(request: Request, learner_id: str):
    _require_identity(request, learner_id, "student")
    repo = repository.AsyncRepository()
    try:
        return await asyncio.wait_for(repo.get_progress(learner_id), timeout=10)
    except Exception as exc:
        logger.warning("Progress endpoint returned safe fallback: learner_id=%s error=%s: %r", learner_id, type(exc).__name__, exc)
        return models.ProgressResponse(learner_id=learner_id)


@router.get("/analytics", response_model=models.AnalyticsResponse)
async def get_analytics(request: Request, learner_id: str):
    _require_identity(request, learner_id, "student")
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
