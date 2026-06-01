import { useMutation, useQuery } from "@tanstack/react-query";

import { askTutor, generateLesson, generateRoadmap, generateTeachingStrategy, saveLesson } from "@/lib/api";
import type { GenerateLessonRequest, SaveLessonRequest, TutorInteractionRequest } from "@/types/api";

export function useLesson(request: GenerateLessonRequest) {
  return useQuery({
    queryKey: ["lesson", request.learner_id, request.topic, request.selected_lesson, request.constraints],
    queryFn: () => generateLesson(request),
    enabled: Boolean(request.learner_id && request.topic && request.selected_lesson),
    retry: 1,
  });
}

export function useRoadmap(request: GenerateLessonRequest) {
  return useQuery({
    queryKey: ["roadmap", request.learner_id, request.topic, request.constraints],
    queryFn: () => generateRoadmap(request),
    enabled: Boolean(request.learner_id && request.topic),
    retry: 1,
  });
}

export function useTutorInteraction() {
  return useMutation({
    mutationFn: (request: TutorInteractionRequest) => askTutor(request),
  });
}

export function useTeachingStrategy(request: GenerateLessonRequest) {
  return useQuery({
    queryKey: ["teaching-strategy", request.learner_id, request.topic],
    queryFn: () => generateTeachingStrategy(request),
    enabled: Boolean(request.learner_id),
    retry: 1,
  });
}

export function useSaveLesson() {
  return useMutation({
    mutationFn: (request: SaveLessonRequest) => saveLesson(request),
  });
}
