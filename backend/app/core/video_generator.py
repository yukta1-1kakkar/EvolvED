from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import lru_cache
import logging
import json
import re
import shutil
import subprocess
import tempfile
import textwrap
from pathlib import Path
from typing import Any, Dict
from uuid import uuid4

import cv2
import imageio_ffmpeg
import numpy as np

from app.core import models


logger = logging.getLogger(__name__)
MEDIA_ROOT = Path(__file__).resolve().parents[2] / "media"
FPS = 12
SCENE_SECONDS = 4
FRAME_SIZE = (1280, 720)


@dataclass(frozen=True)
class VideoCodec:
    name: str
    encoder: str
    extension: str
    content_type: str
    output_args: tuple[str, ...]


CODEC_CANDIDATES = (
    VideoCodec("H264", "libx264", ".mp4", "video/mp4", ("-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart")),
    VideoCodec("MPEG4", "mpeg4", ".mp4", "video/mp4", ("-q:v", "5", "-pix_fmt", "yuv420p", "-movflags", "+faststart")),
    VideoCodec("VP9", "libvpx-vp9", ".webm", "video/webm", ("-crf", "32", "-b:v", "0", "-pix_fmt", "yuv420p")),
    VideoCodec("VP8", "libvpx", ".webm", "video/webm", ("-crf", "10", "-b:v", "1M", "-pix_fmt", "yuv420p")),
)


def _ffmpeg_executable() -> str:
    executable = shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()
    if not executable or not Path(executable).is_file():
        raise RuntimeError("FFmpeg is not installed or available through imageio-ffmpeg")
    return executable


def _ffprobe_executable() -> str | None:
    executable = shutil.which("ffprobe")
    if executable:
        return executable
    try:
        import static_ffmpeg

        package_root = Path(static_ffmpeg.__file__).resolve().parent
        matches = list((package_root / "bin").glob("**/ffprobe*"))
        return str(next(path for path in matches if path.is_file()))
    except (ImportError, StopIteration):
        return None


@lru_cache(maxsize=1)
def _supported_codecs() -> tuple[VideoCodec, ...]:
    ffmpeg = _ffmpeg_executable()
    version = subprocess.run([ffmpeg, "-version"], capture_output=True, text=True, check=True).stdout.splitlines()[0]
    encoders_result = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, check=True)
    available = {candidate.name: candidate.encoder in encoders_result.stdout for candidate in CODEC_CANDIDATES}
    logger.info("FFmpeg version: %s", version)
    logger.info("Available video codec candidates: %s", available)

    supported = []
    for candidate in CODEC_CANDIDATES:
        if not available[candidate.name]:
            continue
        with tempfile.TemporaryDirectory(prefix="evolved-codec-") as directory:
            probe_path = Path(directory) / f"probe{candidate.extension}"
            command = [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1",
                "-c:v", candidate.encoder, *candidate.output_args, str(probe_path),
            ]
            probe = subprocess.run(command, capture_output=True, text=True)
            if probe.returncode == 0 and probe_path.exists() and probe_path.stat().st_size > 0:
                supported.append(candidate)
                logger.info("Video codec probe passed: name=%s encoder=%s container=%s", candidate.name, candidate.encoder, candidate.extension)
                continue
            logger.warning("Video codec probe failed: name=%s encoder=%s error=%s", candidate.name, candidate.encoder, probe.stderr.strip())
    if not supported:
        raise RuntimeError(f"FFmpeg has no working EvolvED video encoder; detected candidates: {available}")
    logger.info("Video codec fallback order: %s", [candidate.name for candidate in supported])
    return tuple(supported)


def _plain_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _ascii(value: str) -> str:
    return value.encode("ascii", errors="ignore").decode("ascii")


