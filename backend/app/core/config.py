from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str | None = None
    pedagogy_model: str = "gpt-4.1"
    generation_model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-large"
    chroma_api_host: str = "http://chroma:8000"

    class Config:
        env_prefix = ""


settings = Settings()
