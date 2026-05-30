import os
from typing import Any, Dict, List
import google.generativeai as genai
from app.ai.base import LLMProvider
from app.core.config import settings

class GeminiProvider(LLMProvider):
    def __init__(self):
        # Access the API key from Pydantic settings, which loads from the .env file
        api_key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not set.")
        genai.configure(api_key=api_key)

    def _map_messages(self, messages: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        # Map generic messages to Gemini format
        mapped = []
        for msg in messages:
            role = "user" if msg.get("role") in ["user", "system"] else "model"
            mapped.append({"role": role, "parts": [msg.get("content", "")]})
        return mapped

    async def call_chat_model(
        self,
        messages: List[Dict[str, str]],
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> Dict[str, Any]:
        model_name = model or settings.pedagogy_model
        if not model_name.startswith("models/"):
            model_name = f"models/{model_name}"

        gemini_model = genai.GenerativeModel(model_name)

        # Simple implementation using generate_content
        # In a real production environment, one would handle history/context management here
        response = await gemini_model.generate_content_async(
            messages[-1].get("content", ""),
            generation_config={"temperature": temperature, "max_output_tokens": max_tokens, "response_mime_type": "application/json"}
        )
        return {"choices": [{"message": {"content": response.text}}]}

    async def create_embedding(self, texts: List[str], model: str | None = None) -> List[List[float]]:
        model_name = model or settings.embedding_model
        # Ensure correct API call for embedding
        # Based on SDK docs, embed_content uses 'models/' prefix
        model_path = model_name if model_name.startswith("models/") else f"models/{model_name}"

        embeddings = []
        for text in texts:
            # embed_content returns a dictionary with 'embedding'
            result = genai.embed_content(model=model_path, content=text)
            embeddings.append(result['embedding'])
        return embeddings
