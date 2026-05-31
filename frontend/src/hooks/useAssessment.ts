import { useMutation } from "@tanstack/react-query";

import { adaptLearning, submitAssessment } from "@/lib/api";
import type { AdaptationRequest, AssessmentSubmission } from "@/types/api";

export function useSubmitAssessment() {
  return useMutation({
    mutationFn: (submission: AssessmentSubmission) => submitAssessment(submission),
  });
}

export function useAdaptLearning() {
  return useMutation({
    mutationFn: (request: AdaptationRequest) => adaptLearning(request),
  });
}
