from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
BEDROCK_REASONING_MODEL = "us.anthropic.claude-sonnet-4-6"
BEDROCK_FAST_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
BEDROCK_EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    active_provider: str = "bedrock"
    openrouter_api_key: str | None = None
    openrouter_reasoning_model: str = "anthropic/claude-sonnet-4"
    openrouter_fast_model: str = "anthropic/claude-3.5-haiku"
    reasoning_model: str = BEDROCK_REASONING_MODEL
    fast_model: str = BEDROCK_FAST_MODEL
    instruction_model: str = Field(
        default=BEDROCK_REASONING_MODEL,
        validation_alias=AliasChoices("INSTRUCTION_MODEL", "LESSON_PLANNING_MODEL"),
    )
    assessment_adaptation_model: str = Field(
        default=BEDROCK_FAST_MODEL,
        validation_alias=AliasChoices("ASSESSMENT_ADAPTATION_MODEL", "ASSESSMENT_MODEL"),
    )
    quality_governance_model: str = BEDROCK_FAST_MODEL
    embedding_model: str = BEDROCK_EMBEDDING_MODEL
    aws_region: str = "us-east-1"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_session_token: str | None = None
    database_use_local_sqlite: bool = False
    database_url: str | None = None
    database_pool_size: int = 2
    database_max_overflow: int = 2
    database_pool_recycle: int = 1800
    database_pool_pre_ping: bool = True
    database_pool_use_lifo: bool = True
    database_connect_timeout_seconds: int = 8
    database_command_timeout_seconds: int = 90
    database_pool_timeout_seconds: int = 30
    module_leader_signup_code: str | None = None
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
