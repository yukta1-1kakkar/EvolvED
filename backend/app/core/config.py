from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    active_provider: str = "openrouter"
    openrouter_api_key: str | None = None
    reasoning_model: str = "deepseek/deepseek-chat"
    strategic_model: str = "deepseek/deepseek-r1"
    fast_model: str = "google/gemini-2.5-flash-lite"
    embedding_model: str = "nomic-embed-text"
    aws_region: str = "us-east-1"
    database_url: str | None = None
    database_pool_size: int = 10
    database_max_overflow: int = 20
    database_pool_recycle: int = 1800
    database_pool_pre_ping: bool = True
    chroma_tenant: str | None = None
    chroma_database: str | None = None
    chroma_api_key: str | None = None
    bedrock_max_tokens: int = 4096
    titan_embedding_dimensions: int | None = 1024
    titan_embedding_normalize: bool | None = True
    polly_engine: str = "neural"

settings = Settings()
