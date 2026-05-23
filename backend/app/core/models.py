from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime


class LearnerProfile(BaseModel):
    learner_id: str
    age_group: Optional[str] = None
    education_level: Optional[str] = None
    learning_goal: Optional[str] = None
    pace_preference: Optional[str] = None
    preferred_modality: List[str] = Field(default_factory=list)
    topic: Optional[str] = None
    topic_familiarity: Optional[str] = None
    accessibility: Dict[str, bool] = Field(default_factory=dict)


class LearnerState(BaseModel):
    learner_id: str
    knowledge_level: Optional[str] = None
    pace_preference: Optional[str] = None
    preferred_modalities: List[str] = Field(default_factory=list)
    weak_topics: List[str] = Field(default_factory=list)
    strong_topics: List[str] = Field(default_factory=list)
    confidence_score: float = 0.0
    engagement_score: float = 0.0
    cognitive_load_estimate: float = 0.0


class TeachingStrategy(BaseModel):
    strategy_type: str
    recommended_modalities: List[str] = Field(default_factory=list)
    difficulty_level: Optional[str] = None
    pacing_strategy: Optional[str] = None
    interaction_density: Optional[str] = None


class LessonBlueprint(BaseModel):
    lesson_id: str
    lesson_structure: List[Dict[str, Any]] = Field(default_factory=list)
    modality_sequence: List[str] = Field(default_factory=list)
    interaction_points: List[Dict[str, Any]] = Field(default_factory=list)
    assessment_points: List[Dict[str, Any]] = Field(default_factory=list)
    estimated_lesson_duration: int = 0


class ContentSpec(BaseModel):
    target_concept: str
    content_difficulty_target: Optional[str] = None


class GeneratedContent(BaseModel):
    lesson_assets: List[Dict[str, Any]] = Field(default_factory=list)


class AssessmentSubmission(BaseModel):
    learner_id: str
    session_id: str
    answers: Dict[str, Any]


class AssessmentResult(BaseModel):
    learner_id: str
    session_id: str
    quiz_scores: Dict[str, float] = Field(default_factory=dict)
    mastery_estimates: Dict[str, float] = Field(default_factory=dict)


class AdaptationRequest(BaseModel):
    learner_id: str
    session_id: Optional[str] = None
    assessment_state: Dict[str, Any]


class AdaptationDecision(BaseModel):
    learner_id: str
    session_id: Optional[str] = None
    adaptations: Dict[str, Any]


class GenerateLessonRequest(BaseModel):
    learner_id: str
    topic: str
    constraints: Optional[Dict[str, Any]] = Field(default_factory=dict)


class RetrieveMemoryRequest(BaseModel):
    query: str


class ProgressResponse(BaseModel):
    learner_id: str
    mastery: Dict[str, float] = Field(default_factory=dict)
    history: List[Dict[str, Any]] = Field(default_factory=list)


class AnalyticsResponse(BaseModel):
    learner_id: str
    engagement_trends: Dict[str, Any] = Field(default_factory=dict)
    performance_trends: Dict[str, Any] = Field(default_factory=dict)


class SaveLessonRequest(BaseModel):
    learner_id: str
    lesson_id: str
    updated_structure: List[Dict[str, Any]] = Field(default_factory=list)
