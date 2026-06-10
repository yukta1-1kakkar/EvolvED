from __future__ import annotations

import asyncio
import json
from uuid import uuid4

from app.ai.bedrock_provider import BedrockProvider
from app.ai.router import ModelRouter
from app.core import langgraph_nodes, models
from app.core.config import settings


EXPECTED_ROUTES = {
    "learner": "anthropic.claude-sonnet-4-6",
    "pedagogy": "us.anthropic.claude-sonnet-4-6",
    "planning": "anthropic.claude-sonnet-4-6",
    "content": "anthropic.claude-sonnet-4-6",
    "quiz": "anthropic.claude-haiku-4-5-20251001-v1:0",
    "assessment": "anthropic.claude-haiku-4-5-20251001-v1:0",
    "adaptation": "anthropic.claude-sonnet-4-6",
    "evolution": "anthropic.claude-sonnet-4-6",
    "tutor": "anthropic.claude-haiku-4-5-20251001-v1:0",
}
EXPECTED_EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0"


async def main() -> None:
    assert settings.active_provider.lower() == "bedrock", ModelRouter.validation_report()
    assert ModelRouter.get_embedding_model() == EXPECTED_EMBEDDING_MODEL
    for layer, expected_model in EXPECTED_ROUTES.items():
        assert ModelRouter.get_model(layer) == expected_model, (layer, ModelRouter.validation_report())

    provider = BedrockProvider()
    await assert_chat_call(provider, "planning", ModelRouter.get_model("planning"))
    await assert_chat_call(provider, "quiz", ModelRouter.get_model("quiz"))
    embeddings = await provider.create_embedding(["EvolvED Bedrock Titan embedding integration check."], model=ModelRouter.get_embedding_model())
    assert len(embeddings) == 1 and len(embeddings[0]) == 1024

    learner_id = f"bedrock-routing-{uuid4().hex[:8]}"
    learner_state = models.LearnerState(
        learner_id=learner_id,
        knowledge_level="beginner",
        pace_preference="balanced",
        preferred_modalities=["text", "practice"],
    )
    teaching_strategy = models.TeachingStrategy(
        strategy_type="adaptive_scaffolding",
        recommended_modalities=["text", "worked_example", "practice"],
        difficulty_level="beginner",
        pacing_strategy="balanced",
        interaction_density="medium",
    )
    lesson_req = models.GenerateLessonRequest(
        learner_id=learner_id,
        topic="Derivatives",
        selected_lesson={
            "id": "derivative-rate",
            "title": "Derivatives as instant rate of change",
            "description": "Connect average rate, tangent slope, and derivative interpretation.",
            "difficulty": "beginner",
            "estimated_duration": 35,
            "objectives": [
                "Connect secant slopes, tangent slopes, and derivatives.",
                "Interpret a derivative in words and units.",
            ],
        },
    )
    lesson = await langgraph_nodes.lesson_planning_agent(lesson_req, learner_state, teaching_strategy)
    langgraph_nodes._validate_blueprint(lesson)

    session_state = {"lesson": lesson.model_dump()}
    quiz = await langgraph_nodes.quiz_agent(
        models.GenerateQuizRequest(learner_id=learner_id, session_id=lesson.lesson_id),
        session_state,
    )
    assert len(quiz.questions) >= 3

    answers = {question["id"]: question.get("expected_answer", "Explained with the lesson method.") for question in quiz.questions}
    assessment = await langgraph_nodes.assessment_agent(
        models.AssessmentSubmission(
            learner_id=learner_id,
            session_id=lesson.lesson_id,
            answers=answers,
            confidence={question_id: 80 for question_id in answers},
        ),
        session_state,
    )
    assert 0 <= assessment.score <= 1

    adaptation = await langgraph_nodes.adaptation_agent(
        models.AdaptationRequest(
            learner_id=learner_id,
            session_id=lesson.lesson_id,
            assessment_state=assessment.model_dump(),
        )
    )
    assert adaptation.adaptations

    print(json.dumps(ModelRouter.validation_report(), indent=2))


async def assert_chat_call(provider: BedrockProvider, layer: str, model_id: str) -> None:
    response = await provider.call_chat_model(
        [
            {
                "role": "user",
                "content": (
                    "Return JSON only with keys layer and ok. "
                    f"Set layer to {layer} and ok to true."
                ),
            }
        ],
        model=model_id,
        temperature=0.0,
        max_tokens=128,
    )
    payload = langgraph_nodes._json_from_model_text(response["choices"][0]["message"]["content"])
    assert payload["layer"] == layer and payload["ok"] is True


if __name__ == "__main__":
    asyncio.run(main())
