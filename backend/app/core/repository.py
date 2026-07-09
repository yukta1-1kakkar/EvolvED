from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict
from uuid import uuid4

import sqlalchemy as sa

from app.core import models
from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.db import models as db_models

logger = logging.getLogger(__name__)
_LOCAL_LEARNERS: dict[str, db_models.Learner] = {}
_LOCAL_EMAIL_INDEX: dict[str, str] = {}
_LOCAL_SESSIONS: dict[tuple[str, str], Dict[str, Any]] = {}
_LOCAL_QUIZZES: list[Dict[str, Any]] = []
_LOCAL_ASSESSMENTS: list[Dict[str, Any]] = []
_LOCAL_CLASSES: dict[str, Dict[str, Any]] = {}
_LOCAL_ENROLLMENTS: list[Dict[str, str]] = []
_LOCAL_DRAFTS: dict[str, Dict[str, Any]] = {}
_LOCAL_COMPLETIONS: list[Dict[str, Any]] = []


class AsyncRepository:
    async def register_learner(self, req: models.SignupRequest) -> models.AuthUser:
        role = _normalized_role(req.role)
        if role == "module_leader":
            _require_module_leader_signup_code(req.module_leader_code)
        if role == "student" and req.age is None:
            raise ValueError("Student accounts require a learner age.")
        age_group = _age_group(req.age) if req.age is not None else None
        try:
            learner = await asyncio.wait_for(self._register_learner_db(req, role, age_group), timeout=12)
        except ValueError:
            raise
        except Exception as exc:
            logger.warning("Database signup unavailable; creating local learner: %s: %r", type(exc).__name__, exc)
            email = req.email.lower()
            if email in _LOCAL_EMAIL_INDEX:
                raise ValueError("An EvolvED account already exists for this email.")
            learner = db_models.Learner(learner_id=str(uuid4()), full_name=req.full_name.strip(), email=email, password_hash=_hash_password(req.password), role=role, age=req.age, age_group=age_group, onboarding_status="profile_pending", learner_model=_initial_model())
            _LOCAL_LEARNERS[learner.learner_id] = learner
            _LOCAL_EMAIL_INDEX[email] = learner.learner_id
        return _auth_user(learner)

    async def authenticate(self, req: models.LoginRequest) -> models.AuthUser:
        try:
            async with AsyncSessionLocal() as session:
                learner = await session.scalar(sa.select(db_models.Learner).where(db_models.Learner.email == req.email.lower()))
                if not learner or not learner.password_hash or not _verify_password(req.password, learner.password_hash):
                    raise ValueError("We could not verify those credentials.")
                if _should_promote_pending_teacher(learner):
                    learner.role = "module_leader"
                    await session.commit()
                    await session.refresh(learner)
        except Exception as exc:
            if isinstance(exc, ValueError):
                raise
            logger.warning("Database login unavailable; checking local learner: %s: %r", type(exc).__name__, exc)
            learner_id = _LOCAL_EMAIL_INDEX.get(req.email.lower())
            learner = _LOCAL_LEARNERS.get(learner_id or "")
        if not learner or not learner.password_hash or not _verify_password(req.password, learner.password_hash):
            raise ValueError("We could not verify those credentials.")
        if _should_promote_pending_teacher(learner):
            learner.role = "module_leader"
        return _auth_user(learner)

    async def upsert_learner(self, profile: models.LearnerProfile) -> models.LearnerState:
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, profile.learner_id, create=True)
                self._apply_profile(learner, profile)
                await self._initialize_curriculum(session, learner)
                await session.commit()
                await session.refresh(learner)
        except Exception as exc:
            logger.warning("Database profile save unavailable; updating local learner: %s: %r", type(exc).__name__, exc)
            learner = self._local_learner(profile.learner_id)
            self._apply_profile(learner, profile)
        return self._state(learner)

    async def get_learner_profile(self, learner_id: str) -> models.LearnerProfile:
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, learner_id)
        except Exception as exc:
            logger.warning("Database learner profile unavailable; using local profile: %s: %r", type(exc).__name__, exc)
            return self._profile(self._local_learner(learner_id))
        if not learner:
            return models.LearnerProfile(learner_id=learner_id)
        return self._profile(learner)

    async def _register_learner_db(self, req: models.SignupRequest, role: str, age_group: str | None) -> db_models.Learner:
        async with AsyncSessionLocal() as session:
            existing = await session.scalar(sa.select(db_models.Learner).where(db_models.Learner.email == req.email.lower()))
            if existing:
                if role == "module_leader" and existing.password_hash and _verify_password(req.password, existing.password_hash):
                    existing.role = "module_leader"
                    existing.age = None
                    existing.age_group = None
                    await session.commit()
                    await session.refresh(existing)
                    return existing
                raise ValueError("An EvolvED account already exists for this email.")
            learner = db_models.Learner(
                learner_id=str(uuid4()),
                full_name=req.full_name.strip(),
                email=req.email.lower(),
                password_hash=_hash_password(req.password),
                role=role,
                age=req.age,
                age_group=age_group,
                onboarding_status="profile_pending",
                learner_model=_initial_model(),
            )
            session.add(learner)
            await session.commit()
            await session.refresh(learner)
            return learner

    async def get_learner_state(self, learner_id: str) -> models.LearnerState:
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, learner_id, create=True)
                await session.commit()
                await session.refresh(learner)
        except Exception as exc:
            logger.warning("Database learner state unavailable; using local state: %s: %r", type(exc).__name__, exc)
            return self._state(self._local_learner(learner_id))
        return self._state(learner)

    async def get_learner_context(self, learner_id: str) -> tuple[models.LearnerProfile, models.LearnerState]:
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, learner_id, create=True)
                await session.commit()
                await session.refresh(learner)
        except Exception as exc:
            logger.warning("Database learner context unavailable; using local learner context: %s: %r", type(exc).__name__, exc)
            learner = self._local_learner(learner_id)
        return self._profile(learner), self._state(learner)

    async def persist_lesson(self, learner_id: str, blueprint: models.LessonBlueprint, package: Dict[str, Any]) -> Dict[str, Any]:
        state = {"lesson": blueprint.model_dump(), **package, "status": "lesson_ready"}
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, learner_id, create=True)
                record = await session.scalar(sa.select(db_models.Session).where(db_models.Session.session_id == blueprint.lesson_id))
                if record:
                    record.state = state
                else:
                    record = db_models.Session(session_id=blueprint.lesson_id, learner_id=learner.id, state=state)
                    session.add(record)
                await session.commit()
                await session.refresh(record)
            return {"session_id": record.session_id, "updated_at": record.updated_at.isoformat()}
        except Exception as exc:
            logger.warning("Database lesson persistence unavailable; storing local session: %s: %r", type(exc).__name__, exc)
            _LOCAL_SESSIONS[(learner_id, blueprint.lesson_id)] = state
            return {"session_id": blueprint.lesson_id, "updated_at": _iso(datetime.now(timezone.utc))}

    async def persist_roadmap(self, learner_id: str, roadmap: models.LessonRoadmapResponse) -> Dict[str, Any]:
        roadmap_id = f"roadmap:{learner_id}:{uuid4()}"
        state = {"roadmap": roadmap.model_dump(), "status": "roadmap_ready"}
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, learner_id, create=True)
                record = db_models.Session(session_id=roadmap_id, learner_id=learner.id, state=state)
                session.add(record)
                await session.commit()
                await session.refresh(record)
            return {"session_id": record.session_id, "updated_at": record.updated_at.isoformat()}
        except Exception as exc:
            logger.warning("Database roadmap persistence unavailable; storing local session: %s: %r", type(exc).__name__, exc)
            _LOCAL_SESSIONS[(learner_id, roadmap_id)] = state
            return {"session_id": roadmap_id, "updated_at": _iso(datetime.now(timezone.utc))}

    async def get_session_state(self, learner_id: str, session_id: str) -> Dict[str, Any]:
        if session_id.startswith("published:"):
            draft_id = session_id.removeprefix("published:")
            try:
                async with AsyncSessionLocal() as session:
                    learner = await self._learner(session, learner_id)
                    if learner:
                        draft = await session.scalar(
                            sa.select(db_models.ContentDraft)
                            .join(db_models.Enrollment, db_models.Enrollment.class_id == db_models.ContentDraft.class_id)
                            .where(
                                db_models.ContentDraft.draft_id == draft_id,
                                db_models.ContentDraft.status == "accepted",
                                db_models.Enrollment.student_id == learner.id,
                                db_models.Enrollment.status == "active",
                            )
                        )
                        if draft:
                            content = draft.generated_content or {}
                            state = {
                                "lesson": {
                                    "topic": draft.title,
                                    "selected_lesson": {
                                        "id": draft.draft_id,
                                        "title": draft.title,
                                        "description": content.get("summary") or content.get("fairness", ""),
                                        "objectives": content.get("learning_objectives", []),
                                    },
                                    "learning_objective": " ".join(content.get("learning_objectives", [])[:3]),
                                    "lesson_summary": content.get("summary") or content.get("fairness", ""),
                                    "lesson_structure": content.get("sections", []),
                                    "assessment_points": content.get("questions", []),
                                },
                            }
                            state[f"published_{draft.kind}"] = content
                            return state
            except Exception as exc:
                logger.warning("Database published assessment load unavailable; using local data: %s: %r", type(exc).__name__, exc)
            class_ids = {
                item["class_id"] for item in _LOCAL_ENROLLMENTS
                if item["student_id"] == learner_id
            }
            draft = _LOCAL_DRAFTS.get(draft_id)
            if draft and draft.get("class_id") in class_ids and draft.get("kind") in {"lesson", "assessment"} and draft.get("status") == "accepted":
                content = draft.get("generated_content") or {}
                state = {
                    "lesson": {
                        "topic": draft.get("title", "Published content"),
                        "selected_lesson": {
                            "id": draft_id,
                            "title": draft.get("title", "Published content"),
                            "description": content.get("summary") or content.get("fairness", ""),
                            "objectives": content.get("learning_objectives", []),
                        },
                        "learning_objective": " ".join(content.get("learning_objectives", [])[:3]),
                        "lesson_summary": content.get("summary") or content.get("fairness", ""),
                        "lesson_structure": content.get("sections", []),
                        "assessment_points": content.get("questions", []),
                    },
                }
                state[f"published_{draft.get('kind')}"] = content
                return state
            return {}
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, learner_id)
                if not learner:
                    return _LOCAL_SESSIONS.get((learner_id, session_id), {})
                record = await session.scalar(
                    sa.select(db_models.Session).where(
                        db_models.Session.session_id == session_id,
                        db_models.Session.learner_id == learner.id,
                    )
                )
            return record.state or {} if record else _LOCAL_SESSIONS.get((learner_id, session_id), {})
        except Exception as exc:
            logger.warning("Database session load unavailable; using local session: %s: %r", type(exc).__name__, exc)
            return _LOCAL_SESSIONS.get((learner_id, session_id), {})

    async def save_interaction(self, req: models.TutorInteractionRequest, response: models.TutorInteractionResponse) -> None:
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, req.learner_id, create=True)
            session.add(
                db_models.Interaction(
                    interaction_id=response.interaction_id,
                    learner_id=learner.id,
                    session_id=req.session_id,
                    kind=req.action,
                    request=req.model_dump(),
                    response=response.model_dump(),
                )
            )
            await session.commit()

    async def save_quiz(self, learner_id: str, quiz: models.QuizResponse, topic: str | None) -> None:
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, learner_id, create=True)
                session.add(db_models.Quiz(quiz_id=quiz.quiz_id, learner_id=learner.id, session_id=quiz.session_id, topic=topic, questions=quiz.questions))
                await session.commit()
        except Exception as exc:
            logger.warning("Database quiz persistence unavailable; storing local quiz: %s: %r", type(exc).__name__, exc)
            _LOCAL_QUIZZES.append({"learner_id": learner_id, "quiz": quiz.model_dump(), "topic": topic})

    async def save_assessment_and_evolve(
        self,
        submission: models.AssessmentSubmission,
        result: models.AssessmentResult,
        decision: models.AdaptationDecision,
        evolved_model: Dict[str, Any],
    ) -> None:
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, submission.learner_id, create=True)
                session.add(db_models.Assessment(learner_id=learner.id, session_id=submission.session_id, submission=submission.model_dump(), result=result.model_dump()))
                session.add(db_models.Adaptation(learner_id=learner.id, session_id=submission.session_id, decision=decision.model_dump(), applied=True))
                learner.learner_model = evolved_model
                record = await session.scalar(sa.select(db_models.Session).where(db_models.Session.session_id == submission.session_id))
                if record:
                    record.state = {**(record.state or {}), "status": "assessed", "latest_assessment": result.model_dump(), "latest_adaptation": decision.model_dump()}
                for concept, score in result.mastery_estimates.items():
                    await self._upsert_progress(session, learner.id, concept, min(float(score), float(result.score)))
                lesson = (record.state or {}).get("lesson") if record else None
                lesson_topic = str((lesson or {}).get("topic") or "").strip() if isinstance(lesson, dict) else ""
                if lesson_topic:
                    await self._upsert_progress(session, learner.id, lesson_topic, float(result.score))
                await session.commit()
        except Exception as exc:
            logger.warning("Database assessment persistence unavailable; storing local assessment: %s: %r", type(exc).__name__, exc)
            _LOCAL_ASSESSMENTS.append({
                "learner_id": submission.learner_id,
                "session_id": submission.session_id,
                "submission": submission.model_dump(),
                "result": result.model_dump(),
                "decision": decision.model_dump(),
                "created_at": datetime.now(timezone.utc),
            })
            state = _LOCAL_SESSIONS.get((submission.learner_id, submission.session_id), {})
            if state:
                state.update({"status": "assessed", "latest_assessment": result.model_dump(), "latest_adaptation": decision.model_dump()})

    async def save_lesson_blueprint(self, learner_id: str, lesson_id: str, lesson_structure: list) -> Dict[str, Any]:
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, learner_id, create=True)
            record = await session.scalar(sa.select(db_models.Session).where(db_models.Session.session_id == lesson_id))
            state = {"lesson_id": lesson_id, "lesson_structure": lesson_structure}
            if record:
                record.state = {**(record.state or {}), **state}
            else:
                record = db_models.Session(session_id=lesson_id, learner_id=learner.id, state=state)
                session.add(record)
            await session.commit()
            await session.refresh(record)
        return {"session_id": record.session_id, "learner_id": learner.learner_id, "updated_at": record.updated_at.isoformat()}

    async def get_progress(self, learner_id: str) -> models.ProgressResponse:
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, learner_id)
                if not learner:
                    return models.ProgressResponse(learner_id=learner_id)
                rows = (await session.scalars(sa.select(db_models.CurriculumProgress).where(db_models.CurriculumProgress.learner_id == learner.id))).all()
                adaptations = (await session.scalars(sa.select(db_models.Adaptation).where(db_models.Adaptation.learner_id == learner.id).order_by(db_models.Adaptation.created_at.desc()))).all()
                assessments = (await session.scalars(sa.select(db_models.Assessment).where(db_models.Assessment.learner_id == learner.id).order_by(db_models.Assessment.created_at))).all()
                assessed_sessions = (await session.scalars(sa.select(db_models.Session).where(db_models.Session.learner_id == learner.id, db_models.Session.state["status"].as_string() == "assessed"))).all()
        except Exception as exc:
            logger.warning("Database progress unavailable; using local progress: %s: %r", type(exc).__name__, exc)
            rows = []
            adaptations = []
            assessments = [_LocalAssessment(item["submission"], item["result"], item.get("created_at")) for item in _LOCAL_ASSESSMENTS if item.get("learner_id") == learner_id]
            assessed_sessions = []
        completed = _completed_lesson_count(assessments)
        tracked_rows = [row for row in rows if float(row.mastery_score or 0.0) > 0 or row.status != "not_started"]
        mastery: dict[str, float] = {}
        for row in tracked_rows:
            concept = _progress_display_concept(row)
            mastery[concept] = max(mastery.get(concept, 0.0), float(row.mastery_score or 0.0))
        for assessed in assessed_sessions:
            state = assessed.state or {}
            lesson = state.get("lesson") if isinstance(state.get("lesson"), dict) else {}
            assessment = state.get("latest_assessment") if isinstance(state.get("latest_assessment"), dict) else {}
            topic = str(lesson.get("topic") or "").strip()
            score = assessment.get("score")
            if topic and isinstance(score, (int, float)):
                concept = str((_curriculum_item_for_concept(topic) or {}).get("concept") or topic)
                mastery[concept] = max(mastery.get(concept, 0.0), float(score))
        history = [
            {"type": "mastery", "concept": row.concept, "status": row.status, "mastery_score": row.mastery_score, "timestamp": _iso(row.updated_at)}
            for row in rows
        ] + [
            {"type": "adaptation", "action": (row.decision or {}).get("adaptations", {}).get("action", "Teaching strategy updated"), "detail": row.decision, "timestamp": _iso(row.created_at)}
            for row in adaptations
        ]
        return models.ProgressResponse(learner_id=learner_id, mastery=mastery, history=history, completed_lessons=completed, learning_streak=_learning_streak_days(assessments))

    async def get_analytics(self, learner_id: str) -> models.AnalyticsResponse:
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._learner(session, learner_id)
                if not learner:
                    return models.AnalyticsResponse(learner_id=learner_id)
                assessments = (await session.scalars(sa.select(db_models.Assessment).where(db_models.Assessment.learner_id == learner.id).order_by(db_models.Assessment.created_at))).all()
                interactions = await session.scalar(sa.select(sa.func.count(db_models.Interaction.id)).where(db_models.Interaction.learner_id == learner.id))
        except Exception as exc:
            logger.warning("Database analytics unavailable; using local analytics: %s: %r", type(exc).__name__, exc)
            learner = self._local_learner(learner_id)
            assessments = [_LocalAssessment(item["submission"], item["result"]) for item in _LOCAL_ASSESSMENTS if item.get("learner_id") == learner_id]
            interactions = 0
        learner_model = learner.learner_model or _initial_model()
        scores = [float((row.result or {}).get("score", 0.0)) for row in assessments]
        stated_confidences = _assessment_confidences(assessments)
        stated_confidence = sum(stated_confidences) / len(stated_confidences) if stated_confidences else 0.0
        performance = {
            "average_score": sum(scores) / len(scores) if scores else 0.0,
            "assessment_count": len(scores),
            "stated_confidence": stated_confidence,
            "confidence_calibration": 1 - min(1, abs((sum(scores) / len(scores) if scores else stated_confidence) - stated_confidence)) if stated_confidences else 0.0,
            "mastery_confidence": float(learner_model.get("confidence_score", 0.0)),
        }
        engagement = {"interaction_count": int(interactions or 0), "lesson_count": len(scores), "engagement_score": float(learner_model.get("engagement_score", 0.0))}
        insights = _insights(learner_model, performance)
        return models.AnalyticsResponse(learner_id=learner_id, engagement_trends=engagement, performance_trends=performance, learner_model=learner_model, insights=insights)

    async def create_class(self, req: models.ClassCreateRequest) -> models.ClassSummary:
        try:
            async with AsyncSessionLocal() as session:
                leader = await self._require_role(session, req.leader_id, "module_leader")
                record = db_models.ClassGroup(
                    class_id=str(uuid4()),
                    leader_id=leader.id,
                    name=req.name.strip(),
                    description=req.description.strip(),
                    join_code=_join_code(),
                    invite_link="",
                    max_students=req.max_students,
                    active=True,
                )
                record.invite_link = _invite_link(record.join_code)
                session.add(record)
                await session.commit()
                await session.refresh(record)
                return _class_summary(record, 0)
        except ValueError:
            raise
        except Exception as exc:
            logger.warning("Database class create unavailable; storing local class: %s: %r", type(exc).__name__, exc)
            leader = self._local_learner(req.leader_id)
            if getattr(leader, "role", "student") != "module_leader":
                raise ValueError("Only module leaders can manage classes.")
            class_id = str(uuid4())
            record = {
                "class_id": class_id,
                "leader_id": req.leader_id,
                "name": req.name.strip(),
                "description": req.description.strip(),
                "join_code": _join_code(),
                "invite_link": "",
                "max_students": req.max_students,
                "active": True,
                "created_at": datetime.now(timezone.utc),
            }
            record["invite_link"] = _invite_link(record["join_code"])
            _LOCAL_CLASSES[class_id] = record
            return models.ClassSummary(**{**record, "created_at": _iso(record["created_at"]), "student_count": 0})

    async def join_class(self, req: models.JoinClassRequest) -> models.ClassSummary:
        code = req.join_code.strip().upper()
        try:
            async with AsyncSessionLocal() as session:
                student = await self._require_role(session, req.learner_id, "student")
                class_group = await session.scalar(sa.select(db_models.ClassGroup).where(db_models.ClassGroup.join_code == code, db_models.ClassGroup.active == True))
                if not class_group:
                    raise ValueError("Class join code was not found.")
                existing = await session.scalar(sa.select(db_models.Enrollment).where(db_models.Enrollment.class_id == class_group.id, db_models.Enrollment.student_id == student.id))
                if not existing:
                    session.add(db_models.Enrollment(class_id=class_group.id, student_id=student.id, status="active"))
                    await session.commit()
                count = await session.scalar(sa.select(sa.func.count(db_models.Enrollment.id)).where(db_models.Enrollment.class_id == class_group.id, db_models.Enrollment.status == "active"))
                return _class_summary(class_group, int(count or 0))
        except ValueError:
            raise
        except Exception as exc:
            logger.warning("Database class join unavailable; storing local enrollment: %s: %r", type(exc).__name__, exc)
            class_group = next((item for item in _LOCAL_CLASSES.values() if item["join_code"] == code and item["active"]), None)
            if not class_group:
                raise ValueError("Class join code was not found.")
            if not any(item["class_id"] == class_group["class_id"] and item["student_id"] == req.learner_id for item in _LOCAL_ENROLLMENTS):
                _LOCAL_ENROLLMENTS.append({"class_id": class_group["class_id"], "student_id": req.learner_id})
            return models.ClassSummary(**{**class_group, "created_at": _iso(class_group["created_at"]), "student_count": _local_class_count(class_group["class_id"])})

    async def teacher_dashboard(self, leader_id: str) -> models.TeacherDashboardResponse:
        try:
            async with AsyncSessionLocal() as session:
                leader = await self._require_role(session, leader_id, "module_leader")
                classes = (await session.scalars(sa.select(db_models.ClassGroup).where(db_models.ClassGroup.leader_id == leader.id))).all()
                class_ids = [row.id for row in classes]
                enrollments = []
                if class_ids:
                    enrollments = (await session.scalars(sa.select(db_models.Enrollment).where(db_models.Enrollment.class_id.in_(class_ids), db_models.Enrollment.status == "active"))).all()
                student_summaries: dict[int, models.TeacherStudentSummary] = {}
                for enrollment in enrollments:
                    student = await session.get(db_models.Learner, enrollment.student_id)
                    if student:
                        summary = student_summaries.get(student.id) or await self._student_summary(session, student)
                        class_row = next((item for item in classes if item.id == enrollment.class_id), None)
                        if class_row and class_row.class_id not in summary.class_ids:
                            summary.class_ids.append(class_row.class_id)
                        student_summaries[student.id] = summary
                students = list(student_summaries.values())
                draft_rows = (await session.scalars(sa.select(db_models.ContentDraft).where(db_models.ContentDraft.leader_id == leader.id).order_by(db_models.ContentDraft.updated_at.desc()))).all()
                for draft in draft_rows:
                    healed = _healed_draft_preview(draft.kind, draft.title, draft.source_material or {}, draft.generated_content or {})
                    if healed != (draft.generated_content or {}):
                        draft.generated_content = healed
                await session.commit()
                class_summaries = [_class_summary(row, sum(1 for item in enrollments if item.class_id == row.id)) for row in classes]
        except ValueError:
            raise
        except Exception as exc:
            logger.warning("Database teacher dashboard unavailable; using local classroom data: %s: %r", type(exc).__name__, exc)
            classes = [item for item in _LOCAL_CLASSES.values() if item["leader_id"] == leader_id]
            class_summaries = [models.ClassSummary(**{**item, "created_at": _iso(item["created_at"]), "student_count": _local_class_count(item["class_id"])}) for item in classes]
            student_ids = {enrollment["student_id"] for enrollment in _LOCAL_ENROLLMENTS if enrollment["class_id"] in {item["class_id"] for item in classes}}
            students = []
            for student_id in student_ids:
                summary = self._local_student_summary(student_id)
                summary.class_ids = [enrollment["class_id"] for enrollment in _LOCAL_ENROLLMENTS if enrollment["student_id"] == student_id and enrollment["class_id"] in {item["class_id"] for item in classes}]
                students.append(summary)
            draft_rows = [item for item in _LOCAL_DRAFTS.values() if item["leader_id"] == leader_id]
            for draft in draft_rows:
                draft["generated_content"] = _healed_draft_preview(draft["kind"], draft["title"], draft.get("source_material") or {}, draft.get("generated_content") or {})
        ranked = _rank_students(students)
        totals = {
            "total_students": len(ranked),
            "average_progress": _average([item.progress for item in ranked]),
            "average_assessment_score": _average([item.average_score for item in ranked]),
            "lessons_published": sum(1 for item in draft_rows if _draft_kind(item) == "lesson" and _draft_status(item) == "accepted"),
            "pending_lesson_approvals": sum(1 for item in draft_rows if _draft_kind(item) == "lesson" and _draft_status(item) in {"draft", "changes_requested"}),
            "pending_assessment_approvals": sum(1 for item in draft_rows if _draft_kind(item) == "assessment" and _draft_status(item) in {"draft", "changes_requested"}),
        }
        return models.TeacherDashboardResponse(
            leader_id=leader_id,
            classes=class_summaries,
            students=ranked,
            drafts=[_draft_response(item) if hasattr(item, "draft_id") else _local_draft_response(item) for item in draft_rows],
            totals=totals,
        )

    async def teacher_student_analytics(self, leader_id: str, student_id: str) -> models.StudentAnalyticsResponse:
        dashboard = await self.teacher_dashboard(leader_id)
        student = next((item for item in dashboard.students if item.learner_id == student_id), None)
        if not student:
            raise ValueError("Student is not enrolled in one of this module leader's classes.")
        analytics = await self.get_analytics(student_id)
        progress = await self.get_progress(student_id)
        profile = await self.get_learner_profile(student_id)
        return models.StudentAnalyticsResponse(
            student=student,
            learning_style=profile.preferred_modality,
            behaviour_analysis={**analytics.engagement_trends, "learning_velocity": progress.completed_lessons},
            assessment_history=[item for item in progress.history if item.get("type") in {"mastery", "adaptation"}],
            strengths=[str(item) for item in (analytics.learner_model.get("strong_topics") or [])],
            weaknesses=[str(item) for item in (analytics.learner_model.get("weak_topics") or [])],
            recommendations=analytics.insights,
            concept_mastery=progress.mastery,
            tutor_usage=int(analytics.engagement_trends.get("interaction_count") or 0),
        )

    async def student_classroom(self, learner_id: str) -> models.StudentClassroomResponse:
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._require_role(session, learner_id, "student")
                enrollments = (await session.scalars(sa.select(db_models.Enrollment).where(db_models.Enrollment.student_id == learner.id, db_models.Enrollment.status == "active"))).all()
                class_rows = [row for row in [await session.get(db_models.ClassGroup, enrollment.class_id) for enrollment in enrollments] if row]
                leaders = {row.leader_id: await session.get(db_models.Learner, row.leader_id) for row in class_rows}
                class_ids = [row.id for row in class_rows]
                drafts = []
                if class_ids:
                    drafts = (await session.scalars(sa.select(db_models.ContentDraft).where(db_models.ContentDraft.class_id.in_(class_ids), db_models.ContentDraft.status == "accepted").order_by(db_models.ContentDraft.updated_at.desc()))).all()
                assessments = (await session.scalars(sa.select(db_models.Assessment).where(db_models.Assessment.learner_id == learner.id).order_by(db_models.Assessment.created_at.desc()))).all()
                completions = (await session.scalars(sa.select(db_models.ContentCompletion).where(db_models.ContentCompletion.learner_id == learner.id).order_by(db_models.ContentCompletion.completed_at.desc()))).all()
                completion_by_draft = {item.draft_id: item for item in completions}
                classes = [_class_summary(row, 0) for row in class_rows]
                alerts = [_student_alert(draft, next((item for item in class_rows if item.id == draft.class_id), None), leaders.get(draft.leader_id), completion_by_draft.get(draft.id)) for draft in drafts]
                results = [
                    _completion_result(item, next((draft for draft in drafts if draft.id == item.draft_id), None))
                    for item in completions
                    if next((draft for draft in drafts if draft.id == item.draft_id), None)
                ]
                results.extend(_student_result(row) for row in assessments if not str(row.session_id or "").startswith("published:"))
        except ValueError:
            raise
        except Exception as exc:
            logger.warning("Database student classroom unavailable; using local classroom data: %s: %r", type(exc).__name__, exc)
            class_ids = [item["class_id"] for item in _LOCAL_ENROLLMENTS if item["student_id"] == learner_id]
            local_classes = [item for item in _LOCAL_CLASSES.values() if item["class_id"] in class_ids]
            classes = [models.ClassSummary(**{**item, "created_at": _iso(item["created_at"]), "student_count": _local_class_count(item["class_id"])}) for item in local_classes]
            local_completions = [item for item in _LOCAL_COMPLETIONS if item["learner_id"] == learner_id]
            alerts = [_local_student_alert(draft, next((item for item in local_classes if item["class_id"] == draft.get("class_id")), None), next((item for item in local_completions if item["draft_id"] == draft.get("draft_id")), None)) for draft in _LOCAL_DRAFTS.values() if draft.get("class_id") in class_ids and draft.get("status") == "accepted"]
            results = [_local_completion_result(item, _LOCAL_DRAFTS.get(item["draft_id"])) for item in local_completions]
            results.extend(_local_student_result(item) for item in _LOCAL_ASSESSMENTS if item.get("learner_id") == learner_id and not str(item.get("session_id") or "").startswith("published:"))
        results.sort(key=lambda item: item.created_at or "", reverse=True)
        return models.StudentClassroomResponse(learner_id=learner_id, classes=classes, alerts=alerts, results=results)

    async def complete_published_content(
        self,
        req: models.PublishedContentCompletionRequest,
        *,
        score: float = 1.0,
        evaluation: str = "",
    ) -> models.PublishedContentCompletionResponse:
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._require_role(session, req.learner_id, "student")
                draft = await session.scalar(
                    sa.select(db_models.ContentDraft)
                    .join(db_models.Enrollment, db_models.Enrollment.class_id == db_models.ContentDraft.class_id)
                    .where(
                        db_models.ContentDraft.draft_id == req.draft_id,
                        db_models.ContentDraft.status == "accepted",
                        db_models.Enrollment.student_id == learner.id,
                        db_models.Enrollment.status == "active",
                    )
                )
                if not draft:
                    raise ValueError("Published content was not found in one of your joined classes.")
                completion = await session.scalar(
                    sa.select(db_models.ContentCompletion).where(
                        db_models.ContentCompletion.learner_id == learner.id,
                        db_models.ContentCompletion.draft_id == draft.id,
                    )
                )
                if not completion:
                    completion = db_models.ContentCompletion(
                        learner_id=learner.id,
                        draft_id=draft.id,
                        kind=draft.kind,
                        score=max(0.0, min(1.0, score)),
                        evaluation=evaluation or _completion_evaluation(draft.kind, draft.title, score),
                    )
                    session.add(completion)
                elif draft.kind == "assessment":
                    completion.score = max(0.0, min(1.0, score))
                    completion.evaluation = evaluation or completion.evaluation
                await session.commit()
                await session.refresh(completion)
                return _completion_response(completion, draft.draft_id)
        except ValueError:
            raise
        except Exception as exc:
            logger.warning("Database content completion unavailable; storing locally: %s: %r", type(exc).__name__, exc)
            class_ids = {item["class_id"] for item in _LOCAL_ENROLLMENTS if item["student_id"] == req.learner_id}
            draft = _LOCAL_DRAFTS.get(req.draft_id)
            if not draft or draft.get("class_id") not in class_ids or draft.get("status") != "accepted":
                raise ValueError("Published content was not found in one of your joined classes.")
            completion = next((item for item in _LOCAL_COMPLETIONS if item["learner_id"] == req.learner_id and item["draft_id"] == req.draft_id), None)
            if not completion:
                completion = {
                    "learner_id": req.learner_id,
                    "draft_id": req.draft_id,
                    "kind": draft["kind"],
                    "score": max(0.0, min(1.0, score)),
                    "evaluation": evaluation or _completion_evaluation(draft["kind"], draft["title"], score),
                    "completed_at": datetime.now(timezone.utc),
                }
                _LOCAL_COMPLETIONS.append(completion)
            return models.PublishedContentCompletionResponse(
                draft_id=req.draft_id,
                kind=completion["kind"],
                completed=True,
                score=float(completion["score"]),
                evaluation=completion["evaluation"],
                completed_at=_iso(completion["completed_at"]),
            )

    async def start_published_content(self, req: models.PublishedContentCompletionRequest) -> Dict[str, bool]:
        session_id = f"published-start:{req.learner_id}:{req.draft_id}"
        try:
            async with AsyncSessionLocal() as session:
                learner = await self._require_role(session, req.learner_id, "student")
                draft = await session.scalar(
                    sa.select(db_models.ContentDraft)
                    .join(db_models.Enrollment, db_models.Enrollment.class_id == db_models.ContentDraft.class_id)
                    .where(
                        db_models.ContentDraft.draft_id == req.draft_id,
                        db_models.ContentDraft.status == "accepted",
                        db_models.Enrollment.student_id == learner.id,
                        db_models.Enrollment.status == "active",
                    )
                )
                if not draft:
                    raise ValueError("Published content was not found in one of your joined classes.")
                if not await session.scalar(sa.select(db_models.Session).where(db_models.Session.session_id == session_id)):
                    session.add(db_models.Session(
                        session_id=session_id,
                        learner_id=learner.id,
                        state={"lesson": {"topic": draft.title}, "status": "started"},
                    ))
                    await session.commit()
                return {"started": True}
        except ValueError:
            raise
        except Exception as exc:
            logger.warning("Database published content start unavailable; storing local session: %s: %r", type(exc).__name__, exc)
            class_ids = {item["class_id"] for item in _LOCAL_ENROLLMENTS if item["student_id"] == req.learner_id}
            draft = _LOCAL_DRAFTS.get(req.draft_id)
            if not draft or draft.get("class_id") not in class_ids or draft.get("status") != "accepted":
                raise ValueError("Published content was not found in one of your joined classes.")
            _LOCAL_SESSIONS[(req.learner_id, session_id)] = {
                "lesson": {"topic": draft["title"]},
                "status": "started",
            }
            return {"started": True}

    async def create_content_draft(self, req: models.ContentDraftRequest) -> models.ContentDraftResponse:
        try:
            async with AsyncSessionLocal() as session:
                leader = await self._require_role(session, req.leader_id, "module_leader")
                class_row = await self._owned_class(session, leader.id, req.class_id) if req.class_id else await session.scalar(
                    sa.select(db_models.ClassGroup).where(db_models.ClassGroup.leader_id == leader.id, db_models.ClassGroup.active == True).order_by(db_models.ClassGroup.created_at)
                )
                if not class_row:
                    raise ValueError("Create a classroom before generating content for class students.")
                draft = db_models.ContentDraft(
                    draft_id=str(uuid4()),
                    leader_id=leader.id,
                    class_id=class_row.id if class_row else None,
                    kind=req.kind,
                    title=req.title.strip(),
                    source_material=req.source_material,
                    generated_content=_draft_preview(req),
                    status="draft",
                    approval={},
                )
                session.add(draft)
                await session.commit()
                await session.refresh(draft)
                return _draft_response(draft)
        except ValueError:
            raise
        except Exception as exc:
            logger.warning("Database draft create unavailable; storing local draft: %s: %r", type(exc).__name__, exc)
            draft_id = str(uuid4())
            draft = {"draft_id": draft_id, "leader_id": req.leader_id, "class_id": req.class_id, "kind": req.kind, "title": req.title.strip(), "source_material": req.source_material, "generated_content": _draft_preview(req), "status": "draft", "approval": {}}
            _LOCAL_DRAFTS[draft_id] = draft
            return models.ContentDraftResponse(**{key: draft[key] for key in ("draft_id", "kind", "title", "status", "source_material", "generated_content", "approval")})

    async def approve_content_draft(self, draft_id: str, req: models.ApprovalRequest) -> models.ContentDraftResponse:
        status = "accepted" if req.decision == "accept" else "rejected" if req.decision == "reject" else "changes_requested"
        approval = {"decision": req.decision, "instructions": req.instructions.strip(), "decided_at": _iso(datetime.now(timezone.utc))}
        try:
            async with AsyncSessionLocal() as session:
                leader = await self._require_role(session, req.leader_id, "module_leader")
                draft = await session.scalar(sa.select(db_models.ContentDraft).where(db_models.ContentDraft.draft_id == draft_id, db_models.ContentDraft.leader_id == leader.id))
                if not draft:
                    raise ValueError("Draft was not found for this module leader.")
                if req.decision == "accept" and draft.class_id is None:
                    class_row = await session.scalar(
                        sa.select(db_models.ClassGroup).where(db_models.ClassGroup.leader_id == leader.id, db_models.ClassGroup.active == True).order_by(db_models.ClassGroup.created_at)
                    )
                    if not class_row:
                        raise ValueError("Select or create a classroom before publishing this content.")
                    draft.class_id = class_row.id
                draft.status = status
                draft.approval = approval
                if req.decision == "request_changes":
                    draft.generated_content = _regenerated_draft_preview(
                        req.leader_id,
                        draft.kind,
                        draft.title,
                        draft.source_material or {},
                        req.instructions.strip(),
                    )
                if req.decision == "reject":
                    replacement_req = models.ContentDraftRequest(
                        leader_id=req.leader_id,
                        kind=draft.kind,
                        title=draft.title,
                        source_material={
                            **(draft.source_material or {}),
                            "regenerated_from_rejected_draft": draft.draft_id,
                            "rejection_instructions": req.instructions.strip(),
                        },
                    )
                    replacement = db_models.ContentDraft(
                        draft_id=str(uuid4()),
                        leader_id=leader.id,
                        class_id=draft.class_id,
                        kind=draft.kind,
                        title=draft.title,
                        source_material=replacement_req.source_material,
                        generated_content={
                            **_draft_preview(replacement_req),
                            "regeneration_reason": req.instructions.strip() or "Previous draft was rejected by the module leader.",
                        },
                        status="draft",
                        approval={"generated_after_rejection": draft.draft_id},
                    )
                    session.add(replacement)
                    await session.commit()
                    await session.refresh(replacement)
                    return _draft_response(replacement)
                await session.commit()
                await session.refresh(draft)
                return _draft_response(draft)
        except ValueError:
            raise
        except Exception as exc:
            logger.warning("Database draft approval unavailable; updating local draft: %s: %r", type(exc).__name__, exc)
            draft = _LOCAL_DRAFTS.get(draft_id)
            if not draft or draft["leader_id"] != req.leader_id:
                raise ValueError("Draft was not found for this module leader.")
            draft["status"] = status
            draft["approval"] = approval
            if req.decision == "request_changes":
                draft["generated_content"] = _regenerated_draft_preview(
                    req.leader_id,
                    draft["kind"],
                    draft["title"],
                    draft.get("source_material") or {},
                    req.instructions.strip(),
                )
            if req.decision == "reject":
                replacement_id = str(uuid4())
                replacement_req = models.ContentDraftRequest(
                    leader_id=req.leader_id,
                    class_id=draft.get("class_id"),
                    kind=draft["kind"],
                    title=draft["title"],
                    source_material={
                        **(draft.get("source_material") or {}),
                        "regenerated_from_rejected_draft": draft_id,
                        "rejection_instructions": req.instructions.strip(),
                    },
                )
                replacement = {
                    "draft_id": replacement_id,
                    "leader_id": req.leader_id,
                    "class_id": draft.get("class_id"),
                    "kind": draft["kind"],
                    "title": draft["title"],
                    "source_material": replacement_req.source_material,
                    "generated_content": {
                        **_draft_preview(replacement_req),
                        "regeneration_reason": req.instructions.strip() or "Previous draft was rejected by the module leader.",
                    },
                    "status": "draft",
                    "approval": {"generated_after_rejection": draft_id},
                }
                _LOCAL_DRAFTS[replacement_id] = replacement
                return models.ContentDraftResponse(**{key: replacement[key] for key in ("draft_id", "kind", "title", "status", "source_material", "generated_content", "approval")})
            return models.ContentDraftResponse(**{key: draft[key] for key in ("draft_id", "kind", "title", "status", "source_material", "generated_content", "approval")})

    def _state(self, learner: db_models.Learner) -> models.LearnerState:
        model = {**_initial_model(), **(learner.learner_model or {})}
        return models.LearnerState(
            learner_id=learner.learner_id,
            knowledge_level=model.get("knowledge_level") or learner.topic_familiarity or "novice",
            pace_preference=model.get("pace_preference") or learner.pace_preference,
            preferred_modalities=model.get("preferred_modalities") or learner.preferred_modality or [],
            weak_topics=model.get("weak_topics") or [],
            strong_topics=model.get("strong_topics") or [],
            confidence_score=float(model.get("confidence_score", 0.0)),
            engagement_score=float(model.get("engagement_score", 0.0)),
            cognitive_load_estimate=float(model.get("cognitive_load_estimate", 0.0)),
            misconception_registry=model.get("misconception_registry") or [],
            adaptation_history=model.get("adaptation_history") or [],
        )

    def _profile(self, learner: db_models.Learner) -> models.LearnerProfile:
        return models.LearnerProfile(
            learner_id=learner.learner_id,
            age_group=learner.age_group,
            education_level=learner.education_level,
            learning_goal=learner.learning_goal,
            pace_preference=learner.pace_preference,
            preferred_modality=learner.preferred_modality or [],
            topic=learner.topic,
            topic_familiarity=learner.topic_familiarity,
            accessibility=learner.accessibility or {},
            learning_availability=learner.learning_availability,
            learning_project=learner.learning_project,
        )

    async def _learner(self, session, learner_id: str, create: bool = False):
        learner = await session.scalar(sa.select(db_models.Learner).where(db_models.Learner.learner_id == learner_id))
        if not learner and create:
            learner = db_models.Learner(learner_id=learner_id, learner_model=_initial_model())
            session.add(learner)
            await session.flush()
        return learner

    async def _require_role(self, session, learner_id: str, role: str):
        learner = await self._learner(session, learner_id)
        if not learner and role == "module_leader":
            logger.warning("Recovering stale module leader workspace id after missing account lookup: %s", learner_id)
            learner = db_models.Learner(
                learner_id=learner_id,
                full_name="Module Leader",
                role="module_leader",
                onboarding_status="profile_pending",
                learner_model=_initial_model(),
            )
            session.add(learner)
            await session.flush()
        if not learner:
            raise ValueError("Account was not found.")
        if (learner.role or "student") != role:
            raise ValueError(f"Requires {role.replace('_', ' ')} access.")
        return learner

    async def _owned_class(self, session, leader_pk: int, class_id: str):
        row = await session.scalar(sa.select(db_models.ClassGroup).where(db_models.ClassGroup.class_id == class_id, db_models.ClassGroup.leader_id == leader_pk))
        if not row:
            raise ValueError("Class was not found for this module leader.")
        return row

    async def _student_summary(self, session, learner: db_models.Learner) -> models.TeacherStudentSummary:
        assessments = (await session.scalars(sa.select(db_models.Assessment).where(db_models.Assessment.learner_id == learner.id).order_by(db_models.Assessment.created_at))).all()
        sessions = (await session.scalars(sa.select(db_models.Session).where(db_models.Session.learner_id == learner.id).order_by(db_models.Session.updated_at.desc()))).all()
        progress_rows = (await session.scalars(sa.select(db_models.CurriculumProgress).where(db_models.CurriculumProgress.learner_id == learner.id))).all()
        enrollments = (await session.scalars(sa.select(db_models.Enrollment).where(db_models.Enrollment.student_id == learner.id, db_models.Enrollment.status == "active"))).all()
        class_ids = [item.class_id for item in enrollments]
        published = (await session.scalars(sa.select(db_models.ContentDraft).where(db_models.ContentDraft.class_id.in_(class_ids), db_models.ContentDraft.status == "accepted"))).all() if class_ids else []
        completions = (await session.scalars(sa.select(db_models.ContentCompletion).where(db_models.ContentCompletion.learner_id == learner.id).order_by(db_models.ContentCompletion.completed_at.desc()))).all()
        scores = [float((row.result or {}).get("score", 0.0)) for row in assessments]
        current_draft = next((item for item in published if completions and item.id == completions[0].draft_id), None)
        current_lesson = current_draft.title if current_draft else _current_lesson_title(sessions)
        adaptive_progress = _average([float(row.mastery_score or 0.0) for row in progress_rows])
        progress = len({item.draft_id for item in completions}) / len(published) if published else adaptive_progress
        last_active = max([row.updated_at for row in sessions if row.updated_at] + [row.completed_at for row in completions if row.completed_at] + [learner.updated_at or learner.created_at])
        return models.TeacherStudentSummary(
            learner_id=learner.learner_id,
            name=learner.full_name or "Learner",
            progress=progress,
            completed_lessons=sum(1 for item in completions if item.kind == "lesson"),
            current_lesson=current_lesson,
            average_score=_average(scores),
            assessment_scores=scores,
            accessibility_settings=learner.accessibility or {},
            last_active=_iso(last_active),
            status=_student_status(progress, scores),
        )

    def _local_learner(self, learner_id: str) -> db_models.Learner:
        learner = _LOCAL_LEARNERS.get(learner_id)
        if not learner:
            learner = db_models.Learner(
                learner_id=learner_id,
                full_name="Learner",
                onboarding_status="complete",
                learner_model=_initial_model(),
            )
            _LOCAL_LEARNERS[learner_id] = learner
        return learner

    def _local_student_summary(self, learner_id: str) -> models.TeacherStudentSummary:
        learner = self._local_learner(learner_id)
        assessments = [item for item in _LOCAL_ASSESSMENTS if item.get("learner_id") == learner_id]
        scores = [float((item.get("result") or {}).get("score", 0.0)) for item in assessments]
        class_ids = {item["class_id"] for item in _LOCAL_ENROLLMENTS if item["student_id"] == learner_id}
        published = [item for item in _LOCAL_DRAFTS.values() if item.get("class_id") in class_ids and item.get("status") == "accepted"]
        completions = [item for item in _LOCAL_COMPLETIONS if item["learner_id"] == learner_id]
        progress = len(completions) / len(published) if published else _average(scores)
        has_session = any(session_learner_id == learner_id for session_learner_id, _ in _LOCAL_SESSIONS)
        return models.TeacherStudentSummary(
            learner_id=learner.learner_id,
            name=learner.full_name or "Learner",
            progress=progress,
            completed_lessons=sum(1 for item in completions if item["kind"] == "lesson"),
            current_lesson=str((_LOCAL_DRAFTS.get(completions[-1]["draft_id"]) or {}).get("title") or ("Lesson in progress" if has_session else "Not started")) if completions else ("Lesson in progress" if has_session else "Not started"),
            average_score=_average(scores),
            assessment_scores=scores,
            accessibility_settings=learner.accessibility or {},
            last_active=_iso(datetime.now(timezone.utc)),
            status=_student_status(progress, scores),
        )

    def _apply_profile(self, learner: db_models.Learner, profile: models.LearnerProfile) -> None:
        learner.age_group = profile.age_group
        learner.education_level = profile.education_level
        learner.learning_goal = profile.learning_goal
        learner.pace_preference = profile.pace_preference
        learner.preferred_modality = profile.preferred_modality
        learner.topic = profile.topic
        learner.topic_familiarity = profile.topic_familiarity
        learner.accessibility = profile.accessibility
        learner.learning_availability = profile.learning_availability
        learner.learning_project = profile.learning_project
        learner.onboarding_status = "complete"
        learner.learner_model = {
            **_initial_model(),
            **(learner.learner_model or {}),
            "knowledge_level": profile.topic_familiarity or "novice",
            "preferred_modalities": profile.preferred_modality,
            "pace_preference": profile.pace_preference,
            "learning_availability": profile.learning_availability,
        }

    async def _initialize_curriculum(self, session, learner: db_models.Learner) -> None:
        for item in _curriculum():
            exists = await session.scalar(sa.select(db_models.CurriculumProgress).where(db_models.CurriculumProgress.learner_id == learner.id, db_models.CurriculumProgress.curriculum_item_id == item["id"]))
            if not exists:
                session.add(db_models.CurriculumProgress(learner_id=learner.id, curriculum_item_id=item["id"], topic=item["topic"], concept=item["concept"], status="recommended" if item["topic"].lower() in (learner.topic or "").lower() else "not_started", mastery_score=0.0, progress_metadata={}))

    async def _upsert_progress(self, session, learner_id: int, concept: str, score: float) -> None:
        item = _curriculum_item_for_concept(concept)
        item_id = str(item.get("id") if item else _progress_key(concept))[:128]
        record = await session.scalar(sa.select(db_models.CurriculumProgress).where(db_models.CurriculumProgress.learner_id == learner_id, db_models.CurriculumProgress.curriculum_item_id == item_id))
        if not record:
            record = db_models.CurriculumProgress(
                learner_id=learner_id,
                curriculum_item_id=item_id,
                topic=str(item.get("topic") if item else concept),
                concept=str(item.get("concept") if item else concept),
                progress_metadata={},
            )
            session.add(record)
        record.mastery_score = max(float(record.mastery_score or 0.0), float(score))
        record.status = "mastered" if record.mastery_score >= 0.8 else "in_progress"


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 390000)
    return f"pbkdf2_sha256$390000${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def _verify_password(password: str, encoded: str) -> bool:
    algorithm, iterations, salt, expected = encoded.split("$", 3)
    if algorithm != "pbkdf2_sha256":
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt), int(iterations))
    return hmac.compare_digest(actual, base64.b64decode(expected))


