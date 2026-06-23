import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.core import models
from app.core.video_generator import MEDIA_ROOT

logger = logging.getLogger(__name__)


def _validate_mp3(audio: bytes) -> None:
    if len(audio) < 512:
        raise RuntimeError(f"Generated lesson audio is too small to be playable ({len(audio)} bytes)")
    if not (audio.startswith(b"ID3") or audio[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}):
        raise RuntimeError("Generated lesson audio does not contain a valid MP3 header")


async def generate_lesson_audio(lesson: models.LessonBlueprint, provider: Any, voice: str = "Joanna") -> dict[str, Any]:
    narration = (lesson.ttsContent or lesson.audioNarration or "").strip()
    if not narration:
        raise RuntimeError("Audio lesson is missing AI-generated narration")
    synthesize = getattr(provider, "synthesize_speech", None)
    if not callable(synthesize):
        raise RuntimeError("The configured AI provider does not support lesson speech synthesis")

    audio_id = f"lesson-audio-{uuid4()}"
    audio_path = MEDIA_ROOT / f"{audio_id}.mp3"
    logger.info(
        "Audio generation request: lesson_id=%s audio_id=%s voice=%s characters=%s",
        lesson.lesson_id,
        audio_id,
        voice,
        len(narration),
    )
    try:
        audio = await synthesize(narration, voice=voice)
        _validate_mp3(audio)
        MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
        audio_path.write_bytes(audio)
        stored = audio_path.read_bytes()
        _validate_mp3(stored)
        result = {
            "id": audio_id,
            "type": "audio",
            "title": f"{lesson.learning_objective} narration",
            "description": "AI-generated narration for this lesson.",
            "audioId": audio_id,
            "audioUrl": f"/media/{audio_path.name}",
            "contentType": "audio/mpeg",
            "narration": narration,
        }
        logger.info(
            "Audio storage result: lesson_id=%s audio_id=%s audio_url=%s bytes=%s",
            lesson.lesson_id,
            audio_id,
            result["audioUrl"],
            len(stored),
        )
        logger.info("Audio generation response: lesson_id=%s audio_id=%s", lesson.lesson_id, audio_id)
        return result
    except Exception:
        audio_path.unlink(missing_ok=True)
        logger.exception("Audio generation failed: lesson_id=%s audio_id=%s", lesson.lesson_id, audio_id)
        raise
