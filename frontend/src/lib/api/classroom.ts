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
  completed_lessons?: number;
  current_lesson: string;
  average_score: number;
  assessment_scores?: number[];
  content_activity?: Array<{
    draft_id: string;
    class_id: string;
    kind: "lesson" | "assessment";
    title: string;
    completed: boolean;
    score?: number | null;
    started_at?: string | null;
    completed_at?: string | null;
    duration_seconds?: number | null;
    page_timings?: Array<{
      page_key: string;
      page_title: string;
      seconds_spent: number;
      visit_count: number;
      last_seen_at?: string | null;
    }>;
  }>;
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
  class_id?: string | null;
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
  completed: boolean;
  completed_at?: string | null;
  created_at?: string | null;
}

export interface StudentAssessmentResultSummary {
  result_id: string;
  session_id?: string | null;
  title: string;
  score: number;
  feedback: string;
  kind: "lesson" | "assessment";
  draft_id?: string | null;
  created_at?: string | null;
}

export interface PublishedContentCompletion {
  draft_id: string;
  kind: "lesson" | "assessment";
  completed: boolean;
  score: number;
  evaluation: string;
  completed_at?: string | null;
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

export function completePublishedContent(learnerId: string, draftId: string) {
  return apiRequest<PublishedContentCompletion, { learner_id: string; draft_id: string }>("/student/content/complete", {
    method: "POST",
    body: { learner_id: learnerId, draft_id: draftId },
  });
}

export function startPublishedContent(learnerId: string, draftId: string) {
  return apiRequest<{ started: boolean }, { learner_id: string; draft_id: string }>("/student/content/start", {
    method: "POST",
    body: { learner_id: learnerId, draft_id: draftId },
  });
}

export function recordPublishedContentPageTiming(input: {
  learnerId: string;
  draftId: string;
  pageKey: string;
  pageTitle: string;
  secondsSpent: number;
}) {
  return apiRequest<{ recorded: boolean; seconds_spent: number; total_seconds?: number }, {
    learner_id: string;
    draft_id: string;
    page_key: string;
    page_title: string;
    seconds_spent: number;
  }>("/student/content/page-timing", {
    method: "POST",
    body: {
      learner_id: input.learnerId,
      draft_id: input.draftId,
      page_key: input.pageKey,
      page_title: input.pageTitle,
      seconds_spent: input.secondsSpent,
    },
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
