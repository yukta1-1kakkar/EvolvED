import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Clipboard, Loader2, Plus, School } from "lucide-react";
import { useRef, useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { createClass, getTeacherDashboard, type ClassSummary } from "@/lib/api/classroom";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/create-classroom")({
  head: () => ({
    meta: [
      { title: "Create Classroom - EvolvED" },
      { name: "description", content: "Create a classroom and prepare an enrollment code for students." },
    ],
  }),
  component: CreateClassroomPage,
});

function CreateClassroomPage() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [className, setClassName] = useState("");
  const [createdClass, setCreatedClass] = useState<ClassSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedClassId, setCopiedClassId] = useState("");
  const copyResetRef = useRef<number | undefined>(undefined);
  const joinCodeCopyResetRef = useRef<number | undefined>(undefined);
  const navigate = Route.useNavigate();
  const dashboard = useQuery({
    queryKey: ["teacher-dashboard", currentUser?.id],
    queryFn: () => getTeacherDashboard(currentUser?.id ?? ""),
    enabled: Boolean(currentUser?.id && currentUser.role === "module_leader"),
  });
  const addClass = useMutation({
    mutationFn: () => createClass(currentUser?.id ?? "", className.trim()),
    onSuccess: async (newClass) => {
      setCreatedClass(newClass);
      setClassName("");
      await queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", currentUser?.id] });
    },
  });

  const copyInviteLink = (item: ClassSummary) => {
    void navigator.clipboard?.writeText(inviteHref(item.invite_link, item.join_code));
    setCopied(true);
    if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopied(false), 1800);
  };
  const copyJoinCode = (item: ClassSummary) => {
    void navigator.clipboard?.writeText(item.join_code);
    setCopiedClassId(item.class_id);
    if (joinCodeCopyResetRef.current) window.clearTimeout(joinCodeCopyResetRef.current);
    joinCodeCopyResetRef.current = window.setTimeout(() => setCopiedClassId(""), 1800);
  };
  const openClassInsights = (classId: string) => {
    void navigate({ to: ROUTES.CLASS_INSIGHTS, search: { classId } });
  };

  if (currentUser?.role !== "module_leader") {
    return (
      <AppShell title="Create classroom" subtitle="Module leader access is required." accent="Protected">
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Sign in with a module leader account to create classrooms.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Create classroom" subtitle="Create a class, generate its join code, and prepare student enrollment." accent={addClass.isPending ? "Creating" : "Classroom"}>
      <section className="mb-6 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <School className="size-4 text-plum" />
            <h2 className="font-display text-xl">New class</h2>
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (className.trim()) addClass.mutate();
            }}
          >
            <Input value={className} onChange={(event) => setClassName(event.target.value)} placeholder="Class name" className="h-11" />
            <Button type="submit" disabled={!className.trim() || addClass.isPending}>
              {addClass.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              Create class
            </Button>
          </form>
          {addClass.isError && <p className="mt-4 text-sm text-destructive">{addClass.error.message}</p>}
          {createdClass && (
            <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-700">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="size-4" />
                {createdClass.name} is ready
              </div>
              <button
                type="button"
                className="mt-3 flex w-full items-center gap-2 rounded-lg bg-background/70 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => copyJoinCode(createdClass)}
              >
                <Clipboard className="size-3.5" />
                <span className="text-muted-foreground">Join code</span>
                <strong className="ml-auto rounded-md px-2 py-1 tracking-[0.2em]">{copiedClassId === createdClass.class_id ? "Copied" : createdClass.join_code}</strong>
              </button>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => copyInviteLink(createdClass)}>
                {copied ? "Copied to clipboard" : "Copy enrollment link"}
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Enrollment</div>
            <h2 className="mt-1 font-display text-xl">Classrooms</h2>
          </div>
          <div className="space-y-3">
            {dashboard.isLoading ? (
              Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)
            ) : (
              (dashboard.data?.classes ?? []).map((item) => (
                <div
                  key={item.class_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openClassInsights(item.class_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openClassInsights(item.class_id);
                    }
                  }}
                  className="block cursor-pointer rounded-xl border border-border bg-background/70 p-4 transition-colors hover:border-plum/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.student_count} students</div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-plum/10 px-2.5 py-1 text-xs text-plum">
                      {item.active ? "View insights" : "Inactive"}
                      {item.active && <ArrowRight className="size-3" />}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="mt-3 flex w-full items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      copyJoinCode(item);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Clipboard className="size-3.5" />
                    <span className="text-muted-foreground">Join code</span>
                    <strong className="ml-auto rounded-md px-2 py-1 tracking-[0.2em]">{copiedClassId === item.class_id ? "Copied" : item.join_code}</strong>
                  </button>
                </div>
              ))
            )}
            {!dashboard.isLoading && (dashboard.data?.classes ?? []).length === 0 && (
              <div className="rounded-xl bg-muted/30 p-5 text-sm text-muted-foreground">No classrooms have been created yet.</div>
            )}
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function inviteHref(path: string, joinCode: string) {
  const relative = path.startsWith("/join-class") ? path : `/join-class?code=${encodeURIComponent(joinCode)}`;
  return typeof window === "undefined" ? relative : new URL(relative, window.location.origin).toString();
}
