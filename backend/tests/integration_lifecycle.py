from __future__ import annotations

import asyncio
import os
from uuid import uuid4

import httpx


BASE_URL = os.getenv("EVOLVED_E2E_BASE_URL", "http://127.0.0.1:8001")


async def main() -> None:
    suffix = uuid4().hex[:10]
    email = f"e2e-{suffix}@example.com"
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=180.0) as client:
        user = await post(client, "/auth/signup", {"full_name": "Lifecycle Check", "email": email, "password": "Lifecycle1", "age": 24})
        learner_id = user["id"]
        await post(client, "/auth/login", {"email": email, "password": "Lifecycle1"})
        await post(
            client,
            "/learner-profile",
            {
                "learner_id": learner_id,
                "age_group": "adult",
                "education_level": "Undergraduate",
                "learning_goal": "Understand rates of change",
                "pace_preference": "balanced",
                "preferred_modality": ["visual", "interactive"],
                "topic": "Derivatives",
                "topic_familiarity": "beginner",
                "accessibility": {},
                "learning_availability": "30_min",
            },
        )
        roadmap = await post(client, "/generate-roadmap", {"learner_id": learner_id, "topic": "Derivatives"})
        selected_lesson = roadmap["lessons"][0]
        first_lesson = await post(client, "/generate-lesson", {"learner_id": learner_id, "topic": "Derivatives", "selected_lesson": selected_lesson})
        session_id = first_lesson["lesson_id"]
        await post(client, "/tutor-interaction", {"learner_id": learner_id, "session_id": session_id, "question": "Explain the first idea more simply.", "action": "simpler_explanation"})
        memories = await post(client, "/retrieve-memory", {"learner_id": learner_id, "query": "simpler explanation derivatives foundations"})
        quiz = await post(client, "/generate-quiz", {"learner_id": learner_id, "session_id": session_id})
        answers = {question["id"]: question.get("expected_answer", "I would explain the concept using the lesson objective.") for question in quiz["questions"]}
        confidence = {question_id: 80 for question_id in answers}
        assessment = await post(client, "/submit-assessment", {"learner_id": learner_id, "session_id": session_id, "answers": answers, "confidence": confidence})
        progress = await get(client, "/progress", {"learner_id": learner_id})
        analytics = await get(client, "/analytics", {"learner_id": learner_id})
        second_lesson = await post(client, "/generate-lesson", {"learner_id": learner_id, "topic": "Derivatives", "selected_lesson": selected_lesson})

    assert roadmap["lessons"]
    assert first_lesson["lesson_structure"]
    assert quiz["questions"]
    assert isinstance(memories["results"], list)
    assert assessment["adaptation"]
    assert progress["completed_lessons"] >= 1
    assert analytics["learner_model"].get("adaptation_history")
    assert second_lesson["lesson_structure"]
    assert first_lesson["lesson_id"] != second_lesson["lesson_id"]
    print(
        {
            "learner_id": learner_id,
            "first_lesson": first_lesson["lesson_id"],
            "quiz": quiz["quiz_id"],
            "score": assessment["score"],
            "completed_lessons": progress["completed_lessons"],
            "next_lesson": second_lesson["lesson_id"],
        }
    )


async def post(client: httpx.AsyncClient, path: str, payload: dict):
    response = await client.post(path, json=payload)
    if response.is_error:
        print(path, response.status_code, response.text)
    response.raise_for_status()
    return response.json()


async def get(client: httpx.AsyncClient, path: str, params: dict):
    response = await client.get(path, params=params)
    response.raise_for_status()
    return response.json()


if __name__ == "__main__":
    asyncio.run(main())