def _auth_user(learner: db_models.Learner) -> models.AuthUser:
    return models.AuthUser(
        id=learner.learner_id,
        full_name=learner.full_name or "Learner",
        email=learner.email or "",
        role=learner.role or "student",
        age=learner.age,
        profile_complete=learner.onboarding_status == "complete",
        learning_topic=learner.topic,
        learning_project=learner.learning_project,
        accessibility=learner.accessibility or {},
        created_at=_iso(learner.created_at),
    )


def _should_promote_pending_teacher(learner: db_models.Learner) -> bool:
    return (learner.role or "student") == "student" and learner.age is None and learner.onboarding_status == "profile_pending"


def _require_module_leader_signup_code(value: str | None) -> None:
    expected = (settings.module_leader_signup_code or "").strip()
    if not expected:
        raise ValueError("Module leader signup is not configured. Ask an administrator for access.")
    supplied = str(value or "").strip()
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise ValueError("Enter a valid module leader access code.")


def _normalized_role(role: str | None) -> str:
    value = str(role or "student").strip().lower()
    if value in {"teacher", "module_leader", "module-leader"}:
        return "module_leader"
    if value in {"student", "individual", "learner"}:
        return "student"
    raise ValueError("Role must be student or module_leader.")


def _join_code() -> str:
    return secrets.token_urlsafe(5).replace("-", "").replace("_", "").upper()[:8]


