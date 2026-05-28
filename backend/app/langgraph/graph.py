from typing import Any, Dict, Optional
import asyncio
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
        lesson_blueprint = await langgraph_nodes.lesson_planning_agent(gen_req)

        # Content generation
        content = await langgraph_nodes.content_generation_agent(lesson_blueprint)

        # Return a combined package
        return {
            "learner_state": learner_state.dict(),
            "teaching_strategy": teaching_strategy.dict(),
            "lesson_blueprint": lesson_blueprint.dict(),
            "generated_content": content.dict(),
        }


orchestrator = Orchestrator()

async def generate_for_learner(profile: models.LearnerProfile, topic: str) -> Dict[str, Any]:
    return await orchestrator.run(profile, topic)
