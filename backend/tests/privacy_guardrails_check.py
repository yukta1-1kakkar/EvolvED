import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException

from app.api.routers import _normalize_generated_value, _require_identity, router
from app.core.guardrails import moderation_flags, redact_inappropriate_text


def main() -> None:
    assert moderation_flags("Clear class assessment feedback") == []
    assert "profanity" in moderation_flags("That was f.u.c.k.i.n.g confusing")
    assert "[removed]" in redact_inappropriate_text("This is sh1t")
    assert "[removed]" in _normalize_generated_value("A b-a-s-t-a-r-d example")
    assert router.dependencies, "All non-auth API routes must require a server session"

    own_request = SimpleNamespace(state=SimpleNamespace(auth_user={"id": "student-1", "role": "student"}))
    _require_identity(own_request, "student-1", "student")
    try:
        _require_identity(own_request, "student-2", "student")
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("Cross-student access was not rejected")

    print("Privacy and guardrail checks passed.")


if __name__ == "__main__":
    main()