def _invite_link(join_code: str) -> str:
    return f"/join-class?code={join_code}"


def _class_summary(row: db_models.ClassGroup, student_count: int) -> models.ClassSummary:
    return models.ClassSummary(
        class_id=row.class_id,
        name=row.name,
        description=row.description or "",
        join_code=row.join_code,
        invite_link=_invite_link(row.join_code),
        max_students=row.max_students,
        active=bool(row.active),
        created_at=_iso(row.created_at),
        student_count=student_count,
    )


def _student_alert(draft: db_models.ContentDraft, class_row: db_models.ClassGroup | None, leader: db_models.Learner | None, completion: db_models.ContentCompletion | None = None) -> models.StudentClassAlert:
    class_name = class_row.name if class_row else "Class"
    leader_name = leader.full_name if leader and leader.full_name else "Module leader"
    kind = draft.kind or "lesson"
    return models.StudentClassAlert(
        alert_id=f"{draft.draft_id}:{kind}",
        class_id=class_row.class_id if class_row else "",
        class_name=class_name,
        leader_name=leader_name,
        kind=kind,
        title=draft.title,
        draft_id=draft.draft_id,
        message=f"{leader_name} published a new {kind} in {class_name}: {draft.title}",
        published_content=_student_published_content(kind, draft.generated_content or {}),
        completed=completion is not None,
        completed_at=_iso(completion.completed_at) if completion else None,
        created_at=_iso(draft.updated_at or draft.created_at),
    )


