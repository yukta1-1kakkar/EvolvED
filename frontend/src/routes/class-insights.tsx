import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowDownUp, ExternalLink, LineChart, Search, Target, Users } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { getTeacherDashboard } from "@/lib/api/classroom";

export const Route = createFileRoute("/class-insights")({
  validateSearch: (search: Record<string, unknown>) => ({
    classId: typeof search.classId === "string" ? search.classId : "",
  }),
  head: () => ({
    meta: [
      { title: "Class Insights - EvolvED" },
      { name: "description", content: "Class progress, lesson completion, and assessment performance for module leaders." },
    ],
  }),
  component: ClassInsightsPage,
});

function ClassInsightsPage() {
  const { currentUser } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [lessonFilter, setLessonFilter] = useState("all");
  const [assessmentFilter, setAssessmentFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
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
  const visibleStudents = students.filter((student) => student.name.toLowerCase().includes(studentSearch.toLowerCase()));
  const completed = students.filter((student) => (student.completed_lessons ?? 0) > 0).length;
  const averageProgress = average(students.map((student) => student.progress));
  const averageAssessment = average(students.flatMap((student) => student.assessment_scores ?? []));
  const published = (dashboard.data?.drafts ?? []).filter((draft) => draft.status === "accepted" && (!selectedClassId || draft.class_id === selectedClassId));
  const lessons = published.filter((draft) => draft.kind === "lesson");
  const assessments = published.filter((draft) => draft.kind === "assessment");
  const lessonRows = visibleStudents.map((student) => {
    const allowed = new Set((lessonFilter === "all" ? lessons : lessons.filter((lesson) => lesson.draft_id === lessonFilter)).map((lesson) => lesson.draft_id));
    const activity = (student.content_activity ?? []).filter((item) => item.kind === "lesson" && allowed.has(item.draft_id));
    const durations = activity.map((item) => item.duration_seconds).filter(isNumber);
    return {
      ...student,
      itemTitle: lessonFilter === "all" ? "All lessons" : lessons.find((lesson) => lesson.draft_id === lessonFilter)?.title ?? "Lesson",
      completion: allowed.size ? activity.filter((item) => item.completed).length / allowed.size : 0,
      duration: durations.length ? average(durations) : null,
    };
  });
  const assessmentRows = visibleStudents
    .map((student) => {
      const allowed = new Set((assessmentFilter === "all" ? assessments : assessments.filter((assessment) => assessment.draft_id === assessmentFilter)).map((assessment) => assessment.draft_id));
      const activity = (student.content_activity ?? []).filter((item) => item.kind === "assessment" && item.completed && allowed.has(item.draft_id));
      const scores = activity.map((item) => item.score).filter(isNumber);
      const durations = activity.map((item) => item.duration_seconds).filter(isNumber);
      const passingScores = activity.map((item) => item.passing_score).filter(isNumber);
      const score = scores.length ? average(scores) : null;
      const passingScore = passingScores.length ? average(passingScores) : 0.5;
      return {
        ...student,
        itemTitle: assessmentFilter === "all" ? "All assessments" : assessments.find((assessment) => assessment.draft_id === assessmentFilter)?.title ?? "Assessment",
        score,
        passingScore,
        passed: score === null ? null : score >= passingScore,
        duration: durations.length ? average(durations) : null,
      };
    })
    .sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
    .map((student, index) => ({ ...student, rank: student.score === null ? null : index + 1 }));

  return (
    <AppShell title="Class insights" subtitle="Class progress, completion, and assessment performance." accent={dashboard.isFetching ? "Syncing" : "Live"}>
      {dashboard.isError && (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {dashboard.error.message}
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-border bg-card p-5">
        <label className="block text-[10px] uppercase tracking-[0.24em] text-muted-foreground" htmlFor="class-insights-class">
          Classroom
        </label>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          <select
            id="class-insights-class"
            value={selectedClassId}
            onChange={(event) => {
              setLessonFilter("all");
              setAssessmentFilter("");
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
          <select
            aria-label="Lesson"
            value={lessonFilter}
            onChange={(event) => {
              setLessonFilter(event.target.value);
              if (event.target.value) setAssessmentFilter("");
            }}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Choose lesson</option>
            <option value="all">All lessons</option>
            {lessons.map((lesson) => <option key={lesson.draft_id} value={lesson.draft_id}>{lesson.title}</option>)}
          </select>
          <select
            aria-label="Assessment"
            value={assessmentFilter}
            onChange={(event) => {
              setAssessmentFilter(event.target.value);
              if (event.target.value) setLessonFilter("");
            }}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Choose assessment</option>
            <option value="all">All assessments</option>
            {assessments.map((assessment) => <option key={assessment.draft_id} value={assessment.draft_id}>{assessment.title}</option>)}
          </select>
        </div>
        <div className="mt-3 text-sm text-muted-foreground">
          {selectedClass ? `${selectedClass.student_count} enrolled students in ${selectedClass.name}` : `${students.length} students across all classrooms`}
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboard.isLoading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <InsightCard icon={Users} label="Learners" value={students.length} />
            <InsightCard icon={LineChart} label="Overall progress" value={pct(averageProgress)} />
            <InsightCard icon={Target} label="Lesson completion" value={pct(students.length ? completed / students.length : 0)} />
            <InsightCard icon={Target} label="Assessment performance" value={pct(averageAssessment)} />
          </>
        )}
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Learning trends</div>
            <h2 className="mt-1 font-display text-xl">{selectedClass?.name ?? "Class insights"}</h2>
          </div>
          <form
            className="flex w-full max-w-sm gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setStudentSearch(searchInput.trim());
            }}
          >
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search student"
              aria-label="Search student"
              className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
            />
            <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm text-background">
              <Search className="size-4" /> Search
            </button>
          </form>
        </div>
        <div className="overflow-x-auto">
          {lessonFilter && (
            <table className="w-full min-w-[680px] text-left text-sm">
              <TableHead headings={["Name", "Lesson", "Completion", "Time"]} />
              <tbody>
                {lessonRows.map((student) => (
                  <tr key={student.learner_id} className="border-b border-border/60">
                    <td className="py-3 pr-4 font-medium">
                      {assessmentFilter === "all" ? (
                        <Link to="/student/$studentId" params={{ studentId: student.learner_id }} className="text-plum underline-offset-4 hover:underline">
                          {student.name}
                        </Link>
                      ) : student.name}
                    </td>
                    <td className="max-w-64 truncate py-3 pr-4 text-muted-foreground">{student.itemTitle}</td>
                    <td className="py-3 pr-4">{pct(student.completion)}</td>
                    <td className="hidden">
                      {"passed" in student && student.passed !== null ? (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${student.passed ? "bg-emerald-500/10 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>
                          {student.passed ? "Pass" : "Fail"} · pass {pct(student.passingScore)}
                        </span>
                      ) : "â€”"}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatDuration(student.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {assessmentFilter && (
            <table className="w-full min-w-[760px] text-left text-sm">
              <TableHead headings={["Rank", "Name", "Assessment", "Pass / Fail", "Score", "Time"]} />
              <tbody>
                {assessmentRows.map((student) => (
                  <tr key={student.learner_id} className="border-b border-border/60">
                    <td className="py-3 pr-4 font-medium">{student.rank === null ? "—" : `#${student.rank}`}</td>
                    <td className="py-3 pr-4 font-medium">
                      {assessmentFilter === "all" ? (
                        <Link
                          to="/student/$studentId"
                          params={{ studentId: student.learner_id }}
                          aria-label={`Open assessment data for ${student.name}`}
                          title="Open student assessment data"
                          className="-mx-2 inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-plum transition-colors hover:bg-plum/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plum"
                        >
                          <span>{student.name}</span>
                          <ExternalLink className="size-4" aria-hidden="true" />
                        </Link>
                      ) : student.name}
                    </td>
                    <td className="max-w-64 truncate py-3 pr-4 text-muted-foreground">{student.itemTitle}</td>
                    <td className="py-3 pr-4">
                      {student.passed === null ? "â€”" : (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${student.passed ? "bg-emerald-500/10 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>
                          {student.passed ? "Pass" : "Fail"} · pass {pct(student.passingScore)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">{student.score === null ? "—" : pct(student.score)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatDuration(student.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!dashboard.isLoading && students.length === 0 && (
          <div className="grid min-h-32 place-items-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
            {selectedClass ? "No learners are enrolled in this classroom yet." : "No class insight data is available yet."}
          </div>
        )}
        {!dashboard.isLoading && students.length > 0 && visibleStudents.length === 0 && (
          <div className="grid min-h-32 place-items-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
            No student matches “{studentSearch}”.
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

function TableHead({ headings }: { headings: string[] }) {
  return (
    <thead className="border-b border-border text-xs uppercase tracking-[0.16em] text-muted-foreground">
      <tr>
        {headings.map((heading) => (
          <th key={heading} className="py-3 pr-4 font-medium">
            <span className="inline-flex items-center gap-1">{heading}<ArrowDownUp className="size-3" /></span>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function pct(value: number | null | undefined) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes} min ${remainingSeconds} sec`;
}
