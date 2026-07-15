from typing import Any, Dict, List

import httpx

from app.ai.base import LLMProvider
from app.core.config import settings


class OpenRouterProvider(LLMProvider):
    async def call_chat_model(
        self,
        messages: List[Dict[str, str]],
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        max_attempts: int | None = None,
        response_schema: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        if not settings.openrouter_api_key:
            raise RuntimeError("OpenRouter API key is not configured")

        model_id = _openrouter_model(model)
        payload = {
            "model": model_id,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens or settings.bedrock_max_tokens,
        }
        if response_schema:
            payload["response_format"] = {"type": "json_object"}
        headers = {
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:8000",
            "X-Title": "EvolvED",
        }
        attempts = max(1, max_attempts or 2)
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=max(settings.bedrock_read_timeout_seconds, 120)) as client:
            for _ in range(attempts):
                try:
                    response = await client.post("https://openrouter.ai/api/v1/chat/completions", json=payload, headers=headers)
                    response.raise_for_status()
                    data = response.json()
                    return {"choices": data["choices"], "raw": data, "model": model_id}
                except Exception as exc:
                    last_error = exc
        raise RuntimeError(f"OpenRouter invocation failed for {model_id}: {last_error}") from last_error

    async def create_embedding(self, texts: List[str], model: str | None = None) -> List[List[float]]:
        raise RuntimeError("OpenRouter embedding generation is not configured")


def _openrouter_model(model: str | None) -> str:
    value = (model or "").lower()
    if "haiku" in value or "fast" in value:
        return settings.openrouter_fast_model
    return settings.openrouter_reasoning_model