def _local_student_alert(draft: Dict[str, Any], class_row: Dict[str, Any] | None, completion: Dict[str, Any] | None = None) -> models.StudentClassAlert:
    class_name = str((class_row or {}).get("name") or "Class")
    kind = str(draft.get("kind") or "lesson")
    title = str(draft.get("title") or "Untitled")
    return models.StudentClassAlert(
        alert_id=f"{draft.get('draft_id')}:{kind}",
        class_id=str((class_row or {}).get("class_id") or draft.get("class_id") or ""),
        class_name=class_name,
        leader_name="Module leader",
        kind=kind,
        title=title,
        draft_id=str(draft.get("draft_id") or ""),
        message=f"Module leader published a new {kind} in {class_name}: {title}",
        published_content=_student_published_content(kind, draft.get("generated_content") or {}),
        completed=completion is not None,
        completed_at=_iso(completion.get("completed_at")) if completion else None,
        created_at=_iso((draft.get("approval") or {}).get("decided_at")),
    )


def _student_result(row: db_models.Assessment) -> models.StudentAssessmentResultSummary:
    result = row.result or {}
    return models.StudentAssessmentResultSummary(
        result_id=str(row.id),
        session_id=row.session_id,
        title=str(result.get("title") or result.get("topic") or "Assessment result"),
        score=float(result.get("score") or 0.0),
        feedback=str(result.get("detailed_feedback") or result.get("feedback") or ""),
        kind="assessment",
        created_at=_iso(row.created_at),
    )


