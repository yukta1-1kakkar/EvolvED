import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.router import ModelRouter
from app.core import langgraph_nodes


def main() -> None:
    assert ModelRouter.LAYER_DESCRIPTIONS["draft"] == "Quality Check Agent"
    assert ModelRouter.LAYER_DESCRIPTIONS["assessment"] == "Quiz and Assessment Agent"
    assert "quiz" not in ModelRouter.LAYER_DESCRIPTIONS
    assert "evolution" not in ModelRouter.LAYER_DESCRIPTIONS
    assert hasattr(langgraph_nodes, "quality_check_agent")
    assert hasattr(langgraph_nodes, "assessment_agent")
    assert not hasattr(langgraph_nodes, "quiz_agent")
    assert not hasattr(langgraph_nodes, "evolutionary_agent")
    print("Agent taxonomy check passed.")


if __name__ == "__main__":
    main()