def _video_script(lesson: models.LessonBlueprint) -> Dict[str, Any]:
    scenes = [
        {
            "sceneTitle": lesson.learning_objective,
            "visualDescription": lesson.lesson_summary,
            "narration": lesson.lesson_summary,
            "duration": f"{SCENE_SECONDS} seconds",
        }
    ]
    for section in lesson.lesson_structure[:4]:
        scenes.append(
            {
                "sceneTitle": _plain_text(section.get("title")),
                "visualDescription": _plain_text(section.get("example") or section.get("concept_connection")),
                "narration": _plain_text(section.get("explanation")),
                "duration": f"{SCENE_SECONDS} seconds",
            }
        )
    return {
        "videoTitle": lesson.learning_objective,
        "duration": f"{len(scenes) * SCENE_SECONDS} seconds",
        "narration": " ".join(scene["narration"] for scene in scenes),
        "scenes": scenes,
    }


def _draw_wrapped(frame: np.ndarray, text: str, x: int, y: int, width: int, scale: float, color, thickness: int = 1) -> int:
    max_chars = max(20, int(width / (18 * scale)))
    for line in textwrap.wrap(_ascii(text), width=max_chars)[:6]:
        cv2.putText(frame, line, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)
        y += int(34 * scale) + 12
    return y


def _draw_graph(frame: np.ndarray, asset: Dict[str, Any], progress: float) -> None:
    data = asset.get("data") or []
    points = []
    for item in data:
        try:
            if isinstance(item, dict):
                points.append((float(item["x"]), float(item["y"])))
            else:
                x_text, y_text = str(item).replace("−", "-").split(",", 1)
                points.append((float(x_text), float(y_text)))
        except (KeyError, TypeError, ValueError):
            return
    if len(points) < 2:
        return
    left, top, right, bottom = 720, 170, 1200, 570
    cv2.line(frame, (left, bottom), (right, bottom), (90, 75, 105), 2)
    cv2.line(frame, (left, top), (left, bottom), (90, 75, 105), 2)
    xs, ys = [point[0] for point in points], [point[1] for point in points]
    x_span = max(xs) - min(xs) or 1
    y_span = max(ys) - min(ys) or 1
    plotted = [
        (
            int(left + ((x - min(xs)) / x_span) * (right - left)),
            int(bottom - ((y - min(ys)) / y_span) * (bottom - top)),
        )
        for x, y in points
    ]
    visible = max(2, int(1 + progress * (len(plotted) - 1)))
    for index in range(1, visible):
        cv2.line(frame, plotted[index - 1], plotted[index], (173, 83, 137), 4, cv2.LINE_AA)
    for point in plotted[:visible]:
        cv2.circle(frame, point, 6, (173, 83, 137), -1, cv2.LINE_AA)


def _draw_diagram(frame: np.ndarray, asset: Dict[str, Any], progress: float) -> None:
    labels = [_ascii(str(item))[:22] for item in (asset.get("data") or [])]
    if len(labels) < 2:
        return
    visible = max(1, int(progress * len(labels)) + 1)
    box_width = min(180, int(500 / len(labels)))
    gap = max(20, int((520 - box_width * len(labels)) / max(len(labels) - 1, 1)))
    for index, label in enumerate(labels[:visible]):
        x = 710 + index * (box_width + gap)
        if index:
            cv2.arrowedLine(frame, (x - gap, 350), (x - 8, 350), (173, 83, 137), 3, tipLength=0.25)
        cv2.rectangle(frame, (x, 300), (x + box_width, 400), (124, 58, 237), 2)
        _draw_wrapped(frame, label, x + 8, 345, box_width - 16, 0.45, (55, 42, 65), 1)


