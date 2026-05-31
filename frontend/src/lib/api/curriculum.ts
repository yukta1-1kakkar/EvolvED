import { apiRequest } from "./client";
import type { CurriculumResponse } from "@/types/api";

export function getCurriculum() {
  return apiRequest<CurriculumResponse>("/curriculum");
}
