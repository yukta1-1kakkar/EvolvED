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

const lessonAudioRequests = new Map<string, Promise<Blob>>();
const MAX_CACHED_AUDIO_REQUESTS = 12;

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
  const narration = text.trim();
  const cached = lessonAudioRequests.get(narration);
  if (cached) return cached;

  const request = apiBlobRequest<ApiRecord>("/tts", {
    method: "POST",
    body: { text: narration },
    timeoutMs: 120000,
  });

  lessonAudioRequests.set(narration, request);
  void request.catch(() => lessonAudioRequests.delete(narration));
  if (lessonAudioRequests.size > MAX_CACHED_AUDIO_REQUESTS) {
    const oldest = lessonAudioRequests.keys().next().value;
    if (oldest && oldest !== narration) lessonAudioRequests.delete(oldest);
  }
  return request;
}
