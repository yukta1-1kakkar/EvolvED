import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.langgraph_nodes import _prepare_visual_assets


def test_visual_description_is_compacted_instead_of_rejecting_lesson():
    [asset] = _prepare_visual_assets(
        [
            {
                "title": "Vector Components on a Coordinate Grid",
                "description": "Graph plotting vector v = (3, 4) from origin to point (3, 4), with dashed lines showing horizontal component (3 units) and vertical component (4 units), and the arrow as the hypotenuse of magnitude 5.",
                "type": "graph",
                "data": [{"x": 0, "y": 0}, {"x": 3, "y": 4}],
            }
        ]
    )

    assert len(asset["description"].split()) <= 28
    assert asset["imageUrl"].startswith("data:image/svg+xml")


def test_placeholder_visual_text_is_still_rejected():
    try:
        _prepare_visual_assets(
            [
                {
                    "title": "[Topic]",
                    "description": "Short readable description",
                    "type": "flowchart",
                    "data": ["Start", "Finish"],
                }
            ]
        )
    except ValueError as exc:
        assert "placeholder text" in str(exc)
    else:
        raise AssertionError("placeholder title should be rejected")


def test_visual_node_labels_are_compacted_instead_of_rejecting_lesson():
    [asset] = _prepare_visual_assets(
        [
            {
                "title": "Tip-to-Tail Addition Process",
                "description": "Flowchart for adding vectors graphically.",
                "type": "flowchart",
                "data": [
                    "Draw Vector A",
                    "Slide Vector B: tail to tip of A",
                    "Draw Resultant R",
                    "R from first tail to last tip",
                ],
            }
        ]
    )

    assert len(asset["data"][1].split()) <= 6
    assert len(asset["data"][3].split()) <= 6
    assert asset["imageUrl"].startswith("data:image/svg+xml")


def test_visual_node_descriptions_are_still_rejected():
    try:
        _prepare_visual_assets(
            [
                {
                    "title": "Bad Flow",
                    "description": "Short readable description",
                    "type": "flowchart",
                    "data": ["Start", "A flowchart showing the full process with lots of prose"],
                }
            ]
        )
    except ValueError as exc:
        assert "node label" in str(exc)
    else:
        raise AssertionError("description-like node label should be rejected")


if __name__ == "__main__":
    test_visual_description_is_compacted_instead_of_rejecting_lesson()
    test_placeholder_visual_text_is_still_rejected()
    test_visual_node_labels_are_compacted_instead_of_rejecting_lesson()
    test_visual_node_descriptions_are_still_rejected()
