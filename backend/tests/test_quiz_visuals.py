import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.langgraph_nodes import _fallback_questions, _normalize_quiz_questions


def test_quiz_questions_do_not_invent_visuals():
    lesson = {
        "topic": "fractions",
        "lesson_structure": [{"title": "Equivalent fractions", "checkpoint": "Which statements describe equivalent fractions?"}],
    }

    question = _normalize_quiz_questions(
        [
            {
                "id": "q1",
                "prompt": "Which statements describe equivalent fractions?",
                "concept": "Equivalent fractions",
                "options": ["Same value", "Different value", "Scaled numerator and denominator", "Unrelated numbers"],
                "correct_answers": ["Same value", "Scaled numerator and denominator"],
            }
        ],
        lesson,
    )[0]

    assert "visual_asset" not in question
    assert "diagram" not in question["prompt"].lower()
    assert "diagram" not in " ".join(question["options"]).lower()


def test_question_specific_visual_is_renderable():
    [question] = _normalize_quiz_questions(
        [
            {
                "id": "q1",
                "prompt": "Use the flow to choose the correct sequence.",
                "concept": "Water cycle",
                "options": ["Evaporation", "Condensation", "Precipitation", "Photosynthesis"],
                "correct_answers": ["Evaporation", "Condensation", "Precipitation"],
                "visual_asset": {
                    "title": "Water cycle sequence",
                    "type": "flowchart",
                    "data": ["Evaporation", "Condensation", "Precipitation"],
                },
            }
        ],
        {"topic": "water cycle"},
    )

    assert question["visual_asset"]["title"] == "Water cycle sequence"
    assert question["visual_asset"]["imageUrl"].startswith("data:image/svg+xml")


def test_duplicate_quiz_visuals_are_removed_from_later_questions():
    questions = _normalize_quiz_questions(
        [
            {
                "id": "q1",
                "prompt": "Use the diagram to identify the vector magnitude.",
                "concept": "Vector magnitude",
                "options": ["Magnitude is 5", "Magnitude is 7", "x is 3", "y is 4"],
                "correct_answers": ["Magnitude is 5", "x is 3", "y is 4"],
                "visual_asset": {
                    "title": "Vector components",
                    "type": "graph",
                    "data": [{"x": 0, "y": 0}, {"x": 3, "y": 4}],
                },
            },
            {
                "id": "q2",
                "prompt": "Use the diagram to compare the components.",
                "concept": "Vector components",
                "options": ["x is 3", "y is 4", "Magnitude is 5", "Magnitude is 7"],
                "correct_answers": ["x is 3", "y is 4", "Magnitude is 5"],
                "visual_asset": {
                    "title": "Vector components",
                    "type": "graph",
                    "data": [{"x": 0, "y": 0}, {"x": 3, "y": 4}],
                },
            },
        ],
        {"topic": "vectors"},
    )

    assert "visual_asset" in questions[0]
    assert "visual_asset" not in questions[1]


def test_fallback_questions_are_text_only_without_question_visuals():
    questions = _fallback_questions(
        {
            "topic": "photosynthesis",
            "lesson_structure": [{"title": "Chlorophyll", "checkpoint": "What does chlorophyll do?"}],
        },
        "Detailed Written Explanations",
    )

    assert questions
    assert all("visual_asset" not in question for question in questions)


if __name__ == "__main__":
    test_quiz_questions_do_not_invent_visuals()
    test_question_specific_visual_is_renderable()
    test_duplicate_quiz_visuals_are_removed_from_later_questions()
    test_fallback_questions_are_text_only_without_question_visuals()
