import os
import sys
import asyncio
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["DATABASE_USE_LOCAL_SQLITE"] = "false"
os.environ["MODULE_LEADER_SIGNUP_CODE"] = "privacy-test-code"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

from app.main import app


async def signup(client: httpx.AsyncClient, email: str, role: str, code: str | None = None) -> dict:
    response = await client.post("/auth/signup", json={
        "full_name": email.split("@")[0],
        "email": email,
        "password": "Secure123",
        "role": role,
        "module_leader_code": code,
    })
    assert response.status_code == 200, response.text
    assert client.cookies.get("evolved_session")
    return response.json()


async def run() -> None:
    print("Starting app", flush=True)
    await app.router.startup()
    print("App started", flush=True)
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as teacher,
        httpx.AsyncClient(transport=transport, base_url="http://test") as first_student,
        httpx.AsyncClient(transport=transport, base_url="http://test") as second_student,
    ):
        print("Signing up leader", flush=True)
        leader = await signup(teacher, "leader@example.com", "module_leader", "privacy-test-code")
        print("Creating class", flush=True)
        classroom_response = await teacher.post("/classes", json={"leader_id": leader["id"], "name": "Privacy class"})
        assert classroom_response.status_code == 200, classroom_response.text
        classroom = classroom_response.json()

        print("Signing up first student", flush=True)
        student = await signup(first_student, "student1@example.com", "class_student")
        print("Joining and submitting feedback", flush=True)
        joined = await first_student.post("/classes/join", json={"learner_id": student["id"], "join_code": classroom["join_code"]})
        assert joined.status_code == 200, joined.text
        feedback = await first_student.post("/peer-feedback", json={
            "learner_id": student["id"],
            "reviewer_name": "ignored",
            "topic": "Vectors",
            "rating": 2,
            "clarity": 2,
            "accessibility": 2,
            "modality_fit": 2,
            "comment": "This lesson was sh1t.",
        })
        assert feedback.status_code == 200, feedback.text

        print("Signing up second student", flush=True)
        other = await signup(second_student, "student2@example.com", "class_student")
        denied = await second_student.get("/student/classroom", params={"learner_id": student["id"]})
        assert denied.status_code == 403, denied.text
        own = await second_student.get("/student/classroom", params={"learner_id": other["id"]})
        assert own.status_code == 200, own.text

        print("Checking dashboard", flush=True)
        dashboard = await teacher.get("/teacher/dashboard", params={"leader_id": leader["id"]})
        assert dashboard.status_code == 200, dashboard.text
        flags = dashboard.json()["feedback_flags"]
        assert len(flags) == 1 and flags[0]["learner_id"] == student["id"]
        assert "[removed]" in flags[0]["preview"]

        dismissed = await teacher.post(
            f"/teacher/feedback/{flags[0]['feedback_id']}/dismiss",
            json={"leader_id": leader["id"]},
        )
        assert dismissed.status_code == 204, dismissed.text
        refreshed = await teacher.get("/teacher/dashboard", params={"leader_id": leader["id"]})
        assert refreshed.status_code == 200, refreshed.text
        assert refreshed.json()["feedback_flags"] == []

    await app.router.shutdown()
    print("Authenticated privacy and feedback HTTP contract passed.")
    # ponytail: Chroma owns a telemetry thread; this standalone check has no more work to flush.
    os._exit(0)


if __name__ == "__main__":
    asyncio.run(run())
