import { apiRequest } from "./client";
import type { ProgressResponse } from "@/types/api";

export function getProgress(learnerId: string) {
  return apiRequest<ProgressResponse>("/progress", {
    query: { learner_id: learnerId },
    timeoutMs: 45000,
  });
}
