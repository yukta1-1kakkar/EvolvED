import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.router import ModelRouter
from app.core import langgraph_nodes


def main() -> None:
    assert ModelRouter.LAYER_DESCRIPTIONS == {
        "instruction": "Personalised Instruction Agent",
        "assessment": "Assessment and Adaptation Agent",
        "governance": "Quality and Governance Agent",
    }
    assert hasattr(langgraph_nodes, "personalized_instruction_agent")
    assert hasattr(langgraph_nodes, "assessment_adaptation_agent")
    assert hasattr(langgraph_nodes, "quality_governance_agent")
    assert not hasattr(langgraph_nodes, "pedagogy_agent")
    assert not hasattr(langgraph_nodes, "lesson_planning_agent")
    assert not hasattr(langgraph_nodes, "quality_check_agent")
    assert not hasattr(langgraph_nodes, "adaptation_agent")
    print("Agent taxonomy check passed.")


if __name__ == "__main__":
    main()