def _local_student_result(item: Dict[str, Any]) -> models.StudentAssessmentResultSummary:
    result = item.get("result") or {}
    return models.StudentAssessmentResultSummary(
        result_id=str(item.get("session_id") or uuid4()),
        session_id=str(item.get("session_id") or ""),
        title=str(result.get("title") or result.get("topic") or "Assessment result"),
        score=float(result.get("score") or 0.0),
        feedback=str(result.get("detailed_feedback") or result.get("feedback") or ""),
        kind="assessment",
        created_at=_iso(item.get("created_at")),
    )


def _completion_response(completion: db_models.ContentCompletion, draft_id: str) -> models.PublishedContentCompletionResponse:
    return models.PublishedContentCompletionResponse(
        draft_id=draft_id,
        kind=completion.kind,
        completed=True,
        score=float(completion.score),
        evaluation=completion.evaluation,
        completed_at=_iso(completion.completed_at),
    )


def _completion_result(completion: db_models.ContentCompletion, draft: db_models.ContentDraft) -> models.StudentAssessmentResultSummary:
    return models.StudentAssessmentResultSummary(
        result_id=f"completion:{completion.id}",
        session_id=f"published:{draft.draft_id}",
        title=draft.title,
        score=float(completion.score),
        feedback=completion.evaluation,
        kind=completion.kind,
        draft_id=draft.draft_id,
        created_at=_iso(completion.completed_at),
    )


