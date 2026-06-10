from app.core.config import settings

class ModelRouter:
    BEDROCK_PROVIDER = "bedrock"
    LAYER_DESCRIPTIONS = {
        "learner": "Learner Modeling Layer",
        "pedagogy": "Pedagogical Reasoning Layer",
        "planning": "Lesson Planning Layer",
        "content": "Content Generation Layer",
        "quiz": "Quiz Generation Layer",
        "assessment": "Assessment Layer",
        "adaptation": "Adaptation Layer",
        "evolution": "Evolutionary Strategy Layer",
        "tutor": "AI Tutor Chat",
    }

    @staticmethod
    def get_model(layer: str) -> str:
        mapping = {
            "learner": settings.learner_model,
            "pedagogy": settings.pedagogy_model,
            "planning": settings.lesson_planning_model,
            "content": settings.content_generation_model,
            "quiz": settings.quiz_model,
            "assessment": settings.assessment_model,
            "adaptation": settings.adaptation_model,
            "evolution": settings.evolution_model,
            "tutor": settings.fast_interaction_model,
        }
        return mapping.get(layer, settings.fast_interaction_model)

    @staticmethod
    def get_embedding_model() -> str:
        return settings.embedding_model

    @classmethod
    def validation_report(cls) -> dict:
        layers = {
            layer: {
                "description": description,
                "provider": settings.active_provider,
                "model": cls.get_model(layer),
            }
            for layer, description in cls.LAYER_DESCRIPTIONS.items()
        }
        return {
            "provider": settings.active_provider,
            "expected_provider": cls.BEDROCK_PROVIDER,
            "provider_valid": settings.active_provider.lower() == cls.BEDROCK_PROVIDER,
            "layers": layers,
            "embeddings": {
                "description": "Embeddings",
                "provider": settings.active_provider,
                "model": cls.get_embedding_model(),
            },
        }
