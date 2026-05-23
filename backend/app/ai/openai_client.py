import os
import httpx
from typing import List, Dict, Any
from app.core.config import settings


async def call_chat_model(messages: List[Dict[str, str]], model: str | None = None, temperature: float = 0.2) -> Dict[str, Any]:
    """Call OpenAI chat completions async via HTTP API."""
    api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    model = model or settings.generation_model
    url = "https://api.openai.com/v1/chat/completions"
    payload = {"model": model, "messages": messages, "temperature": temperature}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        return r.json()


async def create_embedding(texts: List[str], model: str | None = None) -> List[List[float]]:
    api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    model = model or settings.embedding_model
    url = "https://api.openai.com/v1/embeddings"
    payload = {"input": texts, "model": model}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        data = r.json()
        return [item["embedding"] for item in data["data"]]


async def synthesize_speech(text: str, model: str | None = None, voice: str = "alloy") -> bytes:
    api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    model = model or "gpt-4o-mini-tts"
    url = "https://api.openai.com/v1/audio/speech"
    payload = {"model": model, "voice": voice, "input": text}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "audio/mpeg"}

    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        return r.content
