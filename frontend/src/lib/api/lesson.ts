import { apiRequest } from "./client";
import type { GenerateLessonRequest, LessonBlueprint, LessonRoadmapResponse, SaveLessonRequest, SaveLessonResponse, TeachingStrategy, TutorInteractionRequest, TutorInteractionResponse } from "@/types/api";

export function generateLesson(request: GenerateLessonRequest) {
  return apiRequest<LessonBlueprint, GenerateLessonRequest>("/generate-lesson", {
    method: "POST",
    body: request,
    timeoutMs: 60000,
  });
}

export function generateRoadmap(request: GenerateLessonRequest) {
  return apiRequest<LessonRoadmapResponse, GenerateLessonRequest>("/generate-roadmap", {
    method: "POST",
    body: request,
    timeoutMs: 60000,
  });
}

export function askTutor(request: TutorInteractionRequest) {
  return apiRequest<TutorInteractionResponse, TutorInteractionRequest>("/tutor-interaction", {
    method: "POST",
    body: request,
    timeoutMs: 60000,
  });
}

export function generateTeachingStrategy(request: GenerateLessonRequest) {
  return apiRequest<TeachingStrategy, GenerateLessonRequest>("/teaching-strategy", {
    method: "POST",
    body: request,
    timeoutMs: 60000,
  });
}

export function saveLesson(request: SaveLessonRequest) {
  return apiRequest<SaveLessonResponse, SaveLessonRequest>("/save-lesson", {
    method: "POST",
    body: request,
  });
}
