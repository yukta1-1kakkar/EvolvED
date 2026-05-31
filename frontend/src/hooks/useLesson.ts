import { useMutation, useQuery } from "@tanstack/react-query";

import { generateLesson, saveLesson } from "@/lib/api";
import type { GenerateLessonRequest, SaveLessonRequest } from "@/types/api";

export function useLesson(request: GenerateLessonRequest) {
  return useQuery({
    queryKey: ["lesson", request.learner_id, request.topic, request.constraints],
    queryFn: () => generateLesson(request),
    enabled: Boolean(request.learner_id && request.topic),
    retry: 1,
  });
}

export function useSaveLesson() {
  return useMutation({
    mutationFn: (request: SaveLessonRequest) => saveLesson(request),
  });
}
