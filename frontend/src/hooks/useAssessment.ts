import { useMutation, useQuery } from "@tanstack/react-query";

import { adaptLearning, generateQuiz, submitAssessment } from "@/lib/api";
import type { AdaptationRequest, AssessmentSubmission, GenerateQuizRequest } from "@/types/api";

export function quizQueryKey(request: GenerateQuizRequest) {
  return ["quiz", request.learner_id, request.session_id] as const;
}

export function useSubmitAssessment() {
  return useMutation({
    mutationFn: (submission: AssessmentSubmission) => submitAssessment(submission),
  });
}

export function useGenerateQuiz(request: GenerateQuizRequest) {
  return useQuery({
    queryKey: quizQueryKey(request),
    queryFn: () => generateQuiz(request),
    enabled: Boolean(request.learner_id && request.session_id),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAdaptLearning() {
  return useMutation({
    mutationFn: (request: AdaptationRequest) => adaptLearning(request),
  });
}
