from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    aws_region: str = "us-east-1"
    database_url: str | None = None
    database_pool_size: int = 10
    database_max_overflow: int = 20
    database_pool_recycle: int = 1800
    database_pool_pre_ping: bool = True
    chroma_tenant: str | None = None
    chroma_database: str | None = None
    chroma_api_key: str | None = None
    pedagogy_model: str = "anthropic.claude-3-7-sonnet-20250219-v1:0"
    lesson_planning_model: str = "anthropic.claude-3-7-sonnet-20250219-v1:0"
    content_generation_model: str = "anthropic.claude-3-7-sonnet-20250219-v1:0"
    fast_interaction_model: str = "anthropic.claude-3-haiku-20240307-v1:0"
    embedding_model: str = "amazon.titan-embed-text-v2:0"
    bedrock_max_tokens: int = 4096
    titan_embedding_dimensions: int | None = 1024
    titan_embedding_normalize: bool | None = True
    polly_engine: str = "neural"

settings = Settings()
