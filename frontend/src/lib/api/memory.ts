import { apiRequest } from "./client";
import type { RetrieveMemoryRequest, RetrieveMemoryResponse } from "@/types/api";

export function retrieveMemory(request: RetrieveMemoryRequest) {
  return apiRequest<RetrieveMemoryResponse, RetrieveMemoryRequest>("/retrieve-memory", {
    method: "POST",
    body: request,
  });
}
