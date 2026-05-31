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
} from "lucide-react";
import type { ReactNode } from "react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/routes";

const nav = [
  { to: ROUTES.LESSON, label: "Lesson", icon: BookOpen, kbd: "L" },
  { to: ROUTES.KNOWLEDGE, label: "Knowledge", icon: Network, kbd: "K" },
  { to: ROUTES.ASSESSMENT, label: "Assessment", icon: Target, kbd: "A" },
  { to: ROUTES.PROGRESS, label: "Progress", icon: LineChart, kbd: "P" },
  { to: ROUTES.INTELLIGENCE, label: "Intelligence", icon: Brain, kbd: "I" },
  { to: ROUTES.PEDAGOGY, label: "Pedagogy", icon: Compass, kbd: "S" },
] as const;

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

  return (
    <ProtectedRoute>
      <div className="min-h-dvh flex bg-background text-foreground">
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border/70 px-4 py-5 sticky top-0 h-dvh">
          <Link to={ROUTES.HOME} className="flex items-center gap-2 px-2 mb-7 group">
            <div
              className="size-7 rounded-lg"
              style={{ backgroundImage: "var(--gradient-aurora)" }}
            />
            <div className="font-display text-lg tracking-tight">EvolvED</div>
          </Link>

          <div className="px-1 mb-4">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
              <Search className="size-3.5" />
              <span>Ask EvolvED anything</span>
              <span className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px]">
                ⌘K
              </span>
            </div>
          </div>

          <nav className="flex flex-col gap-0.5">
            {nav.map((n) => {
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
                  <span className="text-[10px] text-muted-foreground/70 font-mono">{n.kbd}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto rounded-2xl border border-border bg-card/60 p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
              <span className="size-1.5 rounded-full bg-orchid animate-pulse" /> Learner model
            </div>
            <div className="font-display text-base leading-tight">
              {currentUser?.fullName ?? "Maya Learner"} · Calculus I
            </div>
            <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
              <Row k="Mastery" v={74} />
              <Row k="Confidence" v={61} />
              <Row k="Streak" raw="12d" />
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
            <Link to={ROUTES.HOME} className="lg:hidden font-display">
              EvolvED
            </Link>
            <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
              <Link to={ROUTES.HOME} className="hover:text-foreground">
                Home
              </Link>
              <span>/</span>
              <span className="text-foreground">{title}</span>
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="hidden md:inline text-muted-foreground">Calibrated 2m ago</span>
              <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="size-3 text-gold" /> {accent ?? "Adapting"}
              </span>
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
          {nav.map((n) => {
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

function Row({ k, v, raw }: { k: string; v?: number; raw?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-muted-foreground">{k}</span>
      {raw ? (
        <span className="ml-auto font-display text-foreground">{raw}</span>
      ) : (
        <>
          <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${v}%` }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              className="h-full rounded-full"
              style={{ backgroundImage: "var(--gradient-aurora)" }}
            />
          </div>
          <span className="font-mono tabular-nums text-foreground/80 w-6 text-right">{v}</span>
        </>
      )}
    </div>
  );
}
