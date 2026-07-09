import { apiFormRequest, apiRequest } from "@/lib/api/client";
import type { ApiRecord } from "@/types/api";

export interface ClassSummary {
  class_id: string;
  name: string;
  description: string;
  join_code: string;
  invite_link: string;
  max_students?: number | null;
  active: boolean;
  created_at?: string | null;
  student_count: number;
}

export interface TeacherStudentSummary {
  learner_id: string;
  name: string;
  class_ids?: string[];
  progress: number;
  current_lesson: string;
  average_score: number;
  rank: number;
  accessibility_settings: ApiRecord;
  last_active?: string | null;
  status: "completed" | "in_progress" | "needs_help";
}

export interface TeacherDashboardResponse {
  leader_id: string;
  classes: ClassSummary[];
  students: TeacherStudentSummary[];
  drafts: ContentDraft[];
  totals: {
    total_students?: number;
    average_progress?: number;
    average_assessment_score?: number;
    lessons_published?: number;
    pending_lesson_approvals?: number;
    pending_assessment_approvals?: number;
  };
}

export interface ContentDraft {
  draft_id: string;
  kind: "lesson" | "assessment";
  title: string;
  status: "draft" | "accepted" | "rejected" | "changes_requested";
  source_material: ApiRecord;
  generated_content: ApiRecord;
  approval: ApiRecord;
}

export interface StudentClassAlert {
  alert_id: string;
  class_id: string;
  class_name: string;
  leader_name: string;
  kind: "lesson" | "assessment";
  title: string;
  draft_id: string;
  message: string;
  published_content: ApiRecord;
  created_at?: string | null;
}

export interface StudentAssessmentResultSummary {
  result_id: string;
  session_id?: string | null;
  title: string;
  score: number;
  feedback: string;
  created_at?: string | null;
}

export interface StudentClassroomResponse {
  learner_id: string;
  classes: ClassSummary[];
  alerts: StudentClassAlert[];
  results: StudentAssessmentResultSummary[];
}

export function getStudentClassroom(learnerId: string) {
  return apiRequest<StudentClassroomResponse>("/student/classroom", {
    query: { learner_id: learnerId },
  });
}

export function getTeacherDashboard(leaderId: string) {
  return apiRequest<TeacherDashboardResponse>("/teacher/dashboard", {
    query: { leader_id: leaderId },
  });
}

export function createClass(leaderId: string, name: string, description = "") {
  return apiRequest<ClassSummary, { leader_id: string; name: string; description: string }>("/classes", {
    method: "POST",
    body: { leader_id: leaderId, name, description },
  });
}

export function joinClass(learnerId: string, joinCode: string) {
  return apiRequest<ClassSummary, { learner_id: string; join_code: string }>("/classes/join", {
    method: "POST",
    body: { learner_id: learnerId, join_code: joinCode },
  });
}

export function uploadContentDraft(input: {
  leaderId: string;
  kind: "lesson" | "assessment";
  title: string;
  classId?: string;
  notes?: string;
  file?: File | null;
}) {
  const form = new FormData();
  form.set("leader_id", input.leaderId);
  form.set("kind", input.kind);
  form.set("title", input.title);
  if (input.classId) form.set("class_id", input.classId);
  if (input.notes) form.set("notes", input.notes);
  if (input.file) form.set("file", input.file);
  return apiFormRequest<ContentDraft>("/content-drafts/upload", form, { timeoutMs: 120000 });
}

export function decideContentDraft(draftId: string, leaderId: string, decision: "accept" | "reject" | "request_changes", instructions = "") {
  return apiRequest<ContentDraft, { leader_id: string; decision: string; instructions: string }>(`/content-drafts/${draftId}/approval`, {
    method: "POST",
    body: { leader_id: leaderId, decision, instructions },
    timeoutMs: 60000,
  });
}