def _local_completion_result(completion: Dict[str, Any], draft: Dict[str, Any] | None) -> models.StudentAssessmentResultSummary:
    return models.StudentAssessmentResultSummary(
        result_id=f"completion:{completion['draft_id']}",
        session_id=f"published:{completion['draft_id']}",
        title=str((draft or {}).get("title") or "Published content"),
        score=float(completion["score"]),
        feedback=str(completion["evaluation"]),
        kind=str(completion["kind"]),
        draft_id=str(completion["draft_id"]),
        created_at=_iso(completion["completed_at"]),
    )


def _completion_evaluation(kind: str, title: str, score: float) -> str:
    if kind == "assessment":
        return f"Assessment evaluated automatically for {title}."
    return f"Completed the full teacher-published lesson {title}. All lesson sections were reached before completion."


def _student_published_content(kind: str, content: Dict[str, Any]) -> Dict[str, Any]:
    if kind != "assessment":
        return content
    safe_content = dict(content)
    safe_content["questions"] = [
        {key: value for key, value in question.items() if key not in {"answer", "correct_answer", "explanation", "rubric"}}
        if isinstance(question, dict) else question
        for question in content.get("questions", [])
    ]
    return safe_content


def _local_class_count(class_id: str) -> int:
    return sum(1 for item in _LOCAL_ENROLLMENTS if item["class_id"] == class_id)


def _rank_students(students: list[models.TeacherStudentSummary]) -> list[models.TeacherStudentSummary]:
    ranked = sorted(students, key=lambda item: item.average_score, reverse=True)
    for index, item in enumerate(ranked, 1):
        item.rank = index
    return ranked


def _average(values: list[float]) -> float:
    clean = [float(value) for value in values if isinstance(value, (int, float))]
    return round(sum(clean) / len(clean), 3) if clean else 0.0


def _current_lesson_title(sessions: list[Any]) -> str:
    for row in sessions:
        lesson = (row.state or {}).get("lesson") if isinstance(row.state, dict) else None
        if isinstance(lesson, dict):
            return str(lesson.get("topic") or lesson.get("learning_objective") or "Lesson in progress")
    return "Not started"


def _student_status(progress: float, scores: list[float]) -> str:
    if progress >= 0.8:
        return "completed"
    if scores and _average(scores[-3:]) < 0.55:
        return "needs_help"
    return "in_progress"


def _draft_kind(item: Any) -> str:
    return str(item.kind if hasattr(item, "kind") else item.get("kind", ""))


def _draft_status(item: Any) -> str:
    return str(item.status if hasattr(item, "status") else item.get("status", ""))


def _draft_preview(req: models.ContentDraftRequest) -> Dict[str, Any]:
    source_warning = str((req.source_material or {}).get("extraction_warning") or "").lower()
    source_text = _preview_source_text(req.source_material)
    unreadable_upload = "did not expose selectable text" in source_warning or "no selectable text" in source_warning
    if _looks_unreadable_source(source_text) or (req.kind == "assessment" and unreadable_upload):
        return {
            "title": req.title,
            "source_locked": True,
            "workflow": "draft_requires_module_leader_approval",
            "needs_readable_source": True,
            "summary": "The uploaded source could not be converted into readable assessment text. Upload a text-based PDF, DOCX, PPTX, Markdown, or paste OCR text in the notes box.",
            "learning_objectives": [],
            "sections": [],
            "questions": [],
            "estimated_duration": 0,
            "difficulty": "Needs readable source",
        }
    return _assessment_preview(req.title, source_text) if req.kind == "assessment" else _lesson_preview(req.title, source_text)


def _regenerated_draft_preview(leader_id: str, kind: str, title: str, source_material: Dict[str, Any], instructions: str) -> Dict[str, Any]:
    revised_source = dict(source_material)
    if instructions:
        source_text = str(revised_source.get("text") or "")
        revised_source["text"] = f"{source_text}\n\nModule leader requested revision: {instructions}".strip()
    preview = _draft_preview(models.ContentDraftRequest(leader_id=leader_id, kind=kind, title=title, source_material=revised_source))
    return {
        **preview,
        "update_request": instructions,
        "revised_from_request": bool(instructions),
    }


def _healed_draft_preview(kind: str, title: str, source_material: Dict[str, Any], generated_content: Dict[str, Any]) -> Dict[str, Any]:
    if not _draft_needs_healing(generated_content):
        return generated_content
    healed = _draft_preview(models.ContentDraftRequest(leader_id="preview-healer", kind=kind, title=title, source_material=source_material))
    if _draft_needs_healing(healed):
        return generated_content
    return {
        **healed,
        "healed_from_source": True,
    }


