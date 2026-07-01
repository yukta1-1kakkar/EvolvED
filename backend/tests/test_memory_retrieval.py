import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.routers import _memory_hit_to_response


def test_memory_hit_is_normalized_for_ui():
    item = _memory_hit_to_response(
        {
            "id": "lesson:1",
            "content": "This lesson explained that negative scalar multiplication flips vector direction while preserving scaled magnitude.",
            "metadata": {"topic": "Vector Addition", "source": "lesson"},
            "distance": 0.25,
        },
        "negative scalar misconception",
    )

    assert item.id == "lesson:1"
    assert item.concept == "Vector Addition"
    assert item.source == "lesson"
    assert item.score == 0.8
    assert "negative scalar" in item.why
    assert "flips vector direction" in item.snippet


if __name__ == "__main__":
    test_memory_hit_is_normalized_for_ui()
