from pathlib import Path
import logging
import mimetypes
import re

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse

from app.api.routers import router
from app.ai.router import ModelRouter
from app.core.db import init_db
from app.core.media import MEDIA_ROOT

logger = logging.getLogger(__name__)

# Load environment variables
root_env = Path(__file__).resolve().parent.parent.parent / ".env"
backend_env = Path(__file__).resolve().parent.parent / ".env"

load_dotenv(root_env)
load_dotenv(backend_env)

app = FastAPI(title="EvolvED Backend")
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
BYTE_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def _media_chunks(path: Path, start: int, length: int, chunk_size: int = 64 * 1024):
    with path.open("rb") as media:
        media.seek(start)
        remaining = length
        while remaining > 0:
            chunk = media.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@app.api_route("/media/{filename}", methods=["GET", "HEAD"])
async def lesson_media(filename: str, request: Request):
    if filename != Path(filename).name:
        raise HTTPException(status_code=404, detail="Media asset was not found")
    path = MEDIA_ROOT / filename
    if not path.is_file():
        logger.error("Media storage retrieval failed: filename=%s", filename)
        raise HTTPException(status_code=404, detail="Media asset was not found")

    size = path.stat().st_size
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    headers = {
        "Accept-Ranges": "bytes",
        "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type",
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": f'inline; filename="{path.name}"',
        "Content-Encoding": "identity",
    }
    range_header = request.headers.get("range")
    logger.info("Media storage retrieval request: filename=%s range=%s size=%s", filename, range_header, size)
    if not range_header:
        logger.info("Media storage retrieval result: filename=%s status=200 bytes=%s", filename, size)
        return FileResponse(path, media_type=media_type, headers=headers, method=request.method)

    try:
        match = BYTE_RANGE_RE.match(range_header.strip())
        if not match:
            raise ValueError("unsupported range")
        start_text, end_text = match.groups()
        if not start_text and not end_text:
            raise ValueError("empty range")
        if start_text:
            start = int(start_text)
            end = min(int(end_text) if end_text else size - 1, size - 1)
        else:
            suffix_length = int(end_text)
            if suffix_length <= 0:
                raise ValueError("invalid suffix range")
            start = max(0, size - suffix_length)
            end = size - 1
        if start < 0 or start >= size or end < start:
            raise ValueError("range outside media file")
    except (ValueError, TypeError):
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})

    length = end - start + 1
    response_headers = {
        **headers,
        "Content-Range": f"bytes {start}-{end}/{size}",
        "Content-Length": str(length),
    }
    logger.info("Media storage retrieval result: filename=%s status=206 bytes=%s", filename, length)
    if request.method == "HEAD":
        return Response(status_code=206, media_type=media_type, headers=response_headers)
    return StreamingResponse(_media_chunks(path, start, length), status_code=206, media_type=media_type, headers=response_headers)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    summary = ModelRouter.startup_summary()
    logger.info(
        "Three-agent model routing selected: provider=%s instruction=%s assessment_adaptation=%s quality_governance=%s embedding=%s",
        summary["selected_provider"],
        summary["selected_instruction_model"],
        summary["selected_assessment_adaptation_model"],
        summary["selected_quality_governance_model"],
        summary["selected_embedding_model"],
    )
    await init_db()


app.include_router(router, prefix="", tags=["EvolvED"])
