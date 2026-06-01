import { apiRequest } from "./client";
import type {
  AdaptationDecision,
  AdaptationRequest,
  AssessmentResult,
  AssessmentSubmission,
  GenerateQuizRequest,
  QuizResponse,
} from "@/types/api";

export function submitAssessment(submission: AssessmentSubmission) {
  return apiRequest<AssessmentResult, AssessmentSubmission>("/submit-assessment", {
    method: "POST",
    body: submission,
  });
}

export function generateQuiz(request: GenerateQuizRequest) {
  return apiRequest<QuizResponse, GenerateQuizRequest>("/generate-quiz", {
    method: "POST",
    body: request,
    timeoutMs: 60000,
  });
}

export function adaptLearning(request: AdaptationRequest) {
  return apiRequest<AdaptationDecision, AdaptationRequest>("/adapt-learning", {
    method: "POST",
    body: request,
  });
}
