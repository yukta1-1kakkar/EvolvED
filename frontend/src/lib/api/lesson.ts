import { apiRequest } from "./client";
import type { GenerateLessonRequest, LessonBlueprint, SaveLessonRequest, SaveLessonResponse } from "@/types/api";

export function generateLesson(request: GenerateLessonRequest) {
  return apiRequest<LessonBlueprint, GenerateLessonRequest>("/generate-lesson", {
    method: "POST",
    body: request,
    timeoutMs: 30000,
  });
}

export function saveLesson(request: SaveLessonRequest) {
  return apiRequest<SaveLessonResponse, SaveLessonRequest>("/save-lesson", {
    method: "POST",
    body: request,
  });
}
