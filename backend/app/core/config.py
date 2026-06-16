from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
BEDROCK_REASONING_MODEL = "us.anthropic.claude-sonnet-4-6"
BEDROCK_FAST_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
BEDROCK_EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    active_provider: str = "bedrock"
    reasoning_model: str = BEDROCK_REASONING_MODEL
    fast_model: str = BEDROCK_FAST_MODEL
    learner_model: str = BEDROCK_REASONING_MODEL
    pedagogy_model: str = BEDROCK_REASONING_MODEL
    lesson_planning_model: str = BEDROCK_REASONING_MODEL
    content_generation_model: str = BEDROCK_REASONING_MODEL
    quiz_model: str = BEDROCK_FAST_MODEL
    assessment_model: str = BEDROCK_FAST_MODEL
    adaptation_model: str = BEDROCK_REASONING_MODEL
    evolution_model: str = BEDROCK_REASONING_MODEL
    fast_interaction_model: str = BEDROCK_FAST_MODEL
    embedding_model: str = BEDROCK_EMBEDDING_MODEL
    aws_region: str = "us-east-1"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_session_token: str | None = None
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
