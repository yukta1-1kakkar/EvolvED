import { apiRequest } from "./client";
import type { ApiJson, PeerFeedbackRequest, PeerFeedbackResponse } from "@/types/api";

export function submitPeerFeedback(request: PeerFeedbackRequest) {
  return apiRequest<PeerFeedbackResponse, ApiJson>("/peer-feedback", {
    method: "POST",
    body: request as unknown as ApiJson,
  });
}