def _render_video(video_path: Path, thumbnail_path: Path, script: Dict[str, Any], visual_assets: list[Dict[str, Any]], codec: VideoCodec) -> None:
    ffmpeg = _ffmpeg_executable()
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{FRAME_SIZE[0]}x{FRAME_SIZE[1]}",
        "-r", str(FPS), "-i", "-", "-an", "-c:v", codec.encoder,
        *codec.output_args, str(video_path),
    ]
    logger.info("FFmpeg video render request: codec=%s encoder=%s output=%s", codec.name, codec.encoder, video_path.name)
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if process.stdin is None:
        raise RuntimeError("FFmpeg video encoder input pipe could not be initialized")
    try:
        for scene_index, scene in enumerate(script["scenes"]):
            asset = visual_assets[scene_index % len(visual_assets)] if visual_assets else None
            for frame_index in range(FPS * SCENE_SECONDS):
                progress = frame_index / max(FPS * SCENE_SECONDS - 1, 1)
                frame = np.full((FRAME_SIZE[1], FRAME_SIZE[0], 3), (252, 249, 255), dtype=np.uint8)
                cv2.rectangle(frame, (0, 0), (FRAME_SIZE[0], 90), (56, 43, 64), -1)
                cv2.putText(frame, f"Scene {scene_index + 1} of {len(script['scenes'])}", (50, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (245, 235, 255), 2, cv2.LINE_AA)
                _draw_wrapped(frame, scene["sceneTitle"], 60, 150, 580, 0.85, (56, 43, 64), 2)
                _draw_wrapped(frame, scene["visualDescription"], 60, 245, 570, 0.58, (95, 78, 105), 1)
                if asset and asset.get("type") == "graph":
                    _draw_graph(frame, asset, progress)
                elif asset:
                    _draw_diagram(frame, asset, progress)
                cv2.rectangle(frame, (60, 640), (1220, 680), (235, 229, 244), -1)
                cv2.rectangle(frame, (60, 640), (60 + int(1160 * progress), 680), (173, 83, 137), -1)
                if scene_index == 0 and frame_index == 0:
                    cv2.imwrite(str(thumbnail_path), frame)
                process.stdin.write(frame.tobytes())
    except (BrokenPipeError, OSError) as exc:
        process.kill()
        process.wait()
        error = process.stderr.read().decode("utf-8", errors="replace").strip() if process.stderr else ""
        video_path.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg {codec.name} stopped while receiving frames: {error or exc}") from exc
    finally:
        if not process.stdin.closed:
            process.stdin.close()
    return_code = process.wait()
    error = process.stderr.read().decode("utf-8", errors="replace").strip() if process.stderr else ""
    if return_code != 0:
        video_path.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg {codec.name} video rendering failed with exit code {return_code}: {error}")
    logger.info("FFmpeg video render result: codec=%s status=%s bytes=%s", codec.name, return_code, video_path.stat().st_size)


def _validate_video(video_path: Path) -> float:
    if not video_path.exists() or video_path.stat().st_size < 1024:
        raise RuntimeError("Generated lesson video is missing or too small to be playable")
    ffmpeg = _ffmpeg_executable()
    validation = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(video_path), "-map", "0:v:0", "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    if validation.returncode != 0:
        raise RuntimeError(f"Generated lesson video failed FFmpeg decode validation: {validation.stderr.strip()}")
    probe = _ffprobe_executable()
    probe_metadata: Dict[str, Any] = {}
    if probe:
        try:
            result = subprocess.run(
                [
                    probe, "-v", "error", "-show_entries",
                    "format=duration,size,bit_rate:stream=codec_name,codec_type,width,height,pix_fmt,duration,bit_rate",
                    "-of", "json", str(video_path),
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Generated lesson video timed out during ffprobe validation") from exc
        if result.returncode != 0:
            raise RuntimeError(f"Generated lesson video failed ffprobe validation: {result.stderr.strip()}")
        probe_metadata = json.loads(result.stdout)
        video_streams = [stream for stream in probe_metadata.get("streams", []) if stream.get("codec_type") == "video"]
        if not video_streams:
            raise RuntimeError("Generated lesson video has no video stream")
        stream = video_streams[0]
        probe_duration = float(stream.get("duration") or probe_metadata.get("format", {}).get("duration") or 0)
        if probe_duration <= 1:
            raise RuntimeError(f"Generated lesson video duration must exceed one second; received {probe_duration}")
        if not stream.get("codec_name") or int(stream.get("width") or 0) <= 0 or int(stream.get("height") or 0) <= 0:
            raise RuntimeError("Generated lesson video stream metadata is incomplete")
        logger.info(
            "Video ffprobe result: file=%s codec=%s duration=%.2f resolution=%sx%s bitrate=%s pixel_format=%s playable=true",
            video_path.name,
            stream["codec_name"],
            probe_duration,
            stream["width"],
            stream["height"],
            stream.get("bit_rate") or probe_metadata.get("format", {}).get("bit_rate"),
            stream.get("pix_fmt"),
        )
    else:
        logger.warning("ffprobe is unavailable; using full FFmpeg decode and OpenCV metadata validation for %s", video_path.name)

    capture = cv2.VideoCapture(str(video_path))
    try:
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT)) if capture.isOpened() else 0
        fps = float(capture.get(cv2.CAP_PROP_FPS)) if capture.isOpened() else 0
    finally:
        capture.release()
    duration = frame_count / fps if frame_count > 0 and fps > 0 else 0
    if duration <= 1:
        raise RuntimeError(f"Generated lesson video duration must exceed one second; received {duration}")
    logger.info("Video validation result: file=%s bytes=%s frames=%s fps=%.2f duration=%.2f", video_path.name, video_path.stat().st_size, frame_count, fps, duration)
    return duration


def _timestamp(seconds: int) -> str:
    return f"00:00:{seconds:02d}.000"


def _write_captions(path: Path, script: Dict[str, Any]) -> None:
    lines = ["WEBVTT", ""]
    for index, scene in enumerate(script["scenes"]):
        start = index * SCENE_SECONDS
        end = start + SCENE_SECONDS
        lines.extend([str(index + 1), f"{_timestamp(start)} --> {_timestamp(end)}", scene["narration"][:300], ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def _generate(lesson: models.LessonBlueprint) -> Dict[str, Any]:
    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    video_id = f"lesson-video-{uuid4()}"
    thumbnail_path = MEDIA_ROOT / f"{video_id}.jpg"
    captions_path = MEDIA_ROOT / f"{video_id}.vtt"
    script = _video_script(lesson)
    visual_assets = [asset for asset in lesson.visualElements if asset.get("type") != "video"]
    logger.info("Video generation request: lesson_id=%s video_id=%s scenes=%s", lesson.lesson_id, video_id, len(script["scenes"]))
    failures = []
    codec = None
    video_path = None
    duration_seconds = 0.0
    for candidate in _supported_codecs():
        candidate_path = MEDIA_ROOT / f"{video_id}{candidate.extension}"
        try:
            logger.info("Selected video codec attempt: video_id=%s codec=%s", video_id, candidate.name)
            _render_video(candidate_path, thumbnail_path, script, visual_assets, candidate)
            duration_seconds = _validate_video(candidate_path)
            codec = candidate
            video_path = candidate_path
            break
        except Exception as exc:
            candidate_path.unlink(missing_ok=True)
            failures.append(f"{candidate.name}: {exc}")
            logger.exception("Video codec render attempt failed: video_id=%s codec=%s", video_id, candidate.name)
    if codec is None or video_path is None:
        thumbnail_path.unlink(missing_ok=True)
        raise RuntimeError(f"All supported video codec attempts failed: {'; '.join(failures)}")
    _write_captions(captions_path, script)
    if not thumbnail_path.exists() or not captions_path.exists():
        raise RuntimeError("Generated lesson video metadata files are missing")
    result = {
        "id": video_id,
        "type": "video",
        "title": script["videoTitle"],
        "description": "Animated visual lesson walkthrough",
        "videoId": video_id,
        "videoUrl": f"/media/{video_path.name}",
        "contentType": codec.content_type,
        "codec": codec.name,
        "thumbnailUrl": f"/media/{thumbnail_path.name}",
        "captionsUrl": f"/media/{captions_path.name}",
        "duration": f"{duration_seconds:.1f} seconds",
        "narration": script["narration"],
        "videoScript": script,
    }
    logger.info("Video storage result: video_id=%s video_url=%s bytes=%s", video_id, result["videoUrl"], video_path.stat().st_size)
    return result


async def generate_visual_lesson_video(lesson: models.LessonBlueprint) -> Dict[str, Any]:
    try:
        result = await asyncio.to_thread(_generate, lesson)
        logger.info("Video generation response: lesson_id=%s video_id=%s", lesson.lesson_id, result["videoId"])
        return result
    except Exception:
        logger.exception("Video generation failed: lesson_id=%s", lesson.lesson_id)
        raise
