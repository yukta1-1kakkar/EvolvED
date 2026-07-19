from app.core.config import settings


class ModelRouter:
    BEDROCK_PROVIDER = "bedrock"
    LAYER_DESCRIPTIONS = {
        "instruction": "Personalised Instruction Agent",
        "assessment": "Assessment and Adaptation Agent",
        "governance": "Quality and Governance Agent",
    }

    @staticmethod
    def get_model(layer: str) -> str:
        mapping = {
            "instruction": settings.instruction_model,
            "assessment": settings.assessment_adaptation_model,
            "governance": settings.quality_governance_model,
        }
        return mapping.get(layer, settings.fast_model)

    @staticmethod
    def get_embedding_model() -> str:
        return settings.embedding_model

    @classmethod
    def startup_summary(cls) -> dict:
        return {
            "selected_provider": settings.active_provider,
            "selected_instruction_model": cls.get_model("instruction"),
            "selected_assessment_adaptation_model": cls.get_model("assessment"),
            "selected_quality_governance_model": cls.get_model("governance"),
            "selected_embedding_model": cls.get_embedding_model(),
        }

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
