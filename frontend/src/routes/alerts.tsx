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
                <Link key={alert.alert_id} to={to} search={{ draft: alert.draft_id }} className="block rounded-xl border border-border bg-background/70 p-4 transition-colors hover:border-plum/40 hover:bg-muted/30">
                  <div className="flex items-start gap-3">
                    <Icon className="mt-1 size-4 text-plum" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <span>{alert.title}</span>
                        {alert.completed && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700">Completed</span>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{alert.message}</p>
                      <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>{alert.class_name}</span>
                        <time dateTime={alert.created_at ?? undefined}>{relativePublishTime(alert.created_at)}</time>
                      </div>
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

function relativePublishTime(value?: string | null) {
  if (!value) return "Published recently";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Published recently";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}
