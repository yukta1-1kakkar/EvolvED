import os
from typing import Any, Dict, List
import httpx
from .base import LLMProvider

class OpenRouterProvider(LLMProvider):
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://openrouter.ai/api/v1"

    async def call_chat_model(
        self,
        messages: List[Dict[str, str]],
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://evolved.ai",
            "X-Title": "EvolvED",
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
                timeout=60.0
            )
            response.raise_for_status()
            return response.json()

    async def create_embedding(self, texts: List[str], model: str | None = None) -> List[List[float]]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://evolved.ai",
            "X-Title": "EvolvED",
        }

        # For OpenRouter, embeddings are often model-agnostic if defined globally,
        # but if the API requires a specific model, we pass it.
        # OpenRouter's current API for embeddings is limited.
        # Let's try passing the model directly or omitting if the provider routes automatically.
        payload = {
            "model": "text-embedding-3-small", # Try a standard supported model if specific model fails
            "input": texts,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/embeddings",
                headers=headers,
                json=payload,
                timeout=60.0
            )

            if response.status_code != 200:
                print(f"Embedding request failed: {response.text}")
                response.raise_for_status()

            data = response.json()
            return [d["embedding"] for d in data["data"]]
