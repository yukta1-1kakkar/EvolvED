from pathlib import Path
import logging

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import router
from app.ai.router import ModelRouter
from app.core.db import init_db

logger = logging.getLogger(__name__)

# Load environment variables
root_env = Path(__file__).resolve().parent.parent.parent / ".env"
backend_env = Path(__file__).resolve().parent.parent / ".env"

load_dotenv(root_env)
load_dotenv(backend_env)

app = FastAPI(title="EvolvED Backend")

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
        "AI model routing selected: provider=%s pedagogy=%s lesson_planning=%s content_generation=%s assessment=%s embedding=%s",
        summary["selected_provider"],
        summary["selected_pedagogy_model"],
        summary["selected_lesson_planning_model"],
        summary["selected_content_generation_model"],
        summary["selected_assessment_model"],
        summary["selected_embedding_model"],
    )
    await init_db()


app.include_router(router, prefix="", tags=["EvolvED"])
