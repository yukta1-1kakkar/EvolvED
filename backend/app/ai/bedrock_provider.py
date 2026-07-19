import asyncio
import json
import logging
import random
import re
from typing import Any, Dict, List

import boto3
from botocore.config import Config
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    ConnectTimeoutError,
    EndpointConnectionError,
    NoCredentialsError,
    PartialCredentialsError,
    ReadTimeoutError,
)

from app.ai.base import LLMProvider
from app.core.config import settings

logger = logging.getLogger(__name__)


def _speech_chunks(text: str, max_chars: int = 2600) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", " ".join(str(text or "").split()))
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        parts = [sentence[index:index + max_chars] for index in range(0, len(sentence), max_chars)] or [""]
        for part in parts:
            candidate = f"{current} {part}".strip()
            if current and len(candidate) > max_chars:
                chunks.append(current)
                current = part
            else:
                current = candidate
    if current:
        chunks.append(current)
    return chunks


class BedrockProvider(LLMProvider):
    def __init__(self):
        self.region = settings.aws_region
        self.client_kwargs = {
            key: value
            for key, value in {
                "aws_access_key_id": settings.aws_access_key_id,
                "aws_secret_access_key": settings.aws_secret_access_key,
                "aws_session_token": settings.aws_session_token,
            }.items()
            if value
        }
        self.config = Config(
            connect_timeout=settings.bedrock_connect_timeout_seconds,
            read_timeout=settings.bedrock_read_timeout_seconds,
            proxies={},
            retries={
                "max_attempts": settings.bedrock_max_attempts,
                "mode": "adaptive",
            },
        )

    def _bedrock_runtime_client(self):
        return boto3.client("bedrock-runtime", region_name=self.region, config=self.config, **self.client_kwargs)

    def _polly_client(self):
        return boto3.client("polly", region_name=self.region, config=self.config, **self.client_kwargs)

    def _is_retryable(self, exc: Exception) -> bool:
        if isinstance(exc, (NoCredentialsError, PartialCredentialsError)):
            return False
        if isinstance(exc, (ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError)):
            return True
        if isinstance(exc, ClientError):
            code = exc.response.get("Error", {}).get("Code", "")
            return code in {
                "ThrottlingException",
                "TooManyRequestsException",
                "RequestLimitExceeded",
                "ServiceQuotaExceededException",
                "ModelTimeoutException",
                "ModelNotReadyException",
                "InternalServerException",
                "ServiceUnavailableException",
            }
        return isinstance(exc, BotoCoreError)

    async def _run_with_retries(self, operation_name: str, invoke, max_attempts: int | None = None):
        last_exc: Exception | None = None
        attempts = max(1, max_attempts or settings.bedrock_max_attempts)
        attempts_run = 0
        for attempt in range(attempts):
            attempts_run = attempt + 1
            try:
                return await asyncio.to_thread(invoke)
            except Exception as exc:
                last_exc = exc
                if attempt == attempts - 1 or not self._is_retryable(exc):
                    break
                logger.warning(
                    "Bedrock %s attempt %s/%s failed; retrying: %s",
                    operation_name,
                    attempts_run,
                    attempts,
                    exc,
                )
                jitter = random.uniform(0, settings.bedrock_retry_base_delay_seconds)
                delay = settings.bedrock_retry_base_delay_seconds * (2**attempt) + jitter
                await asyncio.sleep(delay)
        raise RuntimeError(f"Bedrock {operation_name} failed after {attempts_run} attempt(s): {last_exc}") from last_exc

    def _normalise_messages(self, messages: List[Dict[str, str]]) -> tuple[str | None, List[Dict[str, str]]]:
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
        self,
        messages: List[Dict[str, str]],
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        max_attempts: int | None = None,
        response_schema: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        system, anthropic_messages = self._normalise_messages(messages)
        payload: dict[str, Any] = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens or settings.bedrock_max_tokens,
            "temperature": temperature,
            "messages": anthropic_messages,
        }
        if system:
            payload["system"] = system
        if response_schema:
            payload["tools"] = [{
                "name": "return_structured_result",
                "description": "Return the completed result using the required JSON structure.",
                "input_schema": response_schema,
            }]
            payload["tool_choice"] = {"type": "tool", "name": "return_structured_result"}

        model_id = model or settings.instruction_model

        def _invoke() -> Dict[str, Any]:
            client = self._bedrock_runtime_client()
            response = client.invoke_model(
                modelId=model_id,
                body=json.dumps(payload),
                contentType="application/json",
                accept="application/json",
            )
            raw = json.loads(response["body"].read())
            tool_result = next((part.get("input") for part in raw.get("content", []) if part.get("type") == "tool_use"), None)
            text = json.dumps(tool_result, ensure_ascii=False) if isinstance(tool_result, dict) else "".join(
                part.get("text", "") for part in raw.get("content", []) if part.get("type") == "text"
            )
            return {"choices": [{"message": {"content": text}}], "raw": raw, "structured_output": isinstance(tool_result, dict)}

        try:
            return await self._run_with_retries(f"Claude invocation for {model_id}", _invoke, max_attempts=max_attempts)
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Bedrock Claude invocation failed for {model_id}: {exc}") from exc
        except RuntimeError as exc:
            raise RuntimeError(f"Bedrock Claude invocation failed for {model_id}: {exc}") from exc

    async def create_embedding(self, texts: List[str], model: str | None = None) -> List[List[float]]:
        model_id = model or settings.embedding_model

        def _embed_one(text: str) -> List[float]:
            client = self._bedrock_runtime_client()
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
            return [
                await self._run_with_retries(f"Titan embedding for {model_id}", lambda text=text: _embed_one(text))
                for text in texts
            ]
        except (BotoCoreError, ClientError, KeyError) as exc:
            raise RuntimeError(f"Bedrock Titan embedding failed for {model_id}: {exc}") from exc
        except RuntimeError as exc:
            raise RuntimeError(f"Bedrock Titan embedding failed for {model_id}: {exc}") from exc

    async def synthesize_speech(self, text: str, model: str | None = None, voice: str = "Joanna") -> bytes:
        polly_voice = "Joanna" if voice in {"", "alloy", None} else voice

        try:
            async def synthesize_chunk(chunk: str, index: int) -> bytes:
                def invoke() -> bytes:
                    response = self._polly_client().synthesize_speech(
                        Text=chunk,
                        OutputFormat="mp3",
                        VoiceId=polly_voice,
                        Engine=model or settings.polly_engine,
                    )
                    stream = response.get("AudioStream")
                    if not stream:
                        raise RuntimeError("Polly response did not include an audio stream")
                    return stream.read()

                return await self._run_with_retries(f"Polly speech synthesis chunk {index}", invoke)

            chunks = _speech_chunks(text)
            return b"".join(await asyncio.gather(*(synthesize_chunk(chunk, index) for index, chunk in enumerate(chunks, 1))))
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Polly speech synthesis failed: {exc}") from exc
        except RuntimeError as exc:
            raise RuntimeError(f"Polly speech synthesis failed: {exc}") from exc
