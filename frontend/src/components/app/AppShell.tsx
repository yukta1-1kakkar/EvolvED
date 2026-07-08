import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
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
  Users,
  UserRoundPlus,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { EvolvedLogo } from "@/components/brand/EvolvedLogo";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/routes";

const nav = [
  { to: ROUTES.KNOWLEDGE, label: "Knowledge", icon: Network },
  { to: ROUTES.LESSON, label: "Lesson", icon: BookOpen },
  { to: ROUTES.ASSESSMENT, label: "Assessment", icon: Target },
  { to: ROUTES.PROGRESS, label: "Progress", icon: LineChart },
  { to: ROUTES.INTELLIGENCE, label: "Intelligence", icon: Brain },
  { to: ROUTES.PEDAGOGY, label: "Pedagogy", icon: Compass },
  { to: ROUTES.FEEDBACK, label: "Feedback", icon: MessageSquarePlus },
  { to: ROUTES.JOIN_CLASS, label: "Join class", icon: UserRoundPlus },
] as const;

const teacherNav = [{ to: ROUTES.TEACHER, label: "Teacher", icon: Users }] as const;

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
  const [showStatusBrief, setShowStatusBrief] = useState(false);
  const statusLabel = accent ?? "Adapting";
  const statusBrief = statusBriefFor(statusLabel);
  const visibleNav = currentUser?.role === "module_leader" ? [...teacherNav, ...nav] : nav;

  return (
    <ProtectedRoute>
      <div className="min-h-dvh flex bg-background text-foreground">
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border/70 px-4 py-5 sticky top-0 h-dvh">
          <Link to={ROUTES.KNOWLEDGE} className="flex items-center gap-2 px-2 mb-7 group">
            <EvolvedLogo className="size-8" />
            <div className="font-display text-lg tracking-tight">EvolvED</div>
          </Link>

          <div className="px-1 mb-4">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
              <Search className="size-3.5" />
              <span>Ask EvolvED anything</span>
            </div>
          </div>

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
            <Link to={ROUTES.KNOWLEDGE} className="lg:hidden font-display">
              EvolvED
            </Link>
            <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
              <Link to={ROUTES.KNOWLEDGE} className="hover:text-foreground">
                Knowledge
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
                className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[10px] ${active ? "text-foreground bg-foreground/5" : "text-muted-foreground"}`}
              >
                <n.icon className="size-4" />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </ProtectedRoute>
  );
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
