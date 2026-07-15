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
    print("Bedrock structured lesson output: ok")


if __name__ == "__main__":
    asyncio.run(main())
