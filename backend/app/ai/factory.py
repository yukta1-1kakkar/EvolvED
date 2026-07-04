from app.core.config import settings
from app.ai.base import LLMProvider
from app.ai.bedrock_provider import BedrockProvider
from app.ai.openrouter_provider import OpenRouterProvider

def get_provider() -> LLMProvider:
    provider = settings.active_provider.lower()
    if provider == "bedrock":
        return BedrockProvider()
    if provider == "openrouter":
        return OpenRouterProvider()
    raise ValueError(f"Unsupported provider: {provider}. EvolvED model routing is configured for Bedrock or OpenRouter.")
