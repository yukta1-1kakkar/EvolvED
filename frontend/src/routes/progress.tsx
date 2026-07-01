import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { motion } from "framer-motion";
import { Flame, TrendingUp, Clock, Award, CheckCircle2, AlertCircle, Activity } from "lucide-react";
import { useMemo, useState } from "react";
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

type ProgressRange = "7d" | "30d" | "all";
type HistoryItem = {
  title: string;
  description: string;
  time: string;
  timestamp?: number;
  kind: "mastery" | "adaptation" | "event";
  score?: number;
  chips: string[];
};

const PROGRESS_RANGES: Array<{ label: string; value: ProgressRange }> = [
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "All", value: "all" },
];

const RANGE_LABELS: Record<ProgressRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All progress",
};

function ProgressPage() {
  const { currentUser } = useAuth();
  const progress = useProgress(currentUser?.id);
  const [range, setRange] = useState<ProgressRange>("30d");
  const masteryByTopic = Object.entries(progress.data?.mastery ?? {}).map(([t, v]) => ({ t, v }));
  const masteredCount = masteryByTopic.filter((m) => m.v >= 0.8).length;
  const averageMastery = masteryByTopic.length
    ? masteryByTopic.reduce((sum, item) => sum + item.v, 0) / masteryByTopic.length
    : 0;
  const filteredHistory = useMemo(
    () => filterHistoryByRange(progress.data?.history ?? [], range),
    [progress.data?.history, range],
  );
  const adaptationHistory = useMemo(
    () => normalizeHistory(progress.data?.history ?? []),
    [progress.data?.history],
  );
  const rangeLabel = RANGE_LABELS[range];

  return (
    <AppShell title="Progress" subtitle="Where you are, how fast you're moving, and what's compounding." accent={progress.isFetching ? "Syncing" : "Live"}>
      {progress.isError && <ErrorPanel message={progress.error.message} onRetry={() => void progress.refetch()} />}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {progress.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-3xl" />)
        ) : (
          <>
            <Stat icon={Flame} k={`${progress.data?.learning_streak ?? 0} days`} v="learning streak" tone="gold" />
            <Stat icon={TrendingUp} k={`${Math.round(averageMastery * 100)}%`} v="average mastery" tone="plum" />
            <Stat icon={Clock} k={`${progress.data?.completed_lessons ?? 0}`} v="completed lessons" />
            <Stat icon={Award} k={String(masteredCount)} v="concepts mastered" />
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 mb-8">
        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Mastery curve</div>
              <h3 className="font-display text-xl mt-1">{rangeLabel}</h3>
            </div>
            <div className="flex gap-1 text-xs text-muted-foreground">
              {PROGRESS_RANGES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setRange(item.value)}
                  className={`px-2.5 py-1 rounded-full transition-colors ${range === item.value ? "bg-foreground text-background" : "hover:text-foreground hover:bg-muted/50"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {progress.isLoading ? <Skeleton className="h-52 w-full rounded-2xl" /> : <MasteryChart history={filteredHistory} masteryValues={masteryByTopic.map((m) => m.v)} />}
        </div>

        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-1">Confidence calibration</div>
          <h3 className="font-display text-xl mb-5">Readiness signal</h3>
          {progress.isLoading ? <Skeleton className="h-40 rounded-2xl" /> : <CalibrationPanel items={masteryByTopic} />}
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-6 mb-8">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Mastery by topic</div>
            <h3 className="font-display text-xl mt-1">{currentUser?.learningTopic ?? "Your learning topics"}</h3>
          </div>
          <span className="text-xs text-muted-foreground">{masteryByTopic.length} tracked concepts</span>
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

      <HistoryTimeline loading={progress.isLoading} items={adaptationHistory} />
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
  const historyValues = history
    .map((entry) => numericProgressValue(entry))
    .filter((value): value is number => typeof value === "number");
  const pts = historyValues.length > 1 ? historyValues : masteryValues;
  if (pts.length === 0) {
    return <div className="grid h-52 place-items-center rounded-2xl bg-muted/30 text-sm text-muted-foreground">No chart data returned.</div>;
  }

  const chartPts = (pts.length === 1 ? [0, pts[0]] : pts).map(clamp01);
  const w = 640, h = 230, padX = 34, padY = 18;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;
  const current = chartPts.at(-1) ?? 0;
  const previous = chartPts.at(-2) ?? chartPts[0] ?? 0;
  const delta = current - previous;
  const step = plotW / (chartPts.length - 1);
  const x = (index: number) => padX + index * step;
  const y = (value: number) => padY + (1 - value) * plotH;
  const d = chartPts.map((value, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(value)}`).join(" ");
  const area = `${d} L${x(chartPts.length - 1)},${h - padY} L${padX},${h - padY} Z`;

  return (
    <div>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="font-display text-3xl">{Math.round(current * 100)}%</div>
          <div className="text-xs text-muted-foreground">current mastery signal</div>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs ${delta >= 0 ? "bg-emerald-500/10 text-emerald-700" : "bg-rose/10 text-rose"}`}>
          {delta >= 0 ? "+" : ""}{Math.round(delta * 100)} pts
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full">
        <defs>
          <linearGradient id="mc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="oklch(0.62 0.17 295)" stopOpacity="0.32" />
            <stop offset="1" stopColor="oklch(0.62 0.17 295)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ml" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="oklch(0.45 0.18 300)" />
            <stop offset="0.55" stopColor="oklch(0.62 0.17 295)" />
            <stop offset="1" stopColor="oklch(0.78 0.14 145)" />
          </linearGradient>
        </defs>
        {[1, 0.75, 0.5, 0.25, 0].map((tick) => (
          <g key={tick}>
            <line x1={padX} y1={y(tick)} x2={w - padX} y2={y(tick)} stroke="oklch(0.9 0.01 270)" strokeWidth="1" />
            <text x={6} y={y(tick) + 4} fontSize="10" fill="oklch(0.5 0.025 270)">{Math.round(tick * 100)}</text>
          </g>
        ))}
        <motion.path d={area} fill="url(#mc)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
        <motion.path d={d} fill="none" stroke="url(#ml)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: "easeOut" }} />
        {chartPts.map((value, index) => (
          <circle key={index} cx={x(index)} cy={y(value)} r={index === chartPts.length - 1 ? 5 : 3.5} fill="oklch(0.99 0 0)" stroke="oklch(0.45 0.18 300)" strokeWidth={index === chartPts.length - 1 ? 2.5 : 1.5} />
        ))}
      </svg>
    </div>
  );
}

function CalibrationPanel({ items }: { items: Array<{ t: string; v: number }> }) {
  const values = items.map((item) => clamp01(item.v));
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const mastered = values.filter((value) => value >= 0.8).length;
  const building = values.filter((value) => value >= 0.5 && value < 0.8).length;
  const review = values.filter((value) => value < 0.5).length;
  const strongest = [...items].sort((a, b) => b.v - a.v)[0];
  const weakest = [...items].sort((a, b) => a.v - b.v)[0];

  if (items.length === 0) {
    return <div className="grid h-44 place-items-center rounded-2xl bg-muted/30 text-sm text-muted-foreground">No calibration data yet.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-background/70 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-display text-4xl">{Math.round(average * 100)}%</div>
            <div className="text-xs text-muted-foreground">calibrated readiness</div>
          </div>
          <SignalRing value={average} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <CalibrationCount icon={CheckCircle2} value={mastered} label="mastered" tone="green" />
          <CalibrationCount icon={Activity} value={building} label="building" tone="plum" />
          <CalibrationCount icon={AlertCircle} value={review} label="review" tone="gold" />
        </div>
      </div>

      <div className="space-y-2">
        <CalibrationBar label="Mastered" value={mastered / items.length} color="oklch(0.72 0.14 145)" />
        <CalibrationBar label="Building" value={building / items.length} color="oklch(0.62 0.17 295)" />
        <CalibrationBar label="Needs review" value={review / items.length} color="oklch(0.78 0.15 80)" />
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="rounded-xl bg-muted/30 p-3">
          <span className="text-foreground">Strongest:</span> {strongest ? `${strongest.t} (${Math.round(strongest.v * 100)}%)` : "-"}
        </div>
        <div className="rounded-xl bg-muted/30 p-3">
          <span className="text-foreground">Focus:</span> {weakest ? `${weakest.t} (${Math.round(weakest.v * 100)}%)` : "-"}
        </div>
      </div>
    </div>
  );
}

function SignalRing({ value }: { value: number }) {
  const size = 72;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="oklch(0.92 0.01 270)" strokeWidth={stroke} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="oklch(0.62 0.17 295)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: circumference * (1 - clamp01(value)) }}
        transition={{ duration: 1, ease: "easeOut" }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function CalibrationCount({ icon: Icon, value, label, tone }: { icon: React.ElementType; value: number; label: string; tone: "green" | "plum" | "gold" }) {
  const color = tone === "green" ? "text-emerald-700 bg-emerald-500/10" : tone === "gold" ? "text-gold bg-gold/10" : "text-plum bg-plum/10";
  return (
    <div className={`rounded-xl px-2 py-3 ${color}`}>
      <Icon className="mx-auto mb-1 size-4" />
      <div className="font-display text-lg leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.12em]">{label}</div>
    </div>
  );
}

function CalibrationBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{Math.round(clamp01(value) * 100)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          whileInView={{ width: `${clamp01(value) * 100}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
    </div>
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

function filterHistoryByRange(history: ApiRecord[], range: ProgressRange) {
  if (range === "all") return history;
  const days = range === "7d" ? 7 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const filtered = history.filter((entry) => {
    const time = entryTimestamp(entry);
    return time === undefined || time >= cutoff;
  });
  return filtered.length > 0 ? filtered : history;
}

function numericProgressValue(entry: ApiRecord) {
  for (const key of ["mastery_score", "score", "confidence_score", "engagement_score"]) {
    const value = entry[key];
    if (typeof value === "number") return clamp01(value);
  }
  const value = Object.values(entry).find((item) => typeof item === "number");
  return typeof value === "number" ? clamp01(value) : undefined;
}

function entryTimestamp(entry: ApiRecord) {
  const value = entry.timestamp ?? entry.time ?? entry.date;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function HistoryTimeline({ loading, items }: { loading: boolean; items: HistoryItem[] }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Adaptation history</div>
          <h3 className="mt-1 font-display text-xl">Learning adjustments</h3>
        </div>
        <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {items.length} recorded signal{items.length === 1 ? "" : "s"}
        </div>
      </div>

      {loading && (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="grid min-h-36 place-items-center rounded-2xl bg-muted/30 px-4 text-center text-sm text-muted-foreground">
          Finish an assessment to create the first adaptation event.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item, index) => (
            <motion.article
              key={`${item.title}-${item.time}-${index}`}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: index * 0.04 }}
              className="relative overflow-hidden rounded-2xl border border-border bg-background/70 p-4"
            >
              <div className="flex items-start gap-3">
                <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${historyTone(item.kind)}`}>
                  <HistoryIcon kind={item.kind} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-medium leading-tight">{item.title}</h4>
                    <span className="text-[11px] text-muted-foreground">{item.time}</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                  {item.score !== undefined && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                        <span>Signal strength</span>
                        <span>{Math.round(item.score * 100)}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundImage: item.score >= 0.8 ? "linear-gradient(90deg, oklch(0.72 0.14 145), oklch(0.82 0.15 80))" : "var(--gradient-aurora)" }}
                          initial={{ width: 0 }}
                          whileInView={{ width: `${item.score * 100}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.8, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                  )}
                  {item.chips.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.chips.map((chip) => (
                        <span key={chip} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
                          {chip}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryIcon({ kind }: { kind: HistoryItem["kind"] }) {
  if (kind === "mastery") return <TrendingUp className="size-4" />;
  if (kind === "adaptation") return <Activity className="size-4" />;
  return <CheckCircle2 className="size-4" />;
}

function historyTone(kind: HistoryItem["kind"]) {
  if (kind === "mastery") return "bg-plum/10 text-plum";
  if (kind === "adaptation") return "bg-gold/10 text-gold";
  return "bg-muted text-foreground";
}

function normalizeHistory(history: ApiRecord[]): HistoryItem[] {
  return history
    .map((entry) => {
      const kind = historyKind(entry);
      const score = numericProgressValue(entry);
      const timestamp = entryTimestamp(entry);
      return {
        title: entryTitle(entry),
        description: entryDescription(entry),
        time: formatHistoryTime(entry),
        timestamp,
        kind,
        score,
        chips: historyChips(entry, kind),
      };
    })
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

function historyKind(entry: ApiRecord): HistoryItem["kind"] {
  const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
  if (type.includes("mastery")) return "mastery";
  if (type.includes("adaptation")) return "adaptation";
  return "event";
}

function historyChips(entry: ApiRecord, kind: HistoryItem["kind"]) {
  const chips: string[] = [];
  const concept = typeof entry.concept === "string" ? entry.concept : "";
  const status = typeof entry.status === "string" ? entry.status : "";
  if (concept) chips.push(humanize(concept));
  if (status) chips.push(humanize(status));
  if (kind === "adaptation") chips.push("Strategy update");
  return chips.slice(0, 3);
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
  const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
  if (type.includes("mastery")) return "Mastery updated";
  if (type.includes("adaptation")) return "Teaching strategy adjusted";
  const value = entry.title ?? entry.event ?? entry.action ?? entry.type;
  return typeof value === "string" ? humanize(value) : "Progress event";
}

function formatHistoryTime(entry: ApiRecord) {
  const value = entry.timestamp ?? entry.time ?? entry.date;
  if (typeof value !== "string") return "Recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function adaptationDescription(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as ApiRecord;
  const adaptations = record.adaptations;
  if (!adaptations || typeof adaptations !== "object" || Array.isArray(adaptations)) return "";
  const adaptation = adaptations as ApiRecord;
  const action = typeof adaptation.action === "string" ? adaptation.action : "";
  const reasoning = typeof adaptation.reasoning === "string" ? adaptation.reasoning : "";
  return [action, reasoning].filter(Boolean).join(": ");
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function entryDescription(entry: ApiRecord) {
  const type = typeof entry.type === "string" ? entry.type.toLowerCase() : "";
  if (type.includes("mastery")) {
    const concept = typeof entry.concept === "string" ? humanize(entry.concept) : "this concept";
    const score = typeof entry.mastery_score === "number" ? ` to ${Math.round(entry.mastery_score * 100)}%` : "";
    return `Mastery for ${concept} moved${score}.`;
  }
  if (type.includes("adaptation")) {
    return adaptationDescription(entry.detail) || "The next lesson plan was adjusted from your latest assessment.";
  }
  const value = entry.description ?? entry.reason ?? entry.detail;
  if (typeof value === "string") return value;
  return Object.entries(entry)
    .map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`)
    .join(" · ");
}
