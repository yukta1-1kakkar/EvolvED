from app.core.config import settings
from app.ai.base import LLMProvider
from app.ai.bedrock_provider import BedrockProvider
from app.ai.gemini_provider import GeminiProvider
from app.ai.openrouter_provider import OpenRouterProvider

def get_provider() -> LLMProvider:
    provider = settings.active_provider.lower()
    if provider == "gemini":
        return GeminiProvider()
    elif provider == "bedrock":
        return BedrockProvider()
    elif provider == "openrouter":
        if not settings.openrouter_api_key:
            raise ValueError("OPENROUTER_API_KEY is not set")
        return OpenRouterProvider(api_key=settings.openrouter_api_key)
    else:
        raise ValueError(f"Unknown provider: {provider}")
