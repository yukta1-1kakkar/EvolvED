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
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.db import Base


class Learner(Base):
    __tablename__ = "learners"
    id = Column(Integer, primary_key=True, index=True)
    learner_id = Column(String(128), unique=True, index=True, nullable=False)
    age_group = Column(String(64), nullable=True)
    education_level = Column(String(128), nullable=True)
    learning_goal = Column(String(256), nullable=True)
    pace_preference = Column(String(64), nullable=True)
    preferred_modality = Column(JSON, default=list)
    topic = Column(String(128), nullable=True)
    topic_familiarity = Column(String(64), nullable=True)
    accessibility = Column(JSON, default=dict)
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
