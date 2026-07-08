import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Bell, BookOpen, ClipboardCheck, Loader2 } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { getStudentClassroom } from "@/lib/api/classroom";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/alerts")({
  component: AlertsPage,
});

function AlertsPage() {
  const { currentUser } = useAuth();
  const classroom = useQuery({
    queryKey: ["student-classroom", currentUser?.id],
    queryFn: () => getStudentClassroom(currentUser?.id ?? ""),
    enabled: Boolean(currentUser?.id),
  });
  const alerts = classroom.data?.alerts ?? [];

  return (
    <AppShell title="Alerts" subtitle="Published lessons and assessments from your joined classes." accent={classroom.isFetching ? "Syncing" : "Classroom"}>
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Bell className="size-4 text-plum" />
          <h2 className="font-display text-xl">Class notifications</h2>
        </div>
        {classroom.isLoading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}</div>
        ) : alerts.length ? (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const to = alert.kind === "assessment" ? ROUTES.ASSESSMENT : ROUTES.LESSON;
              const Icon = alert.kind === "assessment" ? ClipboardCheck : BookOpen;
              return (
                <Link key={alert.alert_id} to={to} search={alert.kind === "lesson" ? { topic: alert.title } : undefined} className="block rounded-xl border border-border bg-background/70 p-4 transition-colors hover:border-plum/40 hover:bg-muted/30">
                  <div className="flex items-start gap-3">
                    <Icon className="mt-1 size-4 text-plum" />
                    <div>
                      <div className="font-medium">{alert.title}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{alert.message}</p>
                      <div className="mt-2 text-xs text-muted-foreground">{alert.class_name}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-32 place-items-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
            No alerts yet. New published class lessons and assessments will appear here.
          </div>
        )}
        {classroom.isError && <p className="mt-4 text-sm text-destructive">{classroom.error.message}</p>}
      </section>
    </AppShell>
  );
}
