from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import router
from app.core.db import init_db

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
    await init_db()


app.include_router(router, prefix="", tags=["EvolvED"])