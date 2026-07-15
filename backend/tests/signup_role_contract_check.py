import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import models
from app.core.config import settings
from app.core.repository import AsyncRepository
from app.db.models import Learner


async def main() -> None:
    captured: list[tuple[str, bool, int | None]] = []
    repo = AsyncRepository()

    async def fake_register(req, role, age_group, class_student=False):
        captured.append((role, class_student, req.age))
        return Learner(
            learner_id=f"check-{len(captured)}",
            full_name=req.full_name,
            email=req.email,
            role=role,
            age=req.age,
            age_group=age_group,
            onboarding_status="profile_pending",
            learner_model={},
            accessibility={"class_student": True} if class_student else {},
        )

    repo._register_learner_db = fake_register

    individual = await repo.register_learner(models.SignupRequest(
        full_name="Individual", email="individual@example.test", password="Password1", age=20, role="student"
    ))
    assert individual.role == "student" and not individual.accessibility.get("class_student")

    class_student = await repo.register_learner(models.SignupRequest(
        full_name="Class Student", email="class@example.test", password="Password1", role="class_student"
    ))
    assert class_student.role == "student" and class_student.accessibility.get("class_student") is True
    assert captured[-1] == ("student", True, None)

    previous_code = settings.module_leader_signup_code
    settings.module_leader_signup_code = "teacher-code"
    try:
        leader = await repo.register_learner(models.SignupRequest(
            full_name="Module Leader",
            email="leader@example.test",
            password="Password1",
            role="module_leader",
            module_leader_code="teacher-code",
        ))
    finally:
        settings.module_leader_signup_code = previous_code
    assert leader.role == "module_leader" and leader.age is None

    try:
        await repo.register_learner(models.SignupRequest(
            full_name="Missing Age", email="missing@example.test", password="Password1", role="student"
        ))
    except ValueError as exc:
        assert "age" in str(exc).lower()
    else:
        raise AssertionError("Individual students must still provide an age")

    print("signup role contracts: ok")


if __name__ == "__main__":
    asyncio.run(main())
