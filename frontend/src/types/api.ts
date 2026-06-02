export type ApiPrimitive = string | number | boolean | null;
export type ApiJson = ApiPrimitive | ApiJson[] | { [key: string]: ApiJson };
export type ApiRecord = { [key: string]: ApiJson };

export interface LearnerProfile {
  learner_id: string;
  age_group?: string | null;
  education_level?: string | null;
  learning_goal?: string | null;
  pace_preference?: string | null;
  preferred_modality: string[];
  topic?: string | null;
  topic_familiarity?: string | null;
  accessibility: Record<string, boolean>;
  learning_availability?: string | null;
  learning_project?: string | null;
}

export interface LearnerState {
  learner_id: string;
  knowledge_level?: string | null;
  pace_preference?: string | null;
  preferred_modalities: string[];
  weak_topics: string[];
  strong_topics: string[];
  confidence_score: number;
  engagement_score: number;
  cognitive_load_estimate: number;
  misconception_registry: string[];
  adaptation_history: ApiRecord[];
}

export interface TeachingStrategy {
  strategy_type: string;
  recommended_modalities: string[];
  difficulty_level?: string | null;
  pacing_strategy?: string | null;
  interaction_density?: string | null;
}

export interface LessonBlueprint {
  lesson_id: string;
  topic: string;
  project_context?: string | null;
  selected_lesson?: ApiRecord | null;
  learning_objective: string;
  lesson_summary: string;
  learning_style?: string | null;
  lesson_structure: ApiRecord[];
  visualElements?: ApiRecord[];
  conceptMaps?: ApiRecord[];
  diagramDescriptions?: ApiRecord[];
  flowDiagrams?: ApiRecord[];
  graphData?: ApiRecord[];
  audioNarration?: string | null;
  audioSections?: ApiRecord[];
  ttsContent?: string | null;
  practiceExercises?: ApiRecord[];
  interactiveQuestions?: ApiRecord[];
  modality_sequence: string[];
  interaction_points: ApiRecord[];
  assessment_points: ApiRecord[];
  estimated_lesson_duration: number;
}

export interface ContentSpec {
  target_concept: string;
  content_difficulty_target?: string | null;
}

export interface GeneratedContent {
  lesson_assets: ApiRecord[];
}

export interface GenerateLessonRequest {
  learner_id: string;
  topic: string;
  project_context?: string;
  selected_lesson?: ApiRecord;
  constraints?: ApiRecord;
}

export interface LessonRoadmapItem {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  estimated_duration: number;
  objectives: string[];
}

export interface LessonRoadmapResponse {
  learner_id: string;
  topic: string;
  lessons: LessonRoadmapItem[];
}

export interface AssessmentSubmission {
  learner_id: string;
  session_id: string;
  answers: ApiRecord;
  confidence?: Record<string, number>;
}

export interface AssessmentResult {
  learner_id: string;
  session_id: string;
  quiz_scores: Record<string, number>;
  mastery_estimates: Record<string, number>;
  score: number;
  strengths: string[];
  weaknesses: string[];
  misconceptions: string[];
  detailed_feedback: string;
  adaptation: ApiRecord;
}

export interface AdaptationRequest {
  learner_id: string;
  session_id?: string | null;
  assessment_state: ApiRecord;
}

export interface AdaptationDecision {
  learner_id: string;
  session_id?: string | null;
  adaptations: ApiRecord;
}

export interface RetrieveMemoryRequest {
  learner_id: string;
  query: string;
}

export interface RetrieveMemoryResponse {
  results: ApiRecord[];
}

export interface SaveLessonRequest {
  learner_id: string;
  lesson_id: string;
  updated_structure: ApiRecord[];
}

export interface SaveLessonResponse {
  status: "ok";
  saved: ApiJson;
}

export interface CurriculumItem {
  id: string;
  topic: string;
  concept: string;
  content: string;
}

export interface CurriculumResponse {
  items: CurriculumItem[];
}

export interface ProgressResponse {
  learner_id: string;
  mastery: Record<string, number>;
  history: ApiRecord[];
  completed_lessons: number;
  learning_streak: number;
}

export interface AnalyticsResponse {
  learner_id: string;
  engagement_trends: ApiRecord;
  performance_trends: ApiRecord;
  learner_model: ApiRecord;
  insights: string[];
}

export interface QuizResponse {
  quiz_id: string;
  session_id: string;
  questions: ApiRecord[];
}

export interface GenerateQuizRequest {
  learner_id: string;
  session_id: string;
}

export interface TutorInteractionRequest {
  learner_id: string;
  session_id: string;
  question: string;
  action?: string;
}

export interface TutorInteractionResponse {
  interaction_id: string;
  answer: string;
}
