import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { getTeacherDashboard } from "@/lib/api/classroom";

export const Route = createFileRoute("/student/$studentId")({
  head: () => ({
    meta: [
      { title: "Student Assessment History - EvolvED" },
      { name: "description", content: "Assessment history for a student enrolled with this module leader." },
    ],
  }),
  component: StudentAssessmentHistory,
});

function StudentAssessmentHistory() {
  const { studentId } = Route.useParams();
  const { currentUser } = useAuth();
  const dashboard = useQuery({
    queryKey: ["teacher-dashboard", currentUser?.id],
    queryFn: () => getTeacherDashboard(currentUser?.id ?? ""),
    enabled: Boolean(currentUser?.id && currentUser.role === "module_leader"),
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });
  const student = dashboard.data?.students.find((item) => item.learner_id === studentId);
  const assessments = (student?.content_activity ?? [])
    .filter((item) => item.kind === "assessment" && item.completed)
    .sort((left, right) => String(right.completed_at ?? "").localeCompare(String(left.completed_at ?? "")));

  if (currentUser?.role !== "module_leader") {
    return (
      <AppShell title="Student assessment history" subtitle="Module leader access is required." accent="Protected">
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Sign in with a module leader account to view student assessment data.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={student?.name ?? "Student assessment history"}
      subtitle="All completed assessments, scores, and recorded completion times."
      accent={dashboard.isFetching ? "Syncing" : "Live"}
    >
      <Link to="/class-insights" search={{ classId: "" }} className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to class insights
      </Link>

      {dashboard.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {dashboard.isError && <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{dashboard.error.message}</p>}
      {!dashboard.isLoading && !student && (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          This student is not enrolled in one of your classrooms.
        </p>
      )}
      {student && (
        <section className="overflow-x-auto rounded-2xl border border-border bg-card p-5">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                {["Assessment", "Date", "Score", "Time"].map((heading) => <th key={heading} className="py-3 pr-4 font-medium">{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {assessments.map((assessment) => (
                <tr key={assessment.draft_id} className="border-b border-border/60">
                  <td className="py-3 pr-4 font-medium">{assessment.title}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatDate(assessment.completed_at)}</td>
                  <td className="py-3 pr-4">{assessment.score == null ? "—" : `${Math.round(assessment.score * 100)}%`}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatDuration(assessment.duration_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {assessments.length === 0 && (
            <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">
              No completed assessments yet.
            </div>
          )}
        </section>
      )}
    </AppShell>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatDuration(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes} min ${remainingSeconds} sec`;
}
