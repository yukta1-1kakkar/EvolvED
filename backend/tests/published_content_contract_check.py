import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import repository
from app.db import models as db_models


def main() -> None:
    learner = db_models.Learner(
        learner_id="student-1",
        pace_preference="fast",
        preferred_modality=["audio"],
    )
    published = repository._student_published_content("assessment", {
        "estimated_duration": 20,
        "questions": [{
            "id": "q1",
            "question": "What does the source explain?",
            "answer": "A source-grounded answer",
            "explanation": "Private evaluation",
            "options": ["A", "B", "C", "D"],
        }],
    }, learner)

    assert published["estimated_duration"] == 16
    assert published["learner_presentation"]["pace"] == "fast"
    assert published["learner_presentation"]["modality"] == "audio"
    assert "answer" not in published["questions"][0]
    assert "explanation" not in published["questions"][0]
    assert repository._publication_details("lesson", "Biology", 2)["publication_message"] == "Lesson has been sent to all 2 students in Biology."
    print("published content personalization and delivery acknowledgement: ok")


if __name__ == "__main__":
    main()