def _draft_needs_healing(generated_content: Dict[str, Any]) -> bool:
    if generated_content.get("needs_readable_source"):
        return True
    summary = str(generated_content.get("summary") or "")
    questions = generated_content.get("questions") if isinstance(generated_content.get("questions"), list) else []
    question_text = " ".join(str((item or {}).get("question", "")) + " " + " ".join(map(str, (item or {}).get("options", []))) for item in questions if isinstance(item, dict))
    return bool(summary and _looks_unreadable_source(summary)) or _looks_like_fallback_assessment(question_text) or _looks_like_match_assessment(question_text)


def _draft_response(row: db_models.ContentDraft) -> models.ContentDraftResponse:
    source_material = row.source_material or {}
    generated_content = _healed_draft_preview(row.kind, row.title, source_material, row.generated_content or {})
    return models.ContentDraftResponse(
        draft_id=row.draft_id,
        kind=row.kind,
        title=row.title,
        status=row.status,
        source_material=source_material,
        generated_content=generated_content,
        approval=row.approval or {},
    )


def _local_draft_response(row: Dict[str, Any]) -> models.ContentDraftResponse:
    healed = {
        **row,
        "generated_content": _healed_draft_preview(row["kind"], row["title"], row.get("source_material") or {}, row.get("generated_content") or {}),
    }
    return models.ContentDraftResponse(**{key: healed[key] for key in ("draft_id", "kind", "title", "status", "source_material", "generated_content", "approval")})


def _lesson_preview(title: str, source_text: str) -> Dict[str, Any]:
    paragraphs = _source_paragraphs(source_text)
    sections = [
        {
            "title": _section_title(paragraph, index),
            "summary": _teaching_summary(paragraph),
            "subsections": _source_sentences(paragraph)[:3],
            "examples": [f"Use the uploaded source to discuss: {_compact(paragraph, 18)}"],
            "checks_for_understanding": [
                f"What problem does {_section_title(paragraph, index).lower()} help solve?",
                f"Name one practical use or limitation from this section.",
            ],
        }
        for index, paragraph in enumerate(paragraphs[:5], 1)
    ]
    return {
        "title": title,
        "source_locked": True,
        "workflow": "draft_requires_module_leader_approval",
        "learning_objectives": _learning_objectives(title, paragraphs),
        "summary": _lesson_summary(title, paragraphs),
        "estimated_duration": max(20, min(60, len(sections) * 10)),
        "difficulty": "Intermediate" if len(source_text.split()) > 700 else "Foundational",
        "sections": sections,
        "generated_images": [{"type": "diagram", "prompt": f"Diagram for {section['title']}"} for section in sections[:2]],
        "flowcharts": [{"title": f"{title} learning flow", "steps": [section["title"] for section in sections[:5]]}],
        "accessibility_version": {
            "font": "readable sans-serif",
            "spacing": "increased",
            "chunks": [section["title"] for section in sections[:5]],
        },
    }


def _assessment_preview(title: str, source_text: str) -> Dict[str, Any]:
    paragraphs = _source_paragraphs(source_text)
    concepts = _assessment_concepts(title, paragraphs, source_text)
    questions = [_assessment_question(concept, index) for index, concept in enumerate(concepts[:8], 1)]
    return {
        "title": title,
        "source_locked": True,
        "workflow": "draft_requires_module_leader_approval",
        "fairness": "All students receive the same source-grounded published assessment.",
        "questions": questions,
        "topic_distribution": [{"topic": question["topic"], "count": 1} for question in questions],
        "estimated_duration": max(15, min(45, len(questions) * 4)),
        "difficulty": "Intermediate" if len(source_text.split()) > 700 else "Foundational",
    }


def _assessment_concepts(title: str, paragraphs: list[str], source_text: str) -> list[dict[str, str]]:
    concepts = []
    for index, paragraph in enumerate(paragraphs, 1):
        sentences = _source_sentences(paragraph)
        if not sentences:
            continue
        concept_title = _section_title(paragraph, index)
        evidence = _compact(sentences[0], 24)
        application = _compact(sentences[1] if len(sentences) > 1 else paragraph, 24)
        concepts.append({"topic": concept_title, "evidence": evidence, "application": application})
    if len(concepts) < 5:
        for sentence in _source_sentences(_teaching_source_text(source_text)):
            if len(concepts) >= 5:
                break
            if any(item["evidence"].lower() == _compact(sentence, 24).lower() for item in concepts):
                continue
            concepts.append({
                "topic": _section_title(sentence, len(concepts) + 1),
                "evidence": _compact(sentence, 24),
                "application": _compact(sentence, 24),
            })
    if len(concepts) < 5:
        for keyword in _source_keywords(source_text):
            if len(concepts) >= 5:
                break
            concepts.append({
                "topic": keyword.title(),
                "evidence": f"{keyword} is a key concept in the uploaded source.",
                "application": f"Use {keyword} to explain the uploaded source material.",
            })
    if concepts:
        return concepts[: max(5, len(concepts))]
    return [
        {"topic": f"{title} concept {index}", "evidence": f"{title} concept {index} from the uploaded source", "application": f"Apply {title} concept {index} using the uploaded source"}
        for index in range(1, 6)
    ]


def _assessment_question(concept: dict[str, str], index: int) -> dict[str, Any]:
    topic = concept["topic"]
    evidence = concept["evidence"]
    application = concept["application"]
    if index % 5 == 0:
        return {
            "id": f"q{index}",
            "type": "short_answer",
            "bloom_level": "apply",
            "question": f"Explain one practical application of {topic.lower()} using details from the uploaded document.",
            "answer": application,
            "rubric": [
                "Mentions the source concept accurately.",
                "Gives one realistic application.",
                "Avoids claims not supported by the uploaded material.",
            ],
            "topic": topic,
        }
    if index % 5 == 4:
        return {
            "id": f"q{index}",
            "type": "short_answer",
            "bloom_level": "analyze",
            "question": f"What limitation, safety concern, or decision point should a learner consider when using {topic.lower()}?",
            "answer": application,
            "rubric": [
                "Identifies a limitation, safety issue, or decision point.",
                "Links the answer to the uploaded document.",
                "Explains why the point matters.",
            ],
            "topic": topic,
        }
    stems = _document_question_stems(topic, evidence)
    distractors = _assessment_distractors(topic)
    answer = evidence
    options = _unique_options([answer, *distractors])
    return {
        "id": f"q{index}",
        "type": "mcq",
        "bloom_level": "understand" if index <= 3 else "apply",
        "question": stems[(index - 1) % len(stems)],
        "options": options,
        "answer": answer,
        "explanation": f"The correct answer is grounded in this source evidence: {answer}",
        "topic": topic,
    }


def _assessment_distractors(topic: str) -> list[str]:
    topic_lower = topic.lower()
    return [
        f"{topic} is mentioned only as a citation detail and is not part of the document's content.",
        f"{topic} removes the need for learner interpretation or clinical judgment.",
        f"{topic} is presented as unrelated to the main subject of the uploaded document.",
        f"{topic} is described as a purely administrative step.",
    ] if any(word in topic_lower for word in ("imaging", "diagnosis", "clinical", "medical", "image", "patient", "safety")) else [
        f"{topic} is unrelated to the document's central ideas.",
        f"{topic} is only a formatting detail in the uploaded file.",
        f"{topic} contradicts the document's explanation.",
        f"{topic} can be ignored without changing the document's meaning.",
    ]


def _document_question_stems(topic: str, evidence: str) -> list[str]:
    topic_lower = _question_subject(topic)
    evidence_lower = evidence.lower()
    support_match = re.match(r"(.+?)\s+supports?\s+", evidence, flags=re.IGNORECASE)
    if support_match:
        subject = _question_subject(support_match.group(1))
        return [
            f"According to the document, what does {subject} support?",
            f"What role does {subject} play in the uploaded document?",
            f"Which idea about {subject} is explained in the document?",
        ]
    allow_match = re.match(r"(.+?)\s+allow(?:s|ing)?\s+", evidence, flags=re.IGNORECASE)
    if allow_match:
        subject = _question_subject(allow_match.group(1))
        return [
            f"According to the document, what does {subject} allow?",
            f"What capability is connected to {subject} in the uploaded document?",
            f"How does the document describe the purpose of {subject}?",
        ]
    if "will not" in evidence_lower or "not delete" in evidence_lower or "not format" in evidence_lower:
        return [
            f"What commitment does the document make about {topic_lower}?",
            f"What action does the document say will not be taken regarding {topic_lower}?",
            f"What responsibility is stated in the document about {topic_lower}?",
        ]
    if any(word in evidence_lower for word in ("must", "should", "required", "need to", "responsible")):
        return [
            f"What requirement does the document state about {topic_lower}?",
            f"What should someone do according to the document's section on {topic_lower}?",
            f"What responsibility is described for {topic_lower}?",
        ]
    if any(word in evidence_lower for word in ("include", "includes", "such as", "for example")):
        return [
            f"What examples or parts does the document give for {topic_lower}?",
            f"What does the document include under {topic_lower}?",
            f"What items are connected to {topic_lower} in the uploaded document?",
        ]
    if any(word in evidence_lower for word in ("because", "therefore", "so that", "allowing", "supports")):
        return [
            f"Why does the document say {topic_lower} matters?",
            f"What reason does the document give for {topic_lower}?",
            f"How does {topic_lower} support the document's main point?",
        ]
    return [
        f"What does the document state about {topic_lower}?",
        f"What should a reader understand about {topic_lower} from this document?",
        f"How is {topic_lower} described in the uploaded document?",
    ]


def _question_subject(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip(" .,:;!?\"'()[]{}")).lower()
    words = text.split()
    if len(words) > 8:
        text = " ".join(words[:8])
    return text or "this topic"


def _unique_options(options: list[str]) -> list[str]:
    result = []
    for option in options:
        clean = _compact(option, 22)
        if clean and clean.lower() not in {item.lower() for item in result}:
            result.append(clean)
    while len(result) < 4:
        result.append("A claim that is not supported by the uploaded source.")
    return result[:4]


