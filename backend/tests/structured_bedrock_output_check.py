import asyncio
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.bedrock_provider import BedrockProvider


class FakeClient:
    def invoke_model(self, **_kwargs):
        payload = {
            "content": [{
                "type": "tool_use",
                "name": "return_structured_result",
                "input": {"title": "Teachable lesson", "sections": [{"title": "Concept"}]},
            }]
        }
        return {"body": io.BytesIO(json.dumps(payload).encode())}


class FakePolly:
    def __init__(self):
        self.requests = []

    def synthesize_speech(self, **kwargs):
        self.requests.append(kwargs)
        return {"AudioStream": io.BytesIO(b"ID3" + b"a" * 600)}


async def main() -> None:
    provider = BedrockProvider()
    provider._bedrock_runtime_client = lambda: FakeClient()
    result = await provider.call_chat_model(
        [{"role": "user", "content": "Create a lesson."}],
        response_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        max_attempts=1,
    )
    payload = json.loads(result["choices"][0]["message"]["content"])
    assert result["structured_output"] is True
    assert payload["title"] == "Teachable lesson"
    polly = FakePolly()
    provider._polly_client = lambda: polly
    audio = await provider.synthesize_speech("This is a source-grounded lesson sentence. " * 180)
    assert len(polly.requests) > 1
    assert all(len(request["Text"]) <= 2600 for request in polly.requests)
    assert audio.startswith(b"ID3") and len(audio) > 1200
    print("Bedrock structured lesson output and chunked audio: ok")


if __name__ == "__main__":
    asyncio.run(main())
