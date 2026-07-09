import { Link, Navigate, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Network,
  Target,
  LineChart,
  Brain,
  Compass,
  Sparkles,
  Search,
  MessageSquarePlus,
  BarChart3,
  School,
  Users,
  Bell,
  UserRoundPlus,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { EvolvedLogo } from "@/components/brand/EvolvedLogo";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/routes";
import { getStudentClassroom, type StudentClassAlert } from "@/lib/api/classroom";
import { apiUrl } from "@/lib/api/client";

const nav = [
  { to: ROUTES.KNOWLEDGE, label: "Knowledge", icon: Network },
  { to: ROUTES.LESSON, label: "Lesson", icon: BookOpen },
  { to: ROUTES.ASSESSMENT, label: "Assessment", icon: Target },
  { to: ROUTES.PROGRESS, label: "Progress", icon: LineChart },
  { to: ROUTES.INTELLIGENCE, label: "Intelligence", icon: Brain },
  { to: ROUTES.PEDAGOGY, label: "Pedagogy", icon: Compass },
  { to: ROUTES.FEEDBACK, label: "Feedback", icon: MessageSquarePlus },
] as const;

const teacherNav = [
  { to: ROUTES.TEACHER, label: "Teacher Dashboard", icon: Users },
  { to: ROUTES.CREATE_CLASSROOM, label: "Create Classroom", icon: School },
  { to: ROUTES.CLASS_INSIGHTS, label: "Class Insights", icon: BarChart3 },
] as const;
const teacherRoutes = new Set<string>(teacherNav.map((item) => item.to));

const classStudentNav = [
  { to: ROUTES.ALERTS, label: "Alerts", icon: Bell },
  { to: ROUTES.LESSON, label: "Lesson", icon: BookOpen },
  { to: ROUTES.ASSESSMENT, label: "Assessment", icon: Target },
  { to: ROUTES.RESULTS, label: "Results", icon: BarChart3 },
  { to: ROUTES.JOIN_CLASS, label: "Join Class", icon: UserRoundPlus },
] as const;
const classStudentRoutes = new Set<string>(classStudentNav.map((item) => item.to));

export function AppShell({
  children,
  title,
  subtitle,
  accent,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  accent?: string;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { currentUser, logout } = useAuth();
  const queryClient = useQueryClient();
  const [showStatusBrief, setShowStatusBrief] = useState(false);
  const statusLabel = accent ?? "Adapting";
  const statusBrief = statusBriefFor(statusLabel);
  const isModuleLeader = currentUser?.role === "module_leader";
  const isClassStudent = currentUser?.accountType === "class_student";
  const classroom = useQuery({
    queryKey: ["student-classroom", currentUser?.id],
    queryFn: () => getStudentClassroom(currentUser?.id ?? ""),
    enabled: Boolean(isClassStudent && currentUser?.id),
  });
  const unfinishedPublishedCount = (classroom.data?.alerts ?? []).filter((item) => !item.completed && (item.kind === "lesson" || item.kind === "assessment")).length;
  const [notification, setNotification] = useState<StudentClassAlert | null>(null);
  const visibleNav = isModuleLeader ? teacherNav : isClassStudent ? classStudentNav : nav;
  const homeRoute = isModuleLeader ? ROUTES.TEACHER : isClassStudent ? ROUTES.ALERTS : ROUTES.KNOWLEDGE;
  const homeLabel = isModuleLeader ? "Teacher Dashboard" : isClassStudent ? "Alerts" : "Knowledge";

  useEffect(() => {
    if (!isClassStudent || !currentUser?.id || !classroom.data?.alerts.length) return;
    const seenKey = `evolved.seenClassAlerts.${currentUser.id}`;
    const seen = readSeenAlerts(seenKey);
    const newest = classroom.data.alerts.find((item) => !seen.has(item.alert_id));
    if (newest) {
      seen.add(newest.alert_id);
      window.localStorage.setItem(seenKey, JSON.stringify([...seen]));
      setNotification(newest);
    }
  }, [classroom.data?.alerts, currentUser?.id, isClassStudent]);

  useEffect(() => {
    if (!isClassStudent || !currentUser?.id) return;
    const stream = new EventSource(apiUrl("/student/notifications/stream", { learner_id: currentUser.id }));
    stream.addEventListener("notification", (event) => {
      try {
        const alert = JSON.parse((event as MessageEvent<string>).data) as StudentClassAlert;
        const seenKey = `evolved.seenClassAlerts.${currentUser.id}`;
        const seen = readSeenAlerts(seenKey);
        if (!seen.has(alert.alert_id)) {
          seen.add(alert.alert_id);
          window.localStorage.setItem(seenKey, JSON.stringify([...seen]));
          setNotification(alert);
        }
        void queryClient.invalidateQueries({ queryKey: ["student-classroom", currentUser.id] });
      } catch {
        // Ignore malformed stream events and keep the live connection open.
      }
    });
    return () => stream.close();
  }, [currentUser?.id, isClassStudent, queryClient]);

  useEffect(() => {
    if (!notification) return;
    const timeout = window.setTimeout(() => setNotification(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  function dismissNotification() {
    setNotification(null);
  }

  if (isModuleLeader && !teacherRoutes.has(path) && !path.startsWith("/student/")) {
    return <Navigate to={ROUTES.TEACHER} replace />;
  }

  if (isClassStudent && !classStudentRoutes.has(path)) {
    return <Navigate to={ROUTES.LESSON} replace />;
  }

  return (
    <ProtectedRoute>
      <div className="min-h-dvh flex bg-background text-foreground">
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border/70 px-4 py-5 sticky top-0 h-dvh">
          <Link to={homeRoute} className="flex items-center gap-2 px-2 mb-7 group">
            <EvolvedLogo className="size-8" />
            <div className="font-display text-lg tracking-tight">EvolvED</div>
          </Link>

          {!isClassStudent && <div className="px-1 mb-4">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
              <Search className="size-3.5" />
              <span>Ask EvolvED anything</span>
            </div>
          </div>}

          <nav className="flex flex-col gap-0.5">
            {visibleNav.map((n) => {
              const active = path.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors relative ${
                    active
                      ? "bg-foreground/[0.06] text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="navdot"
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                      style={{ backgroundImage: "var(--gradient-aurora)" }}
                    />
                  )}
                  <n.icon className="size-4" />
                  <span className="flex-1">{n.label}</span>
                  {isClassStudent && n.to === ROUTES.ALERTS && unfinishedPublishedCount > 0 && (
                    <span className="grid min-w-5 place-items-center rounded-full bg-plum px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {unfinishedPublishedCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto rounded-2xl border border-border bg-card/60 p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
              <span className="size-1.5 rounded-full bg-orchid animate-pulse" /> Learner model
            </div>
            <div className="font-display text-base leading-tight">
              {currentUser?.fullName ?? "Learner"}
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              {currentUser?.learningTopic ?? "Learner profile ready"}
            </div>
            <button
              type="button"
              onClick={logout}
              className="mt-4 w-full rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-30 backdrop-blur bg-background/80 border-b border-border/70 px-6 lg:px-10 h-14 flex items-center gap-4">
            <Link to={homeRoute} className="lg:hidden font-display">
              EvolvED
            </Link>
            <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
              <Link to={homeRoute} className="hover:text-foreground">
                {homeLabel}
              </Link>
              <span>/</span>
              <span className="text-foreground">{title}</span>
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="hidden md:inline text-muted-foreground">Calibrated 2m ago</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowStatusBrief((value) => !value)}
                  className="rounded-full border border-border px-2.5 py-1 text-muted-foreground flex items-center gap-1.5 transition-colors hover:border-plum/40 hover:text-foreground"
                  aria-expanded={showStatusBrief}
                  aria-label={`What ${statusLabel} means`}
                >
                  <Sparkles className="size-3 text-gold" /> {statusLabel}
                </button>
                {showStatusBrief && (
                  <div className="absolute right-0 top-8 z-50 w-72 rounded-2xl border border-border bg-card p-4 text-sm shadow-soft">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Status brief</div>
                    <div className="mt-1 font-medium text-foreground">{statusLabel}</div>
                    <p className="mt-2 leading-6 text-muted-foreground">{statusBrief}</p>
                  </div>
                )}
              </div>
            </div>
          </header>

          <motion.main
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 px-6 lg:px-10 py-8"
          >
            <div className="mb-8">
              <h1 className="font-display text-3xl md:text-4xl leading-tight text-balance">
                {title}
              </h1>
              {subtitle && (
                <p className="text-muted-foreground mt-2 max-w-2xl text-pretty">{subtitle}</p>
              )}
            </div>
            {children}
          </motion.main>
        </div>

        {/* Mobile nav */}
        <nav className="lg:hidden fixed bottom-4 inset-x-4 z-40 glass rounded-2xl px-2 py-2 flex justify-between">
          {visibleNav.map((n) => {
            const active = path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`relative flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[10px] ${active ? "text-foreground bg-foreground/5" : "text-muted-foreground"}`}
              >
                <n.icon className="size-4" />
                <span>{n.label}</span>
                {isClassStudent && n.to === ROUTES.ALERTS && unfinishedPublishedCount > 0 && (
                  <span className="absolute right-2 top-1 grid min-w-4 place-items-center rounded-full bg-plum px-1 text-[9px] font-semibold text-white">
                    {unfinishedPublishedCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      {notification && (
        <div className="fixed bottom-5 right-5 z-[70] w-[min(26rem,calc(100vw-2.5rem))] rounded-2xl border border-plum/30 bg-card p-5 shadow-2xl">
          <div className="text-[10px] uppercase tracking-[0.2em] text-plum">New class notification</div>
          <div className="mt-2 font-display text-xl">{notification.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{notification.message}</p>
          <div className="mt-4 flex gap-2">
            <Link
              to={notification.kind === "assessment" ? ROUTES.ASSESSMENT : ROUTES.LESSON}
              search={{ draft: notification.draft_id }}
              onClick={dismissNotification}
              className="rounded-full bg-foreground px-4 py-2 text-sm text-background"
            >
              Open {notification.kind}
            </Link>
            <button type="button" onClick={dismissNotification} className="rounded-full border border-border px-4 py-2 text-sm">
              Later
            </button>
          </div>
        </div>
      )}
    </ProtectedRoute>
  );
}

function readSeenAlerts(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "[]");
    return new Set<string>(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function statusBriefFor(label: string) {
  const key = label.toLowerCase();
  if (key.includes("reasoning")) return "The AI is interpreting your learner model, assessment evidence, and recent activity to explain or adapt decisions.";
  if (key.includes("syncing")) return "EvolvED is refreshing learner data, progress, or analytics from the backend.";
  if (key.includes("live")) return "This page is showing the latest available learner state and progress signals.";
  if (key.includes("composing")) return "The system is preparing the selected lesson context and assembling the next learning experience.";
  if (key.includes("planning")) return "The roadmap agent is organizing concepts, prerequisites, and lesson order.";
  if (key.includes("ready")) return "The generated roadmap or lesson state is available for use.";
  if (key.includes("evolving")) return "The system is evaluating your submission and updating the next teaching move.";
  if (key.includes("adaptive")) return "The page is using your learner profile, confidence, and progress to personalize the experience.";
  if (key.includes("feedback")) return "Peer review signals are being collected for the human-in-the-loop refinement cycle.";
  if (key.includes("missing")) return "A required lesson or roadmap selection is missing, so the page needs a valid selection first.";
  return "EvolvED is adjusting the page based on the current learner workflow and available model signals.";
}
