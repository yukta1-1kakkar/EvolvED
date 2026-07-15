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
        }, {
            "id": "q2",
            "type": "short_answer",
            "question": "Explain the source concept.",
            "answer": "Private answer",
            "options": ["This must not be shown", "Neither should this"],
        }],
    }, learner)

    assert published["estimated_duration"] == 16
    assert published["learner_presentation"]["pace"] == "fast"
    assert published["learner_presentation"]["modality"] == "audio"
    assert "answer" not in published["questions"][0]
    assert "explanation" not in published["questions"][0]
    assert "answer" not in published["questions"][1]
    assert "options" not in published["questions"][1]

    lesson = {
        "estimated_duration": 20,
        "title": "Gradient prediction",
        "summary": "Lesson overview.",
        "sections": [{
            "title": "Why gradients matter",
            "summary": "Balanced explanation.",
            "guided_explanation": "Guided explanation with terminology unpacked step by step.",
            "quick_takeaway": "Concise complete explanation.",
            "spoken_explanation": "Natural spoken explanation.",
            "subsections": ["First idea", "Second idea"],
        }],
    }
    fast = repository._student_published_content("lesson", lesson, db_models.Learner(
        learner_id="student-fast", pace_preference="fast", preferred_modality=["visual"],
    ))
    gentle = repository._student_published_content("lesson", lesson, db_models.Learner(
        learner_id="student-gentle", pace_preference="gentle and thorough", preferred_modality=["reading"],
    ))
    audio = repository._student_published_content("lesson", lesson, db_models.Learner(
        learner_id="student-audio", pace_preference="balanced", preferred_modality=["audio"],
    ))
    assert fast["sections"][0]["summary"] == "Concise complete explanation."
    assert fast["sections"][0]["presentation_variant"] == "quick_takeaway"
    assert gentle["sections"][0]["summary"].startswith("Guided explanation")
    assert gentle["sections"][0]["presentation_variant"] == "guided_explanation"
    assert "Natural spoken explanation." in audio["audio_narration"]
    assert audio["learner_presentation"]["content_adapted"] is True
    assert repository._publication_details("lesson", "Biology", 2)["publication_message"] == "Lesson has been sent to all 2 students in Biology."
    print("published content personalization and delivery acknowledgement: ok")


if __name__ == "__main__":
    main()
