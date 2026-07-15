import abc
from typing import Any, Dict, List

class LLMProvider(abc.ABC):
    @abc.abstractmethod
    async def call_chat_model(
        self,
        messages: List[Dict[str, str]],
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        max_attempts: int | None = None,
        response_schema: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        pass

    @abc.abstractmethod
    async def create_embedding(self, texts: List[str], model: str | None = None) -> List[List[float]]:
        pass
