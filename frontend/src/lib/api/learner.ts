import { apiRequest } from "./client";
import type { LearnerProfile, LearnerState } from "@/types/api";

export function createLearnerProfile(profile: LearnerProfile) {
  return apiRequest<LearnerState, LearnerProfile>("/learner-profile", {
    method: "POST",
    body: profile,
  });
}
