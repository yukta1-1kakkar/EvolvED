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
    learning_availability: Optional[str] = None
    learning_project: Optional[str] = None


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
    misconception_registry: List[str] = Field(default_factory=list)
    adaptation_history: List[Dict[str, Any]] = Field(default_factory=list)


class TeachingStrategy(BaseModel):
    strategy_type: str
    recommended_modalities: List[str] = Field(default_factory=list)
    difficulty_level: Optional[str] = None
    pacing_strategy: Optional[str] = None
    interaction_density: Optional[str] = None


class LessonBlueprint(BaseModel):
    lesson_id: str
    topic: str
    generation_source: str = "unknown"
    generation_model: Optional[str] = None
    project_context: Optional[str] = None
    selected_lesson: Optional[Dict[str, Any]] = None
    learning_objective: str
    lesson_summary: str
    learning_style: Optional[str] = None
    lesson_structure: List[Dict[str, Any]] = Field(default_factory=list)
    visualElements: List[Dict[str, Any]] = Field(default_factory=list)
    conceptMaps: List[Dict[str, Any]] = Field(default_factory=list)
    diagramDescriptions: List[Dict[str, Any]] = Field(default_factory=list)
    flowDiagrams: List[Dict[str, Any]] = Field(default_factory=list)
    graphData: List[Dict[str, Any]] = Field(default_factory=list)
    audioNarration: Optional[str] = None
    audioSections: List[Dict[str, Any]] = Field(default_factory=list)
    ttsContent: Optional[str] = None
    practiceExercises: List[Dict[str, Any]] = Field(default_factory=list)
    interactiveQuestions: List[Dict[str, Any]] = Field(default_factory=list)
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
    confidence: Dict[str, float] = Field(default_factory=dict)


class AssessmentResult(BaseModel):
    learner_id: str
    session_id: str
    quiz_scores: Dict[str, float] = Field(default_factory=dict)
    mastery_estimates: Dict[str, float] = Field(default_factory=dict)
    score: float = 0.0
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    misconceptions: List[str] = Field(default_factory=list)
    detailed_feedback: str = ""
    adaptation: Dict[str, Any] = Field(default_factory=dict)


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
    project_context: Optional[str] = None
    selected_lesson: Optional[Dict[str, Any]] = None
    constraints: Optional[Dict[str, Any]] = Field(default_factory=dict)


class LessonRoadmapItem(BaseModel):
    id: str
    title: str
    description: str
    difficulty: str
    estimated_duration: int
    objectives: List[str] = Field(default_factory=list)


class LessonRoadmapResponse(BaseModel):
    learner_id: str
    topic: str
    generation_source: str = "unknown"
    generation_model: Optional[str] = None
    lessons: List[LessonRoadmapItem] = Field(default_factory=list)


class RetrieveMemoryRequest(BaseModel):
    learner_id: str
    query: str


class RetrievedMemory(BaseModel):
    id: str
    concept: str = "Memory"
    source: str = "lesson"
    snippet: str = ""
    score: float = 0.0
    created_at: Optional[str] = None
    why: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RetrieveMemoryResponse(BaseModel):
    query: str
    results: List[RetrievedMemory] = Field(default_factory=list)
    concepts: List[str] = Field(default_factory=list)


class PeerFeedbackRequest(BaseModel):
    learner_id: str
    reviewer_name: str = "Peer reviewer"
    lesson_id: Optional[str] = None
    topic: str = ""
    rating: int = Field(ge=1, le=5)
    clarity: int = Field(ge=1, le=5)
    accessibility: int = Field(ge=1, le=5)
    modality_fit: int = Field(ge=1, le=5)
    comment: str = ""


class PeerFeedbackResponse(BaseModel):
    status: str = "ok"
    saved: Dict[str, Any] = Field(default_factory=dict)


class ProgressResponse(BaseModel):
    learner_id: str
    mastery: Dict[str, float] = Field(default_factory=dict)
    history: List[Dict[str, Any]] = Field(default_factory=list)
    completed_lessons: int = 0
    learning_streak: int = 0


class AnalyticsResponse(BaseModel):
    learner_id: str
    engagement_trends: Dict[str, Any] = Field(default_factory=dict)
    performance_trends: Dict[str, Any] = Field(default_factory=dict)
    learner_model: Dict[str, Any] = Field(default_factory=dict)
    insights: List[str] = Field(default_factory=list)


