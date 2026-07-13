import { apiRequest } from "./client";
import type { ProgressResponse } from "@/types/api";

export function getProgress(learnerId: string) {
  return apiRequest<ProgressResponse>("/progress", {
    query: { learner_id: learnerId },
    timeoutMs: 45000,
  });
}

export function recordAdaptivePageTiming(input: {
  learnerId: string;
  sessionId: string;
  pageKey: string;
  pageTitle: string;
  pageKind: "lesson" | "assessment";
  secondsSpent: number;
}) {
  return apiRequest<{ recorded: boolean; seconds_spent: number; total_seconds?: number }, {
    learner_id: string;
    session_id: string;
    page_key: string;
    page_title: string;
    page_kind: "lesson" | "assessment";
    seconds_spent: number;
  }>("/student/adaptive/page-timing", {
    method: "POST",
    body: {
      learner_id: input.learnerId,
      session_id: input.sessionId,
      page_key: input.pageKey,
      page_title: input.pageTitle,
      page_kind: input.pageKind,
      seconds_spent: input.secondsSpent,
    },
  });
}
