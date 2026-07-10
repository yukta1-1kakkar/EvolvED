import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import models
from app.core import repository as r


async def main() -> None:
    with TemporaryDirectory() as tmp:
        old_store = r._LOCAL_CLASSROOM_STORE
        old_classes = dict(r._LOCAL_CLASSES)
        old_enrollments = list(r._LOCAL_ENROLLMENTS)
        try:
            r._LOCAL_CLASSROOM_STORE = Path(tmp) / "store.json"
            r._LOCAL_CLASSES.clear()
            r._LOCAL_ENROLLMENTS.clear()
            r._LOCAL_CLASSES["c1"] = {
                "class_id": "c1",
                "leader_id": "l1",
                "name": "Test class",
                "description": "",
                "join_code": "ABC123",
                "invite_link": "/join-class?code=ABC123",
                "max_students": None,
                "active": True,
                "created_at": datetime.now(timezone.utc),
            }
            r._save_local_classroom_store()
            r._LOCAL_CLASSES.clear()
            r._LOCAL_ENROLLMENTS.clear()
            r._load_local_classroom_store()
            joined = await r.AsyncRepository().join_class(models.JoinClassRequest(learner_id="s1", join_code="abc123"))
            assert joined.class_id == "c1"
            assert r._LOCAL_ENROLLMENTS == [{"class_id": "c1", "student_id": "s1"}]
        finally:
            r._LOCAL_CLASSROOM_STORE = old_store
            r._LOCAL_CLASSES.clear()
            r._LOCAL_CLASSES.update(old_classes)
            r._LOCAL_ENROLLMENTS.clear()
            r._LOCAL_ENROLLMENTS.extend(old_enrollments)


if __name__ == "__main__":
    asyncio.run(main())
