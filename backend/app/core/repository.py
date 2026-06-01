from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict
from uuid import uuid4

import sqlalchemy as sa

from app.core import models
from app.core.db import AsyncSessionLocal
from app.db import models as db_models


class AsyncRepository:
    async def register_learner(self, req: models.SignupRequest) -> models.AuthUser:
        async with AsyncSessionLocal() as session:
            existing = await session.scalar(sa.select(db_models.Learner).where(db_models.Learner.email == req.email.lower()))
            if existing:
                raise ValueError("An EvolvED account already exists for this email.")
            learner = db_models.Learner(
                learner_id=str(uuid4()),
                full_name=req.full_name.strip(),
                email=req.email.lower(),
                password_hash=_hash_password(req.password),
                age=req.age,
                age_group=_age_group(req.age),
                onboarding_status="profile_pending",
                learner_model=_initial_model(),
            )
            session.add(learner)
            await session.commit()
            await session.refresh(learner)
        return _auth_user(learner)

    async def authenticate(self, req: models.LoginRequest) -> models.AuthUser:
        async with AsyncSessionLocal() as session:
            learner = await session.scalar(sa.select(db_models.Learner).where(db_models.Learner.email == req.email.lower()))
        if not learner or not learner.password_hash or not _verify_password(req.password, learner.password_hash):
            raise ValueError("We could not verify those credentials.")
        return _auth_user(learner)

    async def upsert_learner(self, profile: models.LearnerProfile) -> models.LearnerState:
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, profile.learner_id, create=True)
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
            await self._initialize_curriculum(session, learner)
            await session.commit()
            await session.refresh(learner)
        return self._state(learner)

    async def get_learner_profile(self, learner_id: str) -> models.LearnerProfile:
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, learner_id)
        if not learner:
            return models.LearnerProfile(learner_id=learner_id)
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

    async def get_learner_state(self, learner_id: str) -> models.LearnerState:
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, learner_id, create=True)
            await session.commit()
            await session.refresh(learner)
        return self._state(learner)

    async def persist_lesson(self, learner_id: str, blueprint: models.LessonBlueprint, package: Dict[str, Any]) -> Dict[str, Any]:
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, learner_id, create=True)
            record = await session.scalar(sa.select(db_models.Session).where(db_models.Session.session_id == blueprint.lesson_id))
            state = {"lesson": blueprint.model_dump(), **package, "status": "lesson_ready"}
            if record:
                record.state = state
            else:
                record = db_models.Session(session_id=blueprint.lesson_id, learner_id=learner.id, state=state)
                session.add(record)
            await session.commit()
            await session.refresh(record)
        return {"session_id": record.session_id, "updated_at": record.updated_at.isoformat()}

    async def get_session_state(self, learner_id: str, session_id: str) -> Dict[str, Any]:
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, learner_id)
            if not learner:
                return {}
            record = await session.scalar(
                sa.select(db_models.Session).where(
                    db_models.Session.session_id == session_id,
                    db_models.Session.learner_id == learner.id,
                )
            )
        return record.state or {} if record else {}

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
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, learner_id, create=True)
            session.add(db_models.Quiz(quiz_id=quiz.quiz_id, learner_id=learner.id, session_id=quiz.session_id, topic=topic, questions=quiz.questions))
            await session.commit()

    async def save_assessment_and_evolve(
        self,
        submission: models.AssessmentSubmission,
        result: models.AssessmentResult,
        decision: models.AdaptationDecision,
        evolved_model: Dict[str, Any],
    ) -> None:
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, submission.learner_id, create=True)
            session.add(db_models.Assessment(learner_id=learner.id, session_id=submission.session_id, submission=submission.model_dump(), result=result.model_dump()))
            session.add(db_models.Adaptation(learner_id=learner.id, session_id=submission.session_id, decision=decision.model_dump(), applied=True))
            learner.learner_model = evolved_model
            record = await session.scalar(sa.select(db_models.Session).where(db_models.Session.session_id == submission.session_id))
            if record:
                record.state = {**(record.state or {}), "status": "assessed", "latest_assessment": result.model_dump(), "latest_adaptation": decision.model_dump()}
            for concept, score in result.mastery_estimates.items():
                await self._upsert_progress(session, learner.id, concept, score)
            await session.commit()

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
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, learner_id)
            if not learner:
                return models.ProgressResponse(learner_id=learner_id)
            rows = (await session.scalars(sa.select(db_models.CurriculumProgress).where(db_models.CurriculumProgress.learner_id == learner.id))).all()
            adaptations = (await session.scalars(sa.select(db_models.Adaptation).where(db_models.Adaptation.learner_id == learner.id).order_by(db_models.Adaptation.created_at.desc()))).all()
            completed = await session.scalar(sa.select(sa.func.count(db_models.Session.id)).where(db_models.Session.learner_id == learner.id, db_models.Session.state["status"].as_string() == "assessed"))
        mastery = {row.concept or row.curriculum_item_id: float(row.mastery_score or 0.0) for row in rows}
        history = [
            {"type": "mastery", "concept": row.concept, "status": row.status, "mastery_score": row.mastery_score, "timestamp": _iso(row.updated_at)}
            for row in rows
        ] + [
            {"type": "adaptation", "action": (row.decision or {}).get("adaptations", {}).get("action", "Teaching strategy updated"), "detail": row.decision, "timestamp": _iso(row.created_at)}
            for row in adaptations
        ]
        return models.ProgressResponse(learner_id=learner_id, mastery=mastery, history=history, completed_lessons=int(completed or 0), learning_streak=min(int(completed or 0), 7))

    async def get_analytics(self, learner_id: str) -> models.AnalyticsResponse:
        async with AsyncSessionLocal() as session:
            learner = await self._learner(session, learner_id)
            if not learner:
                return models.AnalyticsResponse(learner_id=learner_id)
            assessments = (await session.scalars(sa.select(db_models.Assessment).where(db_models.Assessment.learner_id == learner.id).order_by(db_models.Assessment.created_at))).all()
            interactions = await session.scalar(sa.select(sa.func.count(db_models.Interaction.id)).where(db_models.Interaction.learner_id == learner.id))
        learner_model = learner.learner_model or _initial_model()
        scores = [float((row.result or {}).get("score", 0.0)) for row in assessments]
        performance = {"average_score": sum(scores) / len(scores) if scores else 0.0, "assessment_count": len(scores), "mastery_confidence": float(learner_model.get("confidence_score", 0.0))}
        engagement = {"interaction_count": int(interactions or 0), "lesson_count": len(scores), "engagement_score": float(learner_model.get("engagement_score", 0.0))}
        insights = _insights(learner_model, performance)
        return models.AnalyticsResponse(learner_id=learner_id, engagement_trends=engagement, performance_trends=performance, learner_model=learner_model, insights=insights)

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

    async def _learner(self, session, learner_id: str, create: bool = False):
        learner = await session.scalar(sa.select(db_models.Learner).where(db_models.Learner.learner_id == learner_id))
        if not learner and create:
            learner = db_models.Learner(learner_id=learner_id, learner_model=_initial_model())
            session.add(learner)
            await session.flush()
        return learner

    async def _initialize_curriculum(self, session, learner: db_models.Learner) -> None:
        for item in _curriculum():
            exists = await session.scalar(sa.select(db_models.CurriculumProgress).where(db_models.CurriculumProgress.learner_id == learner.id, db_models.CurriculumProgress.curriculum_item_id == item["id"]))
            if not exists:
                session.add(db_models.CurriculumProgress(learner_id=learner.id, curriculum_item_id=item["id"], topic=item["topic"], concept=item["concept"], status="recommended" if item["topic"].lower() in (learner.topic or "").lower() else "not_started", mastery_score=0.0, progress_metadata={}))

    async def _upsert_progress(self, session, learner_id: int, concept: str, score: float) -> None:
        item_id = concept.lower().replace(" ", "_")[:128]
        record = await session.scalar(sa.select(db_models.CurriculumProgress).where(db_models.CurriculumProgress.learner_id == learner_id, db_models.CurriculumProgress.curriculum_item_id == item_id))
        if not record:
            record = db_models.CurriculumProgress(learner_id=learner_id, curriculum_item_id=item_id, topic=concept, concept=concept, progress_metadata={})
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
    return models.AuthUser(id=learner.learner_id, full_name=learner.full_name or "Learner", email=learner.email or "", age=learner.age, profile_complete=learner.onboarding_status == "complete", learning_topic=learner.topic, learning_project=learner.learning_project)


