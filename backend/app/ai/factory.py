from app.core.config import settings
from app.ai.base import LLMProvider
from app.ai.bedrock_provider import BedrockProvider

def get_provider() -> LLMProvider:
    provider = settings.active_provider.lower()
    if provider == "bedrock":
        return BedrockProvider()
    raise ValueError(f"Unsupported provider: {provider}. EvolvED model routing is configured for Amazon Bedrock.")