class SignupRequest(BaseModel):
    full_name: str
    email: str
    password: str
    age: Optional[int] = None
    role: str = "student"
    module_leader_code: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthUser(BaseModel):
    id: str
    full_name: str
    email: str
    role: str = "student"
    age: Optional[int] = None
    profile_complete: bool = False
    learning_topic: Optional[str] = None
    learning_project: Optional[str] = None
    accessibility: Dict[str, bool] = Field(default_factory=dict)
    created_at: Optional[str] = None


class ClassCreateRequest(BaseModel):
    leader_id: str
    name: str
    description: str = ""
    max_students: Optional[int] = None


class ClassSummary(BaseModel):
    class_id: str
    name: str
    description: str = ""
    join_code: str
    invite_link: str
    max_students: Optional[int] = None
    active: bool = True
    created_at: Optional[str] = None
    student_count: int = 0


class JoinClassRequest(BaseModel):
    learner_id: str
    join_code: str


class TeacherStudentSummary(BaseModel):
    learner_id: str
    name: str
    class_ids: List[str] = Field(default_factory=list)
    progress: float = 0.0
    current_lesson: str = "Not started"
    average_score: float = 0.0
    rank: int = 0
    accessibility_settings: Dict[str, Any] = Field(default_factory=dict)
    last_active: Optional[str] = None
    status: str = "in_progress"


class ContentDraftRequest(BaseModel):
    leader_id: str
    class_id: Optional[str] = None
    kind: str = Field(pattern="^(lesson|assessment)$")
    title: str
    source_material: Dict[str, Any] = Field(default_factory=dict)


class ContentDraftResponse(BaseModel):
    draft_id: str
    kind: str
    title: str
    status: str
    source_material: Dict[str, Any] = Field(default_factory=dict)
    generated_content: Dict[str, Any] = Field(default_factory=dict)
    approval: Dict[str, Any] = Field(default_factory=dict)


class ApprovalRequest(BaseModel):
    leader_id: str
    decision: str = Field(pattern="^(accept|reject|request_changes)$")
    instructions: str = ""


class TeacherDashboardResponse(BaseModel):
    leader_id: str
    classes: List[ClassSummary] = Field(default_factory=list)
    students: List[TeacherStudentSummary] = Field(default_factory=list)
    drafts: List[ContentDraftResponse] = Field(default_factory=list)
    totals: Dict[str, Any] = Field(default_factory=dict)


class StudentAnalyticsResponse(BaseModel):
    student: TeacherStudentSummary
    learning_style: List[str] = Field(default_factory=list)
    behaviour_analysis: Dict[str, Any] = Field(default_factory=dict)
    assessment_history: List[Dict[str, Any]] = Field(default_factory=list)
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    concept_mastery: Dict[str, float] = Field(default_factory=dict)
    tutor_usage: int = 0


class StudentClassAlert(BaseModel):
    alert_id: str
    class_id: str
    class_name: str
    leader_name: str
    kind: str
    title: str
    draft_id: str
    message: str
    published_content: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class StudentAssessmentResultSummary(BaseModel):
    result_id: str
    session_id: Optional[str] = None
    title: str
    score: float = 0.0
    feedback: str = ""
    created_at: Optional[str] = None


class StudentClassroomResponse(BaseModel):
    learner_id: str
    classes: List[ClassSummary] = Field(default_factory=list)
    alerts: List[StudentClassAlert] = Field(default_factory=list)
    results: List[StudentAssessmentResultSummary] = Field(default_factory=list)


class TutorInteractionRequest(BaseModel):
    learner_id: str
    session_id: str
    question: str
    action: str = "question"


class TutorInteractionResponse(BaseModel):
    interaction_id: str
    answer: str


class GenerateQuizRequest(BaseModel):
    learner_id: str
    session_id: str


class QuizResponse(BaseModel):
    quiz_id: str
    session_id: str
    questions: List[Dict[str, Any]] = Field(default_factory=list)


class SaveLessonRequest(BaseModel):
    learner_id: str
    lesson_id: str
    updated_structure: List[Dict[str, Any]] = Field(default_factory=list)