def _initial_model() -> Dict[str, Any]:
    return {"knowledge_level": "novice", "preferred_modalities": [], "weak_topics": [], "strong_topics": [], "confidence_score": 0.0, "engagement_score": 0.0, "cognitive_load_estimate": 0.0, "misconception_registry": [], "adaptation_history": []}


def _age_group(age: int) -> str:
    return "child" if age < 13 else "teen" if age < 18 else "adult"


def _curriculum() -> list[Dict[str, Any]]:
    path = Path(__file__).resolve().parents[2] / "data" / "initial_curriculum.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def _iso(value) -> str:
    return value.isoformat() if value else datetime.now(timezone.utc).isoformat()


def _insights(model: Dict[str, Any], performance: Dict[str, Any]) -> list[str]:
    insights = []
    modalities = model.get("preferred_modalities") or []
    if modalities:
        insights.append(f"Your lessons currently prioritize {', '.join(modalities)} explanations.")
    if performance["assessment_count"]:
        insights.append(f"Your average checkpoint score is {round(performance['average_score'] * 100)}%.")
    weak = model.get("weak_topics") or []
    if weak:
        insights.append(f"Your next lesson will reinforce {', '.join(weak[:2])}.")
    return insights or ["Complete your first lesson assessment to unlock personalized learning insights."]
