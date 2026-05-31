import { apiRequest } from "./client";
import type { AnalyticsResponse } from "@/types/api";

export function getAnalytics(learnerId: string) {
  return apiRequest<AnalyticsResponse>("/analytics", {
    query: { learner_id: learnerId },
  });
}
