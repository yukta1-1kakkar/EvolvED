from app.core.config import settings

class ModelRouter:
    @staticmethod
    def get_model(layer: str) -> str:
        mapping = {
            "learner": settings.reasoning_model, # DeepSeek V3
            "pedagogy": settings.reasoning_model, # DeepSeek V3
            "planning": settings.reasoning_model, # DeepSeek V3
            "content": settings.reasoning_model, # DeepSeek V3
            "quiz": settings.fast_model, # Gemini 2.5
            "assessment": settings.fast_model, # Gemini 2.5
            "adaptation": settings.strategic_model, # DeepSeek R1
            "evolution": settings.strategic_model, # DeepSeek R1
        }
        return mapping.get(layer, settings.fast_model)

    @staticmethod
    def get_embedding_model() -> str:
        return settings.embedding_model
