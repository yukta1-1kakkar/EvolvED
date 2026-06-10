from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    active_provider: str = "bedrock"
    reasoning_model: str = "anthropic.claude-3-5-sonnet-20240620-v1:0"
    fast_model: str = "anthropic.claude-3-5-haiku-20241022-v1:0"
    learner_model: str = "anthropic.claude-3-5-sonnet-20240620-v1:0"
    pedagogy_model: str = "anthropic.claude-3-5-sonnet-20240620-v1:0"
    lesson_planning_model: str = "anthropic.claude-3-5-sonnet-20240620-v1:0"
    content_generation_model: str = "anthropic.claude-3-5-sonnet-20240620-v1:0"
    quiz_model: str = "anthropic.claude-3-5-haiku-20241022-v1:0"
    assessment_model: str = "anthropic.claude-3-5-haiku-20241022-v1:0"
    adaptation_model: str = "anthropic.claude-3-5-sonnet-20240620-v1:0"
    evolution_model: str = "anthropic.claude-3-5-sonnet-20240620-v1:0"
    fast_interaction_model: str = "anthropic.claude-haiku-4-5-20251001-v1:0"
    embedding_model: str = "amazon.titan-embed-text-v2:0"
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
    bedrock_connect_timeout_seconds: int = 10
    bedrock_read_timeout_seconds: int = 120
    bedrock_max_attempts: int = 4
    bedrock_retry_base_delay_seconds: float = 0.5
    titan_embedding_dimensions: int | None = 1024
    titan_embedding_normalize: bool | None = True
    polly_engine: str = "neural"

settings = Settings()
