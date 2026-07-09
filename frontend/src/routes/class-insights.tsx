import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownUp, LineChart, Play, Target, Users } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { getTeacherDashboard, type TeacherStudentSummary } from "@/lib/api/classroom";

export const Route = createFileRoute("/class-insights")({
  validateSearch: (search: Record<string, unknown>) => ({
    classId: typeof search.classId === "string" ? search.classId : "",
  }),
  head: () => ({
    meta: [
      { title: "Class Insights - EvolvED" },
      { name: "description", content: "Class progress, lesson completion, engagement, and assessment performance for module leaders." },
    ],
  }),
  component: ClassInsightsPage,
});

function ClassInsightsPage() {
  const { currentUser } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const dashboard = useQuery({
    queryKey: ["teacher-dashboard", currentUser?.id],
    queryFn: () => getTeacherDashboard(currentUser?.id ?? ""),
    enabled: Boolean(currentUser?.id && currentUser.role === "module_leader"),
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });

  if (currentUser?.role !== "module_leader") {
    return (
      <AppShell title="Class insights" subtitle="Module leader access is required." accent="Protected">
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Sign in with a module leader account to view class insights.
        </div>
      </AppShell>
    );
  }

  const classes = dashboard.data?.classes ?? [];
  const selectedClass = classes.find((item) => item.class_id === search.classId);
  const selectedClassId = selectedClass?.class_id ?? "";
  const students = (dashboard.data?.students ?? [])
    .filter((student) => !selectedClassId || (student.class_ids ?? []).includes(selectedClassId))
    .sort((left, right) => right.average_score - left.average_score)
    .map((student, index) => ({ ...student, rank: index + 1 }));
  const completed = students.filter((student) => student.status === "completed").length;
  const started = students.filter(hasStartedLesson).length;
  const averageProgress = average(students.map((student) => student.progress));
  const averageAssessment = average(students.map((student) => student.average_score));

  return (
    <AppShell title="Class insights" subtitle="Class progress, completion, engagement, and assessment performance." accent={dashboard.isFetching ? "Syncing" : "Live"}>
      {dashboard.isError && (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {dashboard.error.message}
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-border bg-card p-5">
        <label className="block text-[10px] uppercase tracking-[0.24em] text-muted-foreground" htmlFor="class-insights-class">
          Classroom
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            id="class-insights-class"
            value={selectedClassId}
            onChange={(event) => {
              void navigate({
                search: { classId: event.target.value },
                replace: true,
              });
            }}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-sm"
          >
            <option value="">All classrooms</option>
            {classes.map((item) => (
              <option key={item.class_id} value={item.class_id}>
                {item.name}
              </option>
            ))}
          </select>
          <div className="text-sm text-muted-foreground">
            {selectedClass ? `${selectedClass.student_count} enrolled students in ${selectedClass.name}` : `${students.length} students across all classrooms`}
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {dashboard.isLoading ? (
          Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <InsightCard icon={Users} label="Learners" value={students.length} />
            <InsightCard icon={LineChart} label="Overall progress" value={pct(averageProgress)} />
            <InsightCard icon={Target} label="Lesson completion" value={pct(students.length ? completed / students.length : 0)} />
            <InsightCard icon={Play} label="Learner engagement" value={started} />
            <InsightCard icon={Target} label="Assessment performance" value={pct(averageAssessment)} />
          </>
        )}
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Learning trends</div>
          <h2 className="mt-1 font-display text-xl">{selectedClass?.name ?? "Class insights"}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                {["Rank", "Name", "Current lesson", "Average score", "Last active"].map((heading) => (
                  <th key={heading} className="py-3 pr-4 font-medium">
                    <span className="inline-flex items-center gap-1">
                      {heading}
                      <ArrowDownUp className="size-3" />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.learner_id} className="border-b border-border/60">
                  <td className="py-3 pr-4 font-medium">#{student.rank}</td>
                  <td className="py-3 pr-4 font-medium">{student.name}</td>
                  <td className="max-w-64 truncate py-3 pr-4 text-muted-foreground">{student.current_lesson}</td>
                  <td className="py-3 pr-4">{pct(student.average_score)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatDate(student.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!dashboard.isLoading && students.length === 0 && (
          <div className="grid min-h-32 place-items-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
            {selectedClass ? "No learners are enrolled in this classroom yet." : "No class insight data is available yet."}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function InsightCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4 text-plum" />
        {label}
      </div>
      <div className="font-display text-2xl">{value}</div>
    </div>
  );
}

function hasStartedLesson(student: TeacherStudentSummary) {
  return student.progress > 0 || student.current_lesson !== "Not started";
}

function pct(value: number | null | undefined) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not active yet";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}
