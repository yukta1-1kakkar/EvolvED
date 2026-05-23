from app.core import models
from typing import Optional, Dict, Any

# use SQLAlchemy async session and models for persistence
from app.core.db import AsyncSessionLocal
from app.db import models as db_models
import sqlalchemy as sa
import json


class AsyncRepository:
    """Lightweight async repository pattern for learners and sessions.

    Uses SQLAlchemy async sessions to persist sessions state.
    """

    def __init__(self):
        pass

    async def upsert_learner(self, profile: models.LearnerProfile) -> models.LearnerState:
        # basic upsert: create learner row if missing
        async with AsyncSessionLocal() as session:
            stmt = sa.select(db_models.Learner).where(db_models.Learner.learner_id == profile.learner_id)
            res = await session.execute(stmt)
            learner = res.scalars().first()
            if not learner:
                learner = db_models.Learner(
                    learner_id=profile.learner_id,
                    age_group=profile.age_group,
                    education_level=profile.education_level,
                    learning_goal=profile.learning_goal,
                    pace_preference=profile.pace_preference,
                    preferred_modality=profile.preferred_modality,
                    topic=profile.topic,
                    topic_familiarity=profile.topic_familiarity,
                    accessibility=profile.accessibility,
                )
                session.add(learner)
                await session.commit()
                await session.refresh(learner)
        return models.LearnerState(
            learner_id=profile.learner_id,
            knowledge_level=profile.topic_familiarity or "unknown",
            pace_preference=profile.pace_preference,
            preferred_modalities=profile.preferred_modality,
        )

    async def get_progress(self, learner_id: str) -> models.ProgressResponse:
        # placeholder that could aggregate session history
        return models.ProgressResponse(learner_id=learner_id)

    async def get_analytics(self, learner_id: str) -> models.AnalyticsResponse:
        return models.AnalyticsResponse(learner_id=learner_id)

    async def save_lesson_blueprint(self, learner_id: str, lesson_id: str, lesson_structure: list) -> Dict[str, Any]:
        """Persist lesson blueprint into a Session.state JSON column (upsert by session_id).

        Returns persisted session record info.
        """
        async with AsyncSessionLocal() as session:
            # find learner
            stmt = sa.select(db_models.Learner).where(db_models.Learner.learner_id == learner_id)
            res = await session.execute(stmt)
            learner = res.scalars().first()
            if not learner:
                # create lightweight learner record
                learner = db_models.Learner(learner_id=learner_id)
                session.add(learner)
                await session.commit()
                await session.refresh(learner)

            # upsert session by session_id == lesson_id
            stmt2 = sa.select(db_models.Session).where(db_models.Session.session_id == lesson_id)
            res2 = await session.execute(stmt2)
            sess = res2.scalars().first()
            state_obj = {"lesson_id": lesson_id, "lesson_structure": lesson_structure}
            if not sess:
                sess = db_models.Session(session_id=lesson_id, learner_id=learner.id, state=state_obj)
                session.add(sess)
            else:
                sess.state = state_obj
            await session.commit()
            await session.refresh(sess)
            return {"session_id": sess.session_id, "learner_id": learner.learner_id, "updated_at": sess.updated_at.isoformat()}
