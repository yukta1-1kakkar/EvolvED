import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { motion } from "framer-motion";
import { Brain, AlertTriangle, GitBranch, Database, Eye, Search, Clock3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { useMemory } from "@/hooks/useMemory";
import type { ApiJson, ApiRecord, RetrievedMemory } from "@/types/api";

export const Route = createFileRoute("/intelligence")({
  head: () => ({
    meta: [
      { title: "AI Intelligence — EvolvED" },
      { name: "description", content: "What EvolvED currently understands about you, and why it teaches the way it does." },
    ],
  }),
  component: IntelligencePage,
});

function IntelligencePage() {
  const { currentUser } = useAuth();
  const analytics = useAnalytics(currentUser?.id);
  const memory = useMemory(currentUser?.id, "current learner model misconceptions pedagogy");
  const engagement = analytics.data?.engagement_trends ?? {};
  const performance = analytics.data?.performance_trends ?? {};

  return (
    <AppShell title="What EvolvED knows about you" subtitle="A transparent view of learner analytics and retrieved memories from the backend." accent={analytics.isFetching || memory.isFetching ? "Syncing" : "Reasoning"}>
      {(analytics.isError || memory.isError) && (
        <div className="mb-6 rounded-2xl border border-rose/30 bg-rose/5 p-5">
          <div className="font-medium">Intelligence data could not be loaded</div>
          <p className="mt-1 text-sm text-muted-foreground">{analytics.error?.message ?? memory.error?.message}</p>
          <button onClick={() => { void analytics.refetch(); void memory.refetch(); }} className="mt-4 rounded-full bg-foreground px-4 py-2 text-sm text-background">
            Retry
          </button>
        </div>
      )}
      <div className="grid xl:grid-cols-[1.2fr_1fr] gap-6 mb-6">
        {/* Learner model radial */}
        <div className="rounded-3xl border border-border bg-card p-6 relative overflow-hidden">
          <div className="absolute -top-32 -right-32 size-80 rounded-full opacity-30" style={{ backgroundImage: "var(--gradient-aurora)", filter: "blur(60px)" }} />
          <div className="relative">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground flex items-center gap-2"><Brain className="size-3" /> Learner model</div>
            <h3 className="font-display text-2xl mt-1 mb-6">A picture of how you think</h3>
            {analytics.isLoading ? <Skeleton className="mx-auto h-80 w-80 rounded-full" /> : <Radar data={{ ...engagement, ...performance }} />}
          </div>
        </div>

        {/* Reasoning pipeline */}
        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground flex items-center gap-2"><GitBranch className="size-3" /> Backend analytics trace</div>
          <h3 className="font-display text-2xl mt-1 mb-5">Returned learner signals</h3>
          <ol className="space-y-3 text-sm">
            {analyticsPairs({ ...engagement, ...performance }).map(([k, v], i) => (
              <motion.li key={k} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="flex gap-3">
                <span className="font-mono text-[10px] text-muted-foreground w-12 pt-1">0{i + 1}</span>
                <div className="flex-1 border-l border-border pl-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
                  <div className="text-foreground/90 mt-0.5">{v}</div>
                </div>
              </motion.li>
            ))}
            {!analytics.isLoading && analyticsPairs({ ...engagement, ...performance }).length === 0 && <li className="text-sm text-muted-foreground">No analytics signals returned yet.</li>}
          </ol>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <Card icon={AlertTriangle} title="Misconception watch" tone="rose">
          <div className="space-y-2.5 text-sm">
            {numericPairs(performance).slice(0, 3).map(([k, p]) => (
              <div key={k}>
                <div className="flex justify-between text-xs mb-1"><span>{humanize(k)}</span><span className="text-muted-foreground tabular-nums">{Math.round(p * 100)}%</span></div>
                <div className="h-1 bg-muted rounded-full overflow-hidden"><div className="h-full bg-rose rounded-full" style={{ width: `${p * 100}%` }} /></div>
              </div>
            ))}
            {!analytics.isLoading && numericPairs(performance).length === 0 && <div className="text-sm text-muted-foreground">No performance flags returned.</div>}
          </div>
        </Card>
        <Card icon={Database} title="Retrieved memories">
          <MemorySnapshot memories={memory.data?.results ?? []} loading={memory.isLoading} />
        </Card>
        <Card icon={Eye} title="Confidence estimate">
          <div className="font-display text-4xl">{firstNumeric(engagement).toFixed(2)}</div>
          <p className="text-xs text-muted-foreground mt-2">First numeric engagement signal from GET /analytics.</p>
          <div className="mt-4 h-1.5 rounded-full bg-muted overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${firstNumeric(engagement) * 100}%` }} transition={{ duration: 1 }} className="h-full" style={{ backgroundImage: "var(--gradient-warm)" }} />
          </div>
        </Card>
      </div>

      <MemoryPanel
        memories={memory.data?.results ?? []}
        concepts={memory.data?.concepts ?? []}
        query={memory.data?.query ?? "current learner model misconceptions pedagogy"}
        loading={memory.isLoading}
      />

      <div className="rounded-3xl border border-border bg-card p-6">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">AI insights</div>
        <ul className="mt-4 space-y-3 text-sm">
          {(analytics.data?.insights ?? []).map((insight) => <li key={insight} className="rounded-2xl bg-muted/35 p-4">{insight}</li>)}
        </ul>
      </div>

    </AppShell>
  );
}

function MemorySnapshot({ memories, loading }: { memories: RetrievedMemory[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-28 w-full rounded-2xl" />;
  if (!memories.length) return <div className="text-sm text-muted-foreground">No memories returned.</div>;
  return (
    <div className="space-y-3">
      {memories.slice(0, 3).map((memory, index) => (
        <div key={memory.id || index} className="text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{memory.concept}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{Math.round(memory.score * 100)}%</span>
          </div>
          <div className="mt-1 h-1 rounded-full bg-muted">
            <div className="h-full rounded-full bg-plum" style={{ width: `${Math.max(4, memory.score * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MemoryPanel({ memories, concepts, query, loading }: { memories: RetrievedMemory[]; concepts: string[]; query: string; loading: boolean }) {
  return (
    <section className="mb-6 rounded-3xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            <Database className="size-3.5 text-plum" /> Memory retrieval
          </div>
          <h3 className="mt-1 font-display text-2xl">What memory is being used</h3>
        </div>
        <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
          <Search className="size-3.5 shrink-0" />
          <span className="truncate">{query}</span>
        </div>
      </div>

      {concepts.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {concepts.map((concept) => (
            <span key={concept} className="rounded-full border border-plum/20 bg-plum/[0.06] px-3 py-1 text-xs font-medium text-plum">
              {concept}
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : memories.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {memories.map((memory, index) => (
            <MemoryCard key={memory.id || index} memory={memory} index={index} />
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">No memory matched this query yet. Complete lessons, quizzes, or tutor conversations to build retrievable learner memory.</p>
      )}
    </section>
  );
}

function MemoryCard({ memory, index }: { memory: RetrievedMemory; index: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="rounded-2xl border border-border bg-muted/20 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{memory.source}</div>
          <h4 className="mt-1 text-base font-medium">{memory.concept}</h4>
        </div>
        <span className="rounded-full bg-background px-2 py-1 text-xs tabular-nums text-muted-foreground">
          {Math.round(memory.score * 100)}%
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-foreground/85">{memory.snippet}</p>
      <div className="mt-4 h-1.5 rounded-full bg-background">
        <div className="h-full rounded-full bg-plum" style={{ width: `${Math.max(4, memory.score * 100)}%` }} />
      </div>
      <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Clock3 className="mt-0.5 size-3.5 shrink-0 text-plum" />
        <span>{memory.why || "Retrieved because it matched the current learner query."}</span>
      </div>
    </motion.article>
  );
}

function Card({ icon: Icon, title, children, tone }: { icon: React.ElementType; title: string; children: React.ReactNode; tone?: "rose" }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
        <Icon className={`size-3.5 ${tone === "rose" ? "text-rose" : "text-plum"}`} /> {title}
      </div>
      {children}
    </div>
  );
}

function Radar({ data }: { data: ApiRecord }) {
  const pairs = numericPairs(data).slice(0, 8);
  const axes = pairs.length ? pairs.map(([key]) => humanize(key)) : ["Analytics"];
  const v = pairs.length ? pairs.map(([, value]) => value) : [0];
  const cx = 180, cy = 180, R = 140;
  const pt = (i: number, val: number) => {
    const a = (i / axes.length) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * R * val, cy + Math.sin(a) * R * val];
  };
  const poly = v.map((val, i) => pt(i, val).join(",")).join(" ");
  return (
    <svg viewBox="0 0 360 360" className="w-full max-w-md mx-auto">
      {[0.25,0.5,0.75,1].map(r => (
        <polygon key={r} points={axes.map((_,i)=>pt(i,r).join(",")).join(" ")} fill="none" stroke="oklch(0.88 0.012 75)" strokeWidth={0.5} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="oklch(0.88 0.012 75)" strokeWidth={0.5} />;
      })}
      <motion.polygon points={poly} fill="oklch(0.72 0.16 305 / 0.25)" stroke="oklch(0.45 0.18 300)" strokeWidth={1.5}
        initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformOrigin: `${cx}px ${cy}px` }} />
      {axes.map((a, i) => {
        const [x, y] = pt(i, 1.12);
        return <text key={a} x={x} y={y} textAnchor="middle" fontSize="11" fill="oklch(0.38 0.025 265)">{a}</text>;
      })}
      {v.map((val, i) => {
        const [x, y] = pt(i, val);
        return <circle key={i} cx={x} cy={y} r={3} fill="oklch(0.45 0.18 300)" />;
      })}
    </svg>
  );
}

function numericPairs(record: ApiRecord): [string, number][] {
  return Object.entries(record)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([key, value]) => [key, Math.min(1, Math.max(0, value))]);
}

function analyticsPairs(record: ApiRecord): [string, string][] {
  return Object.entries(record).slice(0, 5).map(([key, value]) => [humanize(key), valueToText(value)]);
}

function firstNumeric(record: ApiRecord) {
  return numericPairs(record)[0]?.[1] ?? 0;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function valueToText(value: ApiJson): string {
  if (value === null) return "No value";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

