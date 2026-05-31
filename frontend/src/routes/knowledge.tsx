import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { motion } from "framer-motion";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useCurriculum } from "@/hooks/useCurriculum";
import { useProgress } from "@/hooks/useProgress";
import type { CurriculumItem } from "@/types/api";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Map — EvolvED" },
      { name: "description", content: "Explore the living map of what you know, what's next, and how concepts connect." },
    ],
  }),
  component: KnowledgePage,
});

type Node = { id: string; x: number; y: number; label: string; mastery: number; group: string };

function KnowledgePage() {
  const { currentUser } = useAuth();
  const curriculum = useCurriculum();
  const progress = useProgress(currentUser?.id);
  const nodes = buildNodes(curriculum.data?.items ?? [], progress.data?.mastery ?? {});
  const edges = buildEdges(curriculum.data?.items ?? []);
  const [active, setActive] = useState<string>("");
  const activeId = active && nodes.some((node) => node.id === active) ? active : nodes[0]?.id;
  const sel = nodes.find(n => n.id === activeId);
  const find = (id: string) => nodes.find(n => n.id === id);

  return (
    <AppShell title="Your knowledge map" subtitle="A living network of every concept EvolvED has modeled for you." accent={curriculum.isFetching || progress.isFetching ? "Syncing" : "Live"}>
      {(curriculum.isError || progress.isError) && (
        <div className="mb-6 rounded-2xl border border-rose/30 bg-rose/5 p-5">
          <div className="font-medium">Knowledge map could not be fully loaded</div>
          <p className="mt-1 text-sm text-muted-foreground">{curriculum.error?.message ?? progress.error?.message}</p>
          <button onClick={() => { void curriculum.refetch(); void progress.refetch(); }} className="mt-4 rounded-full bg-foreground px-4 py-2 text-sm text-background">
            Retry
          </button>
        </div>
      )}
      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div className="relative aspect-[5/4] rounded-3xl border border-border bg-card overflow-hidden">
          {(curriculum.isLoading || progress.isLoading) && <Skeleton className="absolute inset-4 rounded-3xl" />}
          {!curriculum.isLoading && nodes.length === 0 && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">No curriculum items returned.</div>}
          <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(circle at 50% 20%, var(--orchid) 0%, transparent 60%)" }} />
          <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
            <defs>
              <linearGradient id="edge2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="oklch(0.45 0.18 300)" stopOpacity="0.5" />
                <stop offset="1" stopColor="oklch(0.82 0.15 80)" stopOpacity="0.5" />
              </linearGradient>
            </defs>
            {edges.map(([a, b], i) => {
              const A = find(a), B = find(b);
              if (!A || !B) return null;
              const linked = a === activeId || b === activeId;
              return (
                <motion.line
                  key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y}
                  stroke={linked ? "oklch(0.45 0.18 300)" : "url(#edge2)"}
                  strokeWidth={linked ? 0.4 : 0.2}
                  strokeDasharray={B.mastery < 0.2 ? "0.6,0.6" : undefined}
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: i * 0.04 }}
                />
              );
            })}
            {nodes.map((n, i) => {
              const isActive = n.id === activeId;
              const r = 1.6 + n.mastery * 3.2;
              return (
                <g key={n.id} onClick={() => setActive(n.id)} className="cursor-pointer">
                  <motion.circle
                    cx={n.x} cy={n.y} r={r}
                    fill={`oklch(${0.5 + n.mastery * 0.35} ${0.15 + n.mastery * 0.05} ${300 - n.mastery * 30})`}
                    stroke={isActive ? "oklch(0.22 0.025 270)" : "transparent"} strokeWidth={0.4}
                    initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.05, type: "spring", stiffness: 160 }}
                    style={{ transformOrigin: `${n.x}px ${n.y}px` }}
                  />
                  {isActive && (
                    <motion.circle cx={n.x} cy={n.y} r={r}
                      fill="none" stroke="oklch(0.45 0.18 300)" strokeWidth={0.3}
                      animate={{ r: [r, r * 2.5], opacity: [0.8, 0] }}
                      transition={{ duration: 2, repeat: Infinity }} />
                  )}
                  <text x={n.x} y={n.y + r + 2.4} textAnchor="middle" fontSize="2.2" fill="oklch(0.22 0.025 270)" className="font-medium pointer-events-none select-none">
                    {n.label}
                  </text>
                </g>
              );
            })}
          </svg>
          <Legend />
        </div>

        <aside className="space-y-4">
          <motion.div key={sel?.id ?? "empty"} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-border bg-card p-5">
            {sel ? (
              <>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{sel.group}</div>
            <h3 className="font-display text-2xl mt-1">{sel.label}</h3>
            <div className="mt-4 flex items-center gap-3">
              <Radial value={sel.mastery} />
              <div className="text-sm">
                <div className="font-display text-xl">{Math.round(sel.mastery * 100)}%</div>
                <div className="text-xs text-muted-foreground">mastery</div>
              </div>
            </div>
            <div className="mt-5 text-xs text-muted-foreground space-y-2">
              <div><span className="text-foreground font-medium">Prerequisites:</span> {edges.filter(([,b]) => b === sel.id).map(([a]) => find(a)?.label).filter(Boolean).join(" · ") || "—"}</div>
              <div><span className="text-foreground font-medium">Unlocks:</span> {edges.filter(([a]) => a === sel.id).map(([,b]) => find(b)?.label).filter(Boolean).join(" · ") || "—"}</div>
            </div>
            <button className="mt-5 w-full rounded-full bg-foreground text-background text-sm py-2.5 hover:opacity-90">Start a lesson on {sel.label}</button>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Select a concept once curriculum loads.</div>
            )}
          </motion.div>

          <div className="rounded-2xl border border-border p-5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">Suggested next</div>
            <ul className="space-y-2 text-sm">
              {nodes.slice(0, 3).map(s => (
                <li key={s.id} className="flex items-start gap-2"><span className="size-1 rounded-full bg-plum mt-2" /><span>{s.label}</span></li>
              ))}
              {nodes.length === 0 && <li className="text-muted-foreground">No suggestions yet.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function buildNodes(items: CurriculumItem[], mastery: Record<string, number>): Node[] {
  return items.map((item, index) => {
    const angle = (index / Math.max(items.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const ring = 30 + (index % 3) * 10;
    return {
      id: item.id,
      x: 50 + Math.cos(angle) * ring,
      y: 50 + Math.sin(angle) * ring,
      label: humanize(item.concept),
      mastery: mastery[item.concept] ?? mastery[item.id] ?? 0,
      group: item.topic,
    };
  });
}

function buildEdges(items: CurriculumItem[]): [string, string][] {
  return items.slice(1).map((item, index) => [items[index].id, item.id]);
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Radial({ value }: { value: number }) {
  const c = 2 * Math.PI * 22;
  return (
    <svg width="60" height="60" viewBox="0 0 60 60">
      <circle cx="30" cy="30" r="22" fill="none" stroke="oklch(0.92 0.008 70)" strokeWidth="5" />
      <motion.circle cx="30" cy="30" r="22" fill="none" stroke="url(#rg)" strokeWidth="5" strokeLinecap="round"
        transform="rotate(-90 30 30)" strokeDasharray={c}
        initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value) }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
      <defs>
        <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.45 0.18 300)" />
          <stop offset="1" stopColor="oklch(0.82 0.15 80)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
      {[["Foundations","oklch(0.55 0.18 295)"],["Core","oklch(0.7 0.16 305)"],["Applied","oklch(0.82 0.15 80)"],["Prereqs","oklch(0.92 0.008 70)"]].map(([k,c]) => (
        <span key={k} className="inline-flex items-center gap-1.5 rounded-full bg-card/80 backdrop-blur px-2 py-1 border border-border">
          <span className="size-2 rounded-full" style={{ background: c }} />{k}
        </span>
      ))}
    </div>
  );
}
