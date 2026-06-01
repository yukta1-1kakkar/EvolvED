from __future__ import annotations
from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    DateTime,
    JSON,
    ForeignKey,
    Boolean,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.db import Base


class Learner(Base):
    __tablename__ = "learners"
    id = Column(Integer, primary_key=True, index=True)
    learner_id = Column(String(128), unique=True, index=True, nullable=False)
    full_name = Column(String(160), nullable=True)
    email = Column(String(320), unique=True, index=True, nullable=True)
    password_hash = Column(String(512), nullable=True)
    age = Column(Integer, nullable=True)
    onboarding_status = Column(String(64), nullable=False, default="profile_pending")
    age_group = Column(String(64), nullable=True)
    education_level = Column(String(128), nullable=True)
    learning_goal = Column(String(256), nullable=True)
    pace_preference = Column(String(64), nullable=True)
    preferred_modality = Column(JSON, default=list)
    topic = Column(String(128), nullable=True)
    topic_familiarity = Column(String(64), nullable=True)
    accessibility = Column(JSON, default=dict)
    learning_availability = Column(String(64), nullable=True)
    learning_project = Column(String(512), nullable=True)
    learner_model = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    sessions = relationship("Session", back_populates="learner")


class Session(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(128), unique=True, index=True, nullable=False)
    learner_id = Column(Integer, ForeignKey("learners.id"), nullable=False)
    state = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    learner = relationship("Learner", back_populates="sessions")


class Assessment(Base):
    __tablename__ = "assessments"
    id = Column(Integer, primary_key=True, index=True)
    learner_id = Column(Integer, ForeignKey("learners.id"), nullable=False)
    session_id = Column(String(128), nullable=True)
    submission = Column(JSON, default=dict)
    result = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Adaptation(Base):
    __tablename__ = "adaptations"
    id = Column(Integer, primary_key=True, index=True)
    learner_id = Column(Integer, ForeignKey("learners.id"), nullable=False)
    session_id = Column(String(128), nullable=True)
    decision = Column(JSON, default=dict)
    applied = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class StrategyHistory(Base):
    __tablename__ = "strategy_history"
    id = Column(Integer, primary_key=True, index=True)
    learner_id = Column(Integer, ForeignKey("learners.id"), nullable=True)
    strategy = Column(JSON, default=dict)
    effectiveness = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CurriculumProgress(Base):
    __tablename__ = "curriculum_progress"
    __table_args__ = (
        UniqueConstraint("learner_id", "curriculum_item_id", name="uq_curriculum_progress_learner_item"),
    )

    id = Column(Integer, primary_key=True, index=True)
    learner_id = Column(Integer, ForeignKey("learners.id"), nullable=False)
    curriculum_item_id = Column(String(128), nullable=False)
    topic = Column(String(128), nullable=True)
    concept = Column(String(128), nullable=True)
    status = Column(String(64), nullable=False, default="not_started")
    mastery_score = Column(Float, nullable=False, default=0.0)
    progress_metadata = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Interaction(Base):
    __tablename__ = "interactions"
    id = Column(Integer, primary_key=True, index=True)
    interaction_id = Column(String(128), unique=True, index=True, nullable=False)
    learner_id = Column(Integer, ForeignKey("learners.id"), nullable=False)
    session_id = Column(String(128), nullable=True)
    kind = Column(String(64), nullable=False, default="tutor_question")
    request = Column(JSON, default=dict)
    response = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Quiz(Base):
    __tablename__ = "quizzes"
    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(String(128), unique=True, index=True, nullable=False)
    learner_id = Column(Integer, ForeignKey("learners.id"), nullable=False)
    session_id = Column(String(128), nullable=False)
    topic = Column(String(128), nullable=True)
    questions = Column(JSON, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
