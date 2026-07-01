import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import models
from app.core.langgraph_nodes import _lesson_payload_to_blueprint


def test_visual_lesson_does_not_synthesize_duplicate_concept_map():
    payload = {
        "title": "What Vectors Are and Look Like",
        "overview": "A visual introduction to vector magnitude and direction.",
        "learningStyle": "Visual Examples and Diagrams",
        "learningObjectives": ["Identify vector arrows", "Distinguish vectors from scalars"],
        "coreConcepts": [
            "A vector has magnitude and direction, usually drawn as an arrow.",
            "A scalar has magnitude only and no direction attached.",
            "Vector components describe horizontal and vertical movement.",
            "Equal vectors need matching magnitude and direction.",
        ],
        "explanation": "Vectors can be read from arrows on a coordinate grid.",
        "visualAssets": [
            {
                "title": "Vectors vs Scalars",
                "description": "Concept map comparing vector and scalar quantities.",
                "type": "concept_map",
                "data": ["Physical quantity", "Scalar", "Vector", "Direction"],
            },
            {
                "title": "Vector Graph",
                "description": "Graph of a vector from origin to point.",
                "type": "graph",
                "data": [{"x": 0, "y": 0}, {"x": 3, "y": 4}],
            },
        ],
        "audioScript": "",
        "examples": ["Example with an arrow." for _ in range(4)],
        "practiceQuestions": ["Question about vector arrows." for _ in range(4)],
        "guidedActivities": [],
        "reflectionQuestions": ["What makes an arrow a vector?"],
        "keyTakeaways": ["Vectors have direction.", "Scalars do not."],
        "nextSteps": ["Practice reading vector diagrams."],
    }

    blueprint = _lesson_payload_to_blueprint(
        payload,
        models.GenerateLessonRequest(learner_id="learner-1", topic="vectors"),
        {"title": "What Vectors Are and Look Like", "description": "Intro vectors", "estimated_duration": 25, "objectives": ["Identify vectors"]},
        "Visual Examples and Diagrams",
    )

    assert blueprint.conceptMaps == []
    assert any(asset["type"] == "concept_map" for asset in blueprint.visualElements)


if __name__ == "__main__":
    test_visual_lesson_does_not_synthesize_duplicate_concept_map()
