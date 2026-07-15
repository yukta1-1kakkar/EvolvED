import { apiBlobRequest, apiRequest } from "./client";
import type {
  ApiJson,
  ApiRecord,
  GenerateLessonRequest,
  LessonBlueprint,
  LessonRoadmapResponse,
  SaveLessonRequest,
  SaveLessonResponse,
  TeachingStrategy,
  TutorInteractionRequest,
  TutorInteractionResponse,
} from "@/types/api";

export function generateLesson(request: GenerateLessonRequest) {
  return apiRequest<LessonBlueprint, ApiJson>("/generate-lesson", {
    method: "POST",
    body: request as unknown as ApiJson,
    timeoutMs: 180000,
  });
}

export function generateRoadmap(request: GenerateLessonRequest) {
  return apiRequest<LessonRoadmapResponse, ApiJson>("/generate-roadmap", {
    method: "POST",
    body: request as unknown as ApiJson,
    timeoutMs: 180000,
  });
}

export function askTutor(request: TutorInteractionRequest) {
  return apiRequest<TutorInteractionResponse, ApiJson>("/tutor-interaction", {
    method: "POST",
    body: request as unknown as ApiJson,
    timeoutMs: 60000,
  });
}

export function generateTeachingStrategy(request: GenerateLessonRequest) {
  return apiRequest<TeachingStrategy, ApiJson>("/teaching-strategy", {
    method: "POST",
    body: request as unknown as ApiJson,
    timeoutMs: 60000,
  });
}

export function saveLesson(request: SaveLessonRequest) {
  return apiRequest<SaveLessonResponse, ApiJson>("/save-lesson", {
    method: "POST",
    body: request as unknown as ApiJson,
  });
}

export function synthesizeLessonAudio(text: string) {
  return apiBlobRequest<ApiRecord>("/tts", {
    method: "POST",
    body: { text },
    timeoutMs: 120000,
  });
}
