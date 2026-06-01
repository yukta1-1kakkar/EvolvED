import asyncio
import logging
from typing import Any, Dict
from app.core import langgraph_nodes
from app.core import models

try:
    import langgraph as lg
except Exception:
    lg = None


class Orchestrator:
    """Builds a LangGraph orchestration pipeline connecting agents.

    If LangGraph SDK is not available, falls back to a sequential async runner.
    """

    def __init__(self):
        self.graph = None
        graph_cls = getattr(lg, "Graph", None) if lg else None
        if graph_cls:
            self.graph = graph_cls(name="evolved_pipeline")
            # register nodes using functions in `langgraph_nodes`
            # Keep orchestration minimal here; implement conditional routing in runtime code.

    async def run(self, learner_profile: models.LearnerProfile, topic: str) -> Dict[str, Any]:
        # Run learner agent
        learner_state = await langgraph_nodes.learner_agent(learner_profile)

        # Pedagogy reasoning
        pedagogy_input = {
            "state": {
                "learner_state": learner_state.dict(),
                "topic_context": {"current_topic": topic},
            }
        }
        teaching_strategy = await langgraph_nodes.pedagogy_agent(pedagogy_input)

        # Lesson planning
        gen_req = models.GenerateLessonRequest(learner_id=learner_profile.learner_id, topic=topic)
        lesson_blueprint = await langgraph_nodes.lesson_planning_agent(gen_req, learner_state, teaching_strategy)

        # Content generation
        content = await langgraph_nodes.content_generation_agent(lesson_blueprint)

        # Return a combined package
        return {
            "learner_state": learner_state.dict(),
            "teaching_strategy": teaching_strategy.dict(),
            "lesson_blueprint": lesson_blueprint.dict(),
            "generated_content": content.dict(),
        }

    async def generate_blueprint(
        self,
        learner_profile: models.LearnerProfile,
        topic: str,
        constraints: Dict[str, Any] | None = None,
    ) -> models.LessonBlueprint:
        learner_state = await langgraph_nodes.learner_agent(learner_profile)
        teaching_strategy = await langgraph_nodes.pedagogy_agent(
            {
                "state": {
                    "learner_state": learner_state.model_dump(),
                    "topic_context": {"current_topic": topic},
                }
            }
        )
        request = models.GenerateLessonRequest(
            learner_id=learner_profile.learner_id,
            topic=topic,
            project_context=constraints.get("project_context") if constraints else None,
            constraints=constraints or {},
        )
        return await langgraph_nodes.lesson_planning_agent(request, learner_state, teaching_strategy)

    async def generate_lesson_package(
        self,
        learner_profile: models.LearnerProfile,
        learner_state: models.LearnerState,
        topic: str,
        project_context: str | None,
        constraints: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        teaching_strategy = await langgraph_nodes.pedagogy_agent(
            {
                "state": {
                    "learner_state": learner_state.model_dump(),
                    "topic_context": {"current_topic": topic},
                    "adaptation_context": (constraints or {}).get("adaptation_context", {}),
                }
            }
        )
        request = models.GenerateLessonRequest(
            learner_id=learner_profile.learner_id,
            topic=topic,
            project_context=project_context,
            constraints=constraints or {},
        )
        lesson = await langgraph_nodes.lesson_planning_agent(request, learner_state, teaching_strategy)
        asyncio.create_task(_enrich_lesson_content(lesson))
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
        learner_state = await langgraph_nodes.learner_agent(learner_profile)
        return await langgraph_nodes.pedagogy_agent(
            {
                "state": {
                    "learner_state": learner_state.model_dump(),
                    "topic_context": {"current_topic": topic},
                }
            }
        )


orchestrator = Orchestrator()

async def generate_for_learner(profile: models.LearnerProfile, topic: str) -> Dict[str, Any]:
    return await orchestrator.run(profile, topic)


async def generate_blueprint(
    profile: models.LearnerProfile,
    topic: str,
    constraints: Dict[str, Any] | None = None,
) -> models.LessonBlueprint:
    return await orchestrator.generate_blueprint(profile, topic, constraints)


async def generate_strategy(profile: models.LearnerProfile, topic: str) -> models.TeachingStrategy:
    return await orchestrator.generate_strategy(profile, topic)


async def generate_lesson_package(
    profile: models.LearnerProfile,
    learner_state: models.LearnerState,
    topic: str,
    project_context: str | None,
    constraints: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    return await orchestrator.generate_lesson_package(profile, learner_state, topic, project_context, constraints)


async def _enrich_lesson_content(lesson: models.LessonBlueprint) -> None:
    try:
        await langgraph_nodes.content_generation_agent(lesson)
    except Exception as exc:
        logging.getLogger(__name__).warning("Background content enrichment failed: %s", exc)
