import asyncio
import json
from typing import Any, Dict, List

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings


def _bedrock_runtime_client():
    return boto3.client("bedrock-runtime", region_name=settings.aws_region)


def _polly_client():
    return boto3.client("polly", region_name=settings.aws_region)


def _normalise_messages(messages: List[Dict[str, str]]) -> tuple[str | None, List[Dict[str, str]]]:
    system_parts: list[str] = []
    anthropic_messages: list[dict[str, str]] = []

    for message in messages:
        role = message.get("role", "user")
        content = str(message.get("content", ""))
        if role == "system":
            system_parts.append(content)
        elif role in {"user", "assistant"}:
            anthropic_messages.append({"role": role, "content": content})
        else:
            anthropic_messages.append({"role": "user", "content": content})

    if not anthropic_messages:
        anthropic_messages.append({"role": "user", "content": ""})

    return ("\n\n".join(system_parts) if system_parts else None), anthropic_messages


async def call_chat_model(
    messages: List[Dict[str, str]],
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> Dict[str, Any]:
    """Call Anthropic Claude through Amazon Bedrock.

    The return value intentionally matches the small OpenAI-compatible shape
    used by the rest of the app: response["choices"][0]["message"]["content"].
    """
    system, anthropic_messages = _normalise_messages(messages)
    payload: dict[str, Any] = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens or settings.bedrock_max_tokens,
        "temperature": temperature,
        "messages": anthropic_messages,
    }
    if system:
        payload["system"] = system

    model_id = model or settings.lesson_planning_model

    def _invoke() -> Dict[str, Any]:
        client = _bedrock_runtime_client()
        response = client.invoke_model(
            modelId=model_id,
            body=json.dumps(payload),
            contentType="application/json",
            accept="application/json",
        )
        raw = json.loads(response["body"].read())
        text = "".join(part.get("text", "") for part in raw.get("content", []) if part.get("type") == "text")
        return {"choices": [{"message": {"content": text}}], "raw": raw}

    try:
        return await asyncio.to_thread(_invoke)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Bedrock Claude invocation failed for {model_id}: {exc}") from exc


async def create_embedding(texts: List[str], model: str | None = None) -> List[List[float]]:
    """Create embeddings with Amazon Titan Text Embeddings through Bedrock."""
    model_id = model or settings.embedding_model

    def _embed_one(text: str) -> List[float]:
        client = _bedrock_runtime_client()
        payload: dict[str, Any] = {"inputText": text}
        if settings.titan_embedding_dimensions:
            payload["dimensions"] = settings.titan_embedding_dimensions
        if settings.titan_embedding_normalize is not None:
            payload["normalize"] = settings.titan_embedding_normalize

        response = client.invoke_model(
            modelId=model_id,
            body=json.dumps(payload),
            contentType="application/json",
            accept="application/json",
        )
        raw = json.loads(response["body"].read())
        return raw["embedding"]

    try:
        return [await asyncio.to_thread(_embed_one, text) for text in texts]
    except (BotoCoreError, ClientError, KeyError) as exc:
        raise RuntimeError(f"Bedrock Titan embedding failed for {model_id}: {exc}") from exc


async def synthesize_speech(text: str, model: str | None = None, voice: str = "Joanna") -> bytes:
    """Synthesize lesson audio with Amazon Polly.

    Bedrock does not provide the previous OpenAI TTS equivalent, so the app uses
    AWS Polly to keep the existing /tts endpoint provider-aligned with AWS.
    """
    polly_voice = "Joanna" if voice in {"", "alloy", None} else voice

    def _synthesize() -> bytes:
        client = _polly_client()
        response = client.synthesize_speech(
            Text=text,
            OutputFormat="mp3",
            VoiceId=polly_voice,
            Engine=model or settings.polly_engine,
        )
        stream = response.get("AudioStream")
        if not stream:
            raise RuntimeError("Polly response did not include an audio stream")
        return stream.read()

    try:
        return await asyncio.to_thread(_synthesize)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Polly speech synthesis failed: {exc}") from exc
