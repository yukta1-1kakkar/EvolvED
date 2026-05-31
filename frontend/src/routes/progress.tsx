import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { motion } from "framer-motion";
import { Flame, TrendingUp, Clock, Award } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useProgress } from "@/hooks/useProgress";
import type { ApiRecord } from "@/types/api";

export const Route = createFileRoute("/progress")({
  head: () => ({
    meta: [
      { title: "Progress — EvolvED" },
      { name: "description", content: "Mastery, confidence, velocity, and adaptation history." },
    ],
  }),
  component: ProgressPage,
});

function ProgressPage() {
  const { currentUser } = useAuth();
  const progress = useProgress(currentUser?.id);
  const masteryByTopic = Object.entries(progress.data?.mastery ?? {}).map(([t, v]) => ({ t, v }));
  const masteredCount = masteryByTopic.filter((m) => m.v >= 0.8).length;
  const averageMastery = masteryByTopic.length
    ? masteryByTopic.reduce((sum, item) => sum + item.v, 0) / masteryByTopic.length
    : 0;

  return (
    <AppShell title="Progress" subtitle="Where you are, how fast you're moving, and what's compounding." accent={progress.isFetching ? "Syncing" : "Live"}>
      {progress.isError && <ErrorPanel message={progress.error.message} onRetry={() => void progress.refetch()} />}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {progress.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-3xl" />)
        ) : (
          <>
            <Stat icon={Flame} k={currentUser?.fullName?.split(" ")[0] ?? "Learner"} v="active learner" tone="gold" />
            <Stat icon={TrendingUp} k={`${Math.round(averageMastery * 100)}%`} v="average mastery" tone="plum" />
            <Stat icon={Clock} k={`${progress.data?.history.length ?? 0}`} v="progress events" />
            <Stat icon={Award} k={String(masteredCount)} v="concepts mastered" />
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 mb-8">
        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Mastery curve</div>
              <h3 className="font-display text-xl mt-1">Last 30 days</h3>
            </div>
            <div className="flex gap-1 text-xs text-muted-foreground">
              {["7d","30d","All"].map((k,i) => (
                <button key={k} className={`px-2.5 py-1 rounded-full ${i===1?"bg-foreground text-background":"hover:text-foreground"}`}>{k}</button>
              ))}
            </div>
          </div>
          {progress.isLoading ? <Skeleton className="h-52 w-full rounded-2xl" /> : <MasteryChart history={progress.data?.history ?? []} masteryValues={masteryByTopic.map((m) => m.v)} />}
        </div>

        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">Confidence calibration</div>
          <h3 className="font-display text-xl mb-5">Backend progress signal</h3>
          {progress.isLoading ? <Skeleton className="h-40 rounded-2xl" /> : <CalibrationDots values={masteryByTopic.map((m) => m.v)} />}
          <p className="text-xs text-muted-foreground mt-4">Loaded from GET /progress for this learner.</p>
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-6 mb-8">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Mastery by topic</div>
            <h3 className="font-display text-xl mt-1">Calculus I</h3>
          </div>
          <span className="text-xs text-muted-foreground">8 topics · 3 active</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-10 gap-y-4">
          {progress.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-xl" />)}
          {!progress.isLoading && masteryByTopic.length === 0 && <p className="text-sm text-muted-foreground">No mastery records returned yet.</p>}
          {masteryByTopic.map((m, i) => (
            <div key={m.t}>
              <div className="flex justify-between text-sm mb-1.5">
                <span>{m.t}</span>
                <span className="text-muted-foreground tabular-nums">{Math.round(m.v * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div initial={{ width: 0 }} whileInView={{ width: `${m.v * 100}%` }} viewport={{ once: true }}
                  transition={{ duration: 1, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full rounded-full"
                  style={{ backgroundImage: m.v > 0.8 ? "linear-gradient(90deg, oklch(0.75 0.14 145), oklch(0.82 0.15 80))" : "var(--gradient-aurora)" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-border p-6">
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-4">Adaptation history</div>
        <ol className="relative border-l border-border ml-2 space-y-5 pl-5 text-sm">
          {(progress.data?.history ?? []).map((entry, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[26px] top-1.5 size-2.5 rounded-full" style={{ backgroundImage: "var(--gradient-aurora)" }} />
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{entryTitle(entry)}</span>
                <span className="text-xs text-muted-foreground shrink-0">{entryTime(entry)}</span>
              </div>
              <p className="text-muted-foreground text-xs mt-1">{entryDescription(entry)}</p>
            </li>
          ))}
          {!progress.isLoading && (progress.data?.history.length ?? 0) === 0 && <li className="text-muted-foreground">No adaptation history returned yet.</li>}
        </ol>
      </div>
    </AppShell>
  );
}

function Stat({ icon: Icon, k, v, tone }: { icon: React.ElementType; k: string; v: string; tone?: "gold" | "plum" }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-border bg-card p-5">
      <div className={`size-9 rounded-xl grid place-items-center mb-3 ${tone === "gold" ? "bg-gold/15 text-gold" : tone === "plum" ? "bg-plum/10 text-plum" : "bg-muted text-foreground"}`}>
        <Icon className="size-4" />
      </div>
      <div className="font-display text-2xl">{k}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{v}</div>
    </motion.div>
  );
}

function MasteryChart({ history, masteryValues }: { history: ApiRecord[]; masteryValues: number[] }) {
  const historyValues = history.map((entry) => Object.values(entry).find((value) => typeof value === "number")).filter((value): value is number => typeof value === "number");
  const pts = historyValues.length > 1 ? historyValues : masteryValues;
  if (pts.length === 0) {
    return <div className="grid h-52 place-items-center rounded-2xl bg-muted/30 text-sm text-muted-foreground">No chart data returned.</div>;
  }
  const chartPts = pts.length === 1 ? [0, pts[0]] : pts;
  const w = 600, h = 200, pad = 10;
  const step = (w - pad * 2) / (chartPts.length - 1);
  const y = (v: number) => h - pad - v * (h - pad * 2);
  const d = chartPts.map((v, i) => `${i === 0 ? "M" : "L"}${pad + i * step},${y(v)}`).join(" ");
  const area = `${d} L${pad + (chartPts.length - 1) * step},${h - pad} L${pad},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      <defs>
        <linearGradient id="mc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.72 0.16 305)" stopOpacity="0.35" />
          <stop offset="1" stopColor="oklch(0.72 0.16 305)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ml" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="oklch(0.45 0.18 300)" />
          <stop offset="1" stopColor="oklch(0.82 0.15 80)" />
        </linearGradient>
      </defs>
      <motion.path d={area} fill="url(#mc)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2 }} />
      <motion.path d={d} fill="none" stroke="url(#ml)" strokeWidth={2.5} strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.8, ease: "easeOut" }} />
      {chartPts.map((v, i) => i % 3 === 0 && (
        <circle key={i} cx={pad + i * step} cy={y(v)} r={3} fill="oklch(0.99 0 0)" stroke="oklch(0.45 0.18 300)" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

function CalibrationDots({ values }: { values: number[] }) {
  const pts = values.length ? values : [0];
  return (
    <div className="relative h-40 rounded-2xl bg-muted/30 p-3">
      <svg viewBox="0 0 200 140" className="w-full h-full">
        <line x1="10" y1="130" x2="190" y2="10" stroke="oklch(0.88 0.012 75)" strokeDasharray="2 3" />
        {pts.map((value, i) => {
          const c = Math.min(1, Math.max(0, value));
          const a = Math.min(1, Math.max(0, value));
          return <circle key={i} cx={10 + c * 180} cy={130 - a * 120} r={2.5} fill="oklch(0.72 0.16 305)" opacity={0.7} />;
        })}
      </svg>
      <div className="absolute bottom-2 left-3 text-[10px] text-muted-foreground">stated confidence →</div>
      <div className="absolute top-2 right-3 text-[10px] text-muted-foreground">↑ actual accuracy</div>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mb-6 rounded-2xl border border-rose/30 bg-rose/5 p-5">
      <div className="font-medium">Progress could not be loaded</div>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <button onClick={onRetry} className="mt-4 rounded-full bg-foreground px-4 py-2 text-sm text-background">
        Retry
      </button>
    </div>
  );
}

function entryTitle(entry: ApiRecord) {
  const value = entry.title ?? entry.event ?? entry.action ?? entry.type;
  return typeof value === "string" ? value : "Progress event";
}

function entryTime(entry: ApiRecord) {
  const value = entry.timestamp ?? entry.time ?? entry.date;
  return typeof value === "string" ? value : "Recorded";
}

function entryDescription(entry: ApiRecord) {
  const value = entry.description ?? entry.reason ?? entry.detail;
  if (typeof value === "string") return value;
  return Object.entries(entry)
    .map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`)
    .join(" · ");
}
