import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import models, repository


class FailingSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    def add(self, _):
        return None

    async def commit(self):
        raise RuntimeError("database unavailable after generation")


async def main() -> None:
    repo = repository.AsyncRepository()
    calls = 0

    async def require_role(_session, _learner_id, _role):
        return SimpleNamespace(id=1)

    async def owned_class(_session, _leader_id, _class_id):
        return SimpleNamespace(id=2)

    async def generate(_request):
        nonlocal calls
        calls += 1
        return {"title": "Generated once", "sections": [{"title": "Section"}]}

    repo._require_role = require_role
    repo._owned_class = owned_class
    original_session = repository.AsyncSessionLocal
    original_generate = repository._generate_draft_preview
    repository.AsyncSessionLocal = FailingSession
    repository._generate_draft_preview = generate
    try:
        result = await repo.create_content_draft(models.ContentDraftRequest(
            leader_id="leader-1",
            class_id="class-1",
            kind="lesson",
            title="Generated once",
            source_material={"text": "Source material"},
        ))
    finally:
        repository.AsyncSessionLocal = original_session
        repository._generate_draft_preview = original_generate

    assert calls == 1, f"generation ran {calls} times"
    assert result.generated_content["title"] == "Generated once"
    print("draft generation fallback reuses completed output: ok")


if __name__ == "__main__":
    asyncio.run(main())
