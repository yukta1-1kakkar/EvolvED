import asyncio
import logging
from typing import Any, Dict

from app.core import langgraph_nodes, models


class ThreeAgentCoordinator:
    """Thin coordinator for EvolvED's three-agent architecture.

    Learner modelling and pedagogy are internal tasks of the Personalised
    Instruction Agent. This coordinator passes typed artifacts between agents;
    it does not create a model-backed agent for every processing step.
    """

    async def generate_lesson_package(
        self,
        learner_profile: models.LearnerProfile,
        learner_state: models.LearnerState,
        topic: str,
        constraints: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        context = constraints or {}
        teaching_strategy = await langgraph_nodes.personalized_instruction_agent.design_strategy(
            {
                "learner_profile": learner_profile.model_dump(),
                "learner_state": learner_state.model_dump(),
                "topic_context": {
                    "current_topic": topic,
                    "constraints": context,
                    "adaptation_context": context.get("adaptation_context", {}),
                },
            }
        )
        request = models.GenerateLessonRequest(
            learner_id=learner_profile.learner_id,
            topic=topic,
            selected_lesson=context.get("selected_lesson"),
            constraints={**context, "learner_profile": learner_profile.model_dump()},
        )
        lesson = await langgraph_nodes.personalized_instruction_agent.generate_lesson(
            request, learner_state, teaching_strategy
        )
        asyncio.create_task(_index_lesson_content(lesson))
        assets = models.GeneratedContent(
            lesson_assets=[
                {
                    "id": f"asset:{lesson.lesson_id}:{index}",
                    "type": "text",
                    "content": section.get("explanation", ""),
                }
                for index, section in enumerate(lesson.lesson_structure)
            ]
        )
        return {
            "lesson": lesson,
            "teaching_strategy": teaching_strategy,
            "generated_content": assets,
        }

    async def generate_strategy(
        self,
        learner_profile: models.LearnerProfile,
        topic: str,
    ) -> models.TeachingStrategy:
        learner_state = await langgraph_nodes.personalized_instruction_agent.build_learner_state(learner_profile)
        return await langgraph_nodes.personalized_instruction_agent.design_strategy(
            {
                "learner_profile": learner_profile.model_dump(),
                "learner_state": learner_state.model_dump(),
                "topic_context": {"current_topic": topic},
            }
        )

    async def generate_roadmap(
        self,
        learner_profile: models.LearnerProfile,
        learner_state: models.LearnerState,
        topic: str,
        constraints: Dict[str, Any] | None = None,
    ) -> models.LessonRoadmapResponse:
        context = constraints or {}
        teaching_strategy = await langgraph_nodes.personalized_instruction_agent.design_strategy(
            {
                "learner_profile": learner_profile.model_dump(),
                "learner_state": learner_state.model_dump(),
                "topic_context": {
                    "current_topic": topic,
                    "constraints": context,
                    "adaptation_context": context.get("adaptation_context", {}),
                },
            }
        )
        request = models.GenerateLessonRequest(
            learner_id=learner_profile.learner_id,
            topic=topic,
            constraints=context,
        )
        return await langgraph_nodes.personalized_instruction_agent.generate_roadmap(
            request, learner_profile, learner_state, teaching_strategy
        )


coordinator = ThreeAgentCoordinator()


async def generate_strategy(profile: models.LearnerProfile, topic: str) -> models.TeachingStrategy:
    return await coordinator.generate_strategy(profile, topic)


async def generate_lesson_package(
    profile: models.LearnerProfile,
    learner_state: models.LearnerState,
    topic: str,
    constraints: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    return await coordinator.generate_lesson_package(profile, learner_state, topic, constraints)


async def generate_roadmap(
    profile: models.LearnerProfile,
    learner_state: models.LearnerState,
    topic: str,
    constraints: Dict[str, Any] | None = None,
) -> models.LessonRoadmapResponse:
    return await coordinator.generate_roadmap(profile, learner_state, topic, constraints)


async def _index_lesson_content(lesson: models.LessonBlueprint) -> None:
    try:
        await langgraph_nodes.personalized_instruction_agent.index_content(lesson)
    except Exception as exc:
        logging.getLogger(__name__).warning("Background content indexing failed: %s", exc)
