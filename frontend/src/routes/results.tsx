import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, ClipboardCheck } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { getStudentClassroom } from "@/lib/api/classroom";

export const Route = createFileRoute("/results")({
  component: ResultsPage,
});

function ResultsPage() {
  const { currentUser } = useAuth();
  const classroom = useQuery({
    queryKey: ["student-classroom", currentUser?.id],
    queryFn: () => getStudentClassroom(currentUser?.id ?? ""),
    enabled: Boolean(currentUser?.id),
  });
  const results = classroom.data?.results ?? [];

  return (
    <AppShell title="Results" subtitle="Your evaluated published lesson and assessment results." accent={classroom.isFetching ? "Syncing" : "Results"}>
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="size-4 text-plum" />
          <h2 className="font-display text-xl">Evaluated results</h2>
        </div>
        {classroom.isLoading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}</div>
        ) : results.length ? (
          <div className="space-y-3">
            {results.map((result) => (
              <article key={result.result_id} className="rounded-xl border border-border bg-background/70 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <ClipboardCheck className="size-4 text-plum" />
                      {result.title}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{result.kind}</span>
                    </div>
                    {result.feedback && <p className="mt-2 text-sm leading-6 text-muted-foreground">{result.feedback}</p>}
                  </div>
                  <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm font-medium">{Math.round(result.score * 100)}%</div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-32 place-items-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
            No evaluated lesson or assessment results yet.
          </div>
        )}
        {classroom.isError && <p className="mt-4 text-sm text-destructive">{classroom.error.message}</p>}
      </section>
    </AppShell>
  );
}
