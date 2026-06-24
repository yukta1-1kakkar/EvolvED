import logging
import asyncio
import tempfile
from typing import Any
from uuid import uuid4

from app.core import models
from app.core.media import MEDIA_ROOT

logger = logging.getLogger(__name__)


def _validate_mp3(audio: bytes) -> None:
    if len(audio) < 512:
        raise RuntimeError(f"Generated lesson audio is too small to be playable ({len(audio)} bytes)")
    if not (audio.startswith(b"ID3") or audio[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}):
        raise RuntimeError("Generated lesson audio does not contain a valid MP3 header")


def _validate_wav(audio: bytes) -> None:
    if len(audio) < 1024:
        raise RuntimeError(f"Generated lesson audio is too small to be playable ({len(audio)} bytes)")
    if not (audio.startswith(b"RIFF") and audio[8:12] == b"WAVE"):
        raise RuntimeError("Generated lesson audio does not contain a valid WAV header")


def _validate_audio(audio: bytes, content_type: str) -> None:
    if content_type == "audio/mpeg":
        _validate_mp3(audio)
        return
    if content_type == "audio/wav":
        _validate_wav(audio)
        return
    raise RuntimeError(f"Unsupported generated lesson audio content type: {content_type}")


def _synthesize_local_tts(text: str, voice: str) -> bytes:
    try:
        import pyttsx3
    except ImportError as exc:
        raise RuntimeError("Local TTS fallback requires pyttsx3. Install backend requirements first.") from exc

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
        output_path = temp_file.name

    try:
        engine = pyttsx3.init()
        engine.setProperty("rate", 165)
        engine.setProperty("volume", 1.0)
        if voice:
            requested_voice = voice.lower()
            for candidate in engine.getProperty("voices") or []:
                voice_name = str(getattr(candidate, "name", "") or "").lower()
                voice_id = str(getattr(candidate, "id", "") or "").lower()
                if requested_voice in voice_name or requested_voice in voice_id:
                    engine.setProperty("voice", candidate.id)
                    break
        engine.save_to_file(text, output_path)
        engine.runAndWait()
        with open(output_path, "rb") as audio_file:
            audio = audio_file.read()
        _validate_wav(audio)
        return audio
    finally:
        try:
            import os

            os.unlink(output_path)
        except OSError:
            logger.warning("Local TTS temporary file cleanup failed: %s", output_path)


def _edge_voice(voice: str) -> str:
    normalized = (voice or "").strip().lower()
    voice_map = {
        "": "en-US-JennyNeural",
        "joanna": "en-US-JennyNeural",
        "alloy": "en-US-JennyNeural",
        "male": "en-US-GuyNeural",
        "guy": "en-US-GuyNeural",
        "female": "en-US-JennyNeural",
        "jenny": "en-US-JennyNeural",
    }
    if normalized in voice_map:
        return voice_map[normalized]
    if normalized.startswith("en-") and normalized.endswith("neural"):
        return voice
    return "en-US-JennyNeural"


async def _synthesize_edge_tts(text: str, voice: str) -> bytes:
    try:
        import edge_tts
    except ImportError as exc:
        raise RuntimeError("Edge TTS fallback requires edge-tts. Install backend requirements first.") from exc

    communicate = edge_tts.Communicate(text, _edge_voice(voice))
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            chunks.append(chunk["data"])
    audio = b"".join(chunks)
    _validate_mp3(audio)
    return audio


async def synthesize_lesson_speech(text: str, provider: Any, voice: str = "Joanna") -> tuple[bytes, str, str, str]:
    narration = text.strip()
    if not narration:
        raise RuntimeError("TTS requires non-empty narration text")

    synthesize = getattr(provider, "synthesize_speech", None)
    provider_error: Exception | None = None
    if callable(synthesize):
        try:
            audio = await synthesize(narration, voice=voice)
            _validate_mp3(audio)
            return audio, "audio/mpeg", ".mp3", "provider"
        except Exception as exc:
            provider_error = exc
            logger.warning("Provider TTS unavailable; trying local TTS fallback: %s", exc)

    edge_error: Exception | None = None
    try:
        audio = await _synthesize_edge_tts(narration, voice)
        return audio, "audio/mpeg", ".mp3", "edge-tts"
    except Exception as exc:
        edge_error = exc
        logger.warning("Edge TTS unavailable; trying local OS TTS fallback: %s", exc)

    try:
        audio = await asyncio.to_thread(_synthesize_local_tts, narration, voice)
        return audio, "audio/wav", ".wav", "local"
    except Exception as local_exc:
        if provider_error:
            raise RuntimeError(f"Provider TTS failed ({provider_error}); Edge TTS failed ({edge_error}); local TTS fallback failed ({local_exc})") from local_exc
        if edge_error:
            raise RuntimeError(f"Edge TTS failed ({edge_error}); local TTS fallback failed ({local_exc})") from local_exc
        raise


async def generate_lesson_audio(lesson: models.LessonBlueprint, provider: Any, voice: str = "Joanna") -> dict[str, Any]:
    narration = (lesson.ttsContent or lesson.audioNarration or "").strip()
    if not narration:
        raise RuntimeError("Audio lesson is missing AI-generated narration")

    audio_id = f"lesson-audio-{uuid4()}"
    logger.info(
        "Audio generation request: lesson_id=%s audio_id=%s voice=%s characters=%s",
        lesson.lesson_id,
        audio_id,
        voice,
        len(narration),
    )
    audio_path = None
    try:
        audio, content_type, extension, source = await synthesize_lesson_speech(narration, provider, voice=voice)
        audio_path = MEDIA_ROOT / f"{audio_id}{extension}"
        MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
        audio_path.write_bytes(audio)
        stored = audio_path.read_bytes()
        _validate_audio(stored, content_type)
        result = {
            "id": audio_id,
            "type": "audio",
            "title": f"{lesson.learning_objective} narration",
            "description": "Generated narration for this lesson.",
            "audioId": audio_id,
            "audioUrl": f"/media/{audio_path.name}",
            "contentType": content_type,
            "generationSource": source,
            "narration": narration,
        }
        logger.info(
            "Audio storage result: lesson_id=%s audio_id=%s audio_url=%s content_type=%s source=%s bytes=%s",
            lesson.lesson_id,
            audio_id,
            result["audioUrl"],
            content_type,
            source,
            len(stored),
        )
        logger.info("Audio generation response: lesson_id=%s audio_id=%s", lesson.lesson_id, audio_id)
        return result
    except Exception:
        if audio_path:
            audio_path.unlink(missing_ok=True)
        logger.exception("Audio generation failed: lesson_id=%s audio_id=%s", lesson.lesson_id, audio_id)
        raise