def _source_keywords(source_text: str) -> list[str]:
    stopwords = {
        "about", "after", "again", "also", "and", "are", "based", "been", "being", "between", "can", "chapter",
        "could", "from", "has", "have", "into", "its", "material", "more", "source", "such", "that", "the",
        "their", "this", "through", "uploaded", "using", "was", "were", "which", "with",
    }
    words = re.findall(r"[A-Za-z][A-Za-z-]{4,}", source_text.lower())
    counts: dict[str, int] = {}
    for word in words:
        clean = word.strip("-")
        if clean and clean not in stopwords:
            counts[clean] = counts.get(clean, 0) + 1
    return [word for word, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:8]]


def _source_paragraphs(source_text: str) -> list[str]:
    cleaned = _teaching_source_text(source_text)
    if not cleaned:
        return []
    chunks = [item.strip(" -:\t") for item in cleaned.replace("\r", "\n").split("\n") if len(item.strip()) > 80]
    if len(chunks) >= 2:
        return [_compact(chunk, 55) for chunk in chunks]
    sentences = _source_sentences(cleaned)
    return [_compact(" ".join(sentences[index:index + 3]), 55) for index in range(0, len(sentences), 3)] or [_compact(cleaned, 55)]


def _teaching_source_text(source_text: str) -> str:
    sentences = _source_sentences(" ".join(str(source_text or "").replace("\r", "\n").split()))
    useful = [sentence for sentence in sentences if _is_teaching_sentence(sentence)]
    return " ".join(useful or sentences)


def _is_teaching_sentence(sentence: str) -> bool:
    text = " ".join(sentence.split())
    lower = text.lower()
    if len(text) < 45:
        return False
    if "@" in text or "corresponding author" in lower:
        return False
    if re.search(r"\b(department|institute|university|college|ghaziabad|bengaluru)\b", lower) and len(text.split()) < 35:
        return False
    if lower.startswith(("abstract", "keywords", "references", "copyright")):
        return False
    return True


def _lesson_summary(title: str, paragraphs: list[str]) -> str:
    if not paragraphs:
        return f"Uploaded source material for {title} is ready for review."
    focus = _compact(" ".join(paragraphs[:2]), 55)
    return f"This draft turns the uploaded source into a teachable lesson on {title}. It introduces the core idea, explains the main mechanisms or concepts, and prepares learners to apply the material through examples, checks, and guided discussion. Source focus: {focus}"


def _learning_objectives(title: str, paragraphs: list[str]) -> list[str]:
    objectives = []
    for index, paragraph in enumerate(paragraphs[:3], 1):
        concept = _section_title(paragraph, index).lower()
        objectives.append(f"Explain {concept} using evidence from the uploaded source.")
    return objectives or [f"Explain {title} from the uploaded source.", f"Identify key vocabulary and applications from {title}.", f"Apply the uploaded material to a guided practice task."]


def _teaching_summary(paragraph: str) -> str:
    sentences = _source_sentences(paragraph)
    if not sentences:
        return paragraph
    return _compact(" ".join(sentences[:2]), 42)


def _preview_source_text(source_material: Dict[str, Any]) -> str:
    text = str(source_material.get("text") or " ".join(str(value) for value in source_material.values()))
    if not _looks_unreadable_source(text):
        return text
    if str(source_material.get("content_type") or "").lower() == "pdf":
        recovered = _recover_pdf_text_from_noisy_text(text)
        if not _looks_unreadable_source(recovered):
            return recovered
        return _pdf_review_scaffold(str(source_material.get("filename") or "uploaded PDF"))
    return text


def _recover_pdf_text_from_noisy_text(value: str) -> str:
    chunks = []
    for sentence in re.split(r"(?<=[.!?])\s+", value):
        text = " ".join(sentence.split())
        if len(text) < 40:
            continue
        lower = text.lower()
        if any(marker in lower for marker in (" obj", " endobj", " xref", " trailer", " startxref", "/filter", "/flatedecode")):
            continue
        alpha_ratio = sum(char.isalpha() for char in text) / max(1, len(text))
        digit_ratio = sum(char.isdigit() for char in text) / max(1, len(text))
        words = re.findall(r"[A-Za-z][A-Za-z-]{2,}", text)
        if alpha_ratio >= 0.55 and digit_ratio <= 0.18 and len(words) >= 6:
            chunks.append(text)
    return " ".join(chunks[:80])


def _pdf_review_scaffold(filename: str) -> str:
    title = _compact(re.sub(r"[_-]+", " ", Path(filename).stem), 12) or "uploaded PDF"
    return (
        f"The uploaded PDF is titled {title}. Build a teacher-review lesson draft from this PDF upload. "
        "Include a source overview, key vocabulary to verify from the chapter, guided reading steps, discussion prompts, "
        "practice activities, and an assessment checklist. Ask the module leader to paste OCR text or notes before final publication "
        "if exact page-level fidelity is required."
    )


def _looks_unreadable_source(value: str) -> bool:
    text = " ".join(str(value or "").split())
    if not text:
        return True
    lower = text.lower()
    pdf_markers = sum(lower.count(marker) for marker in (" obj", " endobj", " xref", " trailer", " linearized", " startxref"))
    words = re.findall(r"[A-Za-z][A-Za-z-]{2,}", text)
    digit_ratio = sum(char.isdigit() for char in text) / max(1, len(text))
    alpha_ratio = sum(char.isalpha() for char in text) / max(1, len(text))
    return text.startswith("PDF-") or pdf_markers >= 3 or len(words) < 20 or (digit_ratio > 0.28 and alpha_ratio < 0.45)


def _looks_like_fallback_assessment(value: str) -> bool:
    lower = str(value or "").lower()
    return any(marker in lower for marker in ("file appears to be scanned", "missing selectable text", "review scaffold", "paste ocr text"))


def _looks_like_match_assessment(value: str) -> bool:
    lower = str(value or "").lower()
    return any(marker in lower for marker in ("which statement best matches", "best matches the uploaded source", "matches the uploaded source section"))


def _source_sentences(value: str) -> list[str]:
    return [item.strip() for item in re.split(r"(?<=[.!?])\s+", value) if item.strip()]


def _section_title(paragraph: str, index: int) -> str:
    words = [word.strip(".,:;()[]{}") for word in paragraph.split()[:7]]
    return " ".join(words).title() or f"Section {index}"


def _compact(value: str, max_words: int) -> str:
    words = " ".join(str(value or "").split()).split()
    return " ".join(words[:max_words]).rstrip(".,;:") + ("." if len(words) > max_words else "")


def _initial_model() -> Dict[str, Any]:
    return {"knowledge_level": "novice", "preferred_modalities": [], "weak_topics": [], "strong_topics": [], "confidence_score": 0.0, "engagement_score": 0.0, "cognitive_load_estimate": 0.0, "misconception_registry": [], "adaptation_history": []}


def _age_group(age: int) -> str:
    return "child" if age < 13 else "teen" if age < 18 else "adult"


def _curriculum() -> list[Dict[str, Any]]:
    path = Path(__file__).resolve().parents[2] / "data" / "initial_curriculum.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def _progress_key(value: str | None) -> str:
    text = str(value or "").strip().lower().replace("&", " and ")
    compact = "".join(char if char.isalnum() else "_" for char in text)
    return "_".join(part for part in compact.split("_") if part)


def _curriculum_item_for_concept(concept: str | None) -> dict[str, Any] | None:
    key = _progress_key(concept)
    if not key:
        return None
    for item in _curriculum():
        aliases = {
            _progress_key(item.get("id")),
            _progress_key(item.get("concept")),
            _progress_key(str(item.get("concept", "")).replace("_", " ")),
        }
        if key in aliases:
            return item
    return None


def _progress_display_concept(row: db_models.CurriculumProgress) -> str:
    item = _curriculum_item_for_concept(row.curriculum_item_id) or _curriculum_item_for_concept(row.concept)
    if item:
        return str(item["concept"])
    return str(row.concept or row.curriculum_item_id)


class _LocalAssessment:
    def __init__(self, submission: Dict[str, Any], result: Dict[str, Any], created_at: Any = None):
        self.submission = submission
        self.result = result
        self.session_id = submission.get("session_id")
        self.created_at = created_at or datetime.now(timezone.utc)


def _assessment_confidences(assessments: list[Any]) -> list[float]:
    values: list[float] = []
    for row in assessments:
        confidence = (getattr(row, "submission", None) or {}).get("confidence", {})
        if not isinstance(confidence, dict):
            continue
        for value in confidence.values():
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                continue
            values.append(max(0.0, min(1.0, numeric / 100 if numeric > 1 else numeric)))
    return values


def _completed_lesson_count(assessments: list[Any]) -> int:
    session_ids = {str(getattr(row, "session_id", "") or "").strip() for row in assessments}
    session_ids.discard("")
    return len(session_ids) if session_ids else len(assessments)


def _learning_streak_days(assessments: list[Any]) -> int:
    active_days = {_assessment_date(row) for row in assessments}
    active_days.discard(None)
    if not active_days:
        return 0
    today = datetime.now(timezone.utc).date()
    streak = 0
    current = today
    while current in active_days:
        streak += 1
        current -= timedelta(days=1)
    return streak


def _assessment_date(row: Any):
    value = getattr(row, "created_at", None)
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).date() if value.tzinfo else value.date()
    return None


def _iso(value) -> str:
    return value.isoformat() if value else datetime.now(timezone.utc).isoformat()


def _insights(model: Dict[str, Any], performance: Dict[str, Any]) -> list[str]:
    insights = []
    modalities = model.get("preferred_modalities") or []
    if modalities:
        insights.append(f"Your lessons currently prioritize {', '.join(_humanize_identifier(item) for item in modalities)} explanations.")
    if performance["assessment_count"]:
        insights.append(f"Your average checkpoint score is {round(performance['average_score'] * 100)}%.")
    weak = model.get("weak_topics") or []
    if weak:
        insights.append(f"Your next lesson will reinforce {', '.join(_humanize_identifier(item) for item in weak[:2])}.")
    return insights or ["Complete your first lesson assessment to unlock personalized learning insights."]


def _humanize_identifier(value: Any) -> str:
    text = str(value or "").replace("_", " ").replace("-", " ").strip()
    return " ".join(text.split())
