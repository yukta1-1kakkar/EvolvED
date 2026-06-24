import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { motion } from "framer-motion";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useCurriculum } from "@/hooks/useCurriculum";
import { useProgress } from "@/hooks/useProgress";
import { LESSON_ROADMAP_TOPIC_STORAGE_KEY } from "@/routes/lesson";
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

type Node = { id: string; x: number; y: number; label: string; mastery: number; group: string; item: CurriculumItem };

function KnowledgePage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const curriculum = useCurriculum();
  const progress = useProgress(currentUser?.id);
  const topicItems = filterItemsForSelectedTopic(curriculum.data?.items ?? [], currentUser?.learningTopic);
  const nodes = buildNodes(topicItems, progress.data?.mastery ?? {});
  const edges = buildEdges(topicItems);
  const [active, setActive] = useState<string>("");
  const activeId = active && nodes.some((node) => node.id === active) ? active : nodes[0]?.id;
  const sel = nodes.find(n => n.id === activeId);
  const find = (id: string) => nodes.find(n => n.id === id);
  const topicLabel = topicItems[0]?.topic ?? currentUser?.learningTopic ?? "Your topic";
  const suggestions = buildSuggestions(nodes, edges, activeId);
  const prerequisiteLabels = sel ? prerequisitesFor(sel, edges, find) : [];
  const unlockLabels = sel ? edges.filter(([a]) => a === sel.id).map(([,b]) => find(b)?.label).filter(Boolean) : [];

  function openRoadmap(node: Node) {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(LESSON_ROADMAP_TOPIC_STORAGE_KEY, node.label);
    }

    void navigate({ to: "/lesson", search: { topic: node.label } });
  }

  return (
    <AppShell title={`${topicLabel} knowledge map`} subtitle="Concepts arranged by prerequisites, unlocks, and your current mastery." accent={curriculum.isFetching || progress.isFetching ? "Syncing" : "Live"}>
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
          {!curriculum.isLoading && nodes.length === 0 && (
            <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
              No knowledge map is available for {topicLabel} yet.
            </div>
          )}
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
                <g key={n.id} onClick={() => openRoadmap(n)} className="cursor-pointer">
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
              <div><span className="text-foreground font-medium">Required prerequisites:</span> {prerequisiteLabels.join(" · ") || "None"}</div>
              <div><span className="text-foreground font-medium">Unlocks:</span> {unlockLabels.join(" · ") || "—"}</div>
            </div>
            <button
              type="button"
              onClick={() => openRoadmap(sel)}
              className="mt-5 w-full rounded-full bg-foreground text-background text-sm py-2.5 hover:opacity-90"
            >
              Open roadmap for {sel.label}
            </button>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Select a concept once curriculum loads.</div>
            )}
          </motion.div>

          <div className="rounded-2xl border border-border p-5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">Suggested next in {topicLabel}</div>
            <ul className="space-y-2 text-sm">
              {suggestions.map(s => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => openRoadmap(s)}
                    className="flex w-full items-start gap-2 rounded-xl px-2 py-1 text-left hover:bg-muted/35"
                  >
                    <span className="size-1 rounded-full bg-plum mt-2" />
                    <span>{s.label}</span>
                  </button>
                </li>
              ))}
              {suggestions.length === 0 && <li className="text-muted-foreground">No suggestions yet.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function buildNodes(items: CurriculumItem[], mastery: Record<string, number>): Node[] {
  const positions = layoutPositions(items.length);

  return items.map((item, index) => {
    const position = positions[index] ?? { x: 50, y: 50 };
    return {
      id: item.id,
      x: position.x,
      y: position.y,
      label: humanize(item.concept),
      mastery: mastery[item.concept] ?? mastery[item.id] ?? 0,
      group: item.topic,
      item,
    };
  });
}

function buildEdges(items: CurriculumItem[]): [string, string][] {
  const itemIds = new Set(items.map((item) => item.id));
  const topicKey = normalizeTopic(items[0]?.topic);
  const semanticEdges = PREREQUISITE_EDGES[topicKey] ?? [];
  const scopedEdges = semanticEdges.filter(([from, to]) => itemIds.has(from) && itemIds.has(to));

  if (scopedEdges.length > 0) return scopedEdges;
  return items.slice(1).map((item, index) => [items[index].id, item.id]);
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function filterItemsForSelectedTopic(items: CurriculumItem[], selectedTopic?: string): CurriculumItem[] {
  const normalizedSelected = normalizeTopic(selectedTopic);
  if (!normalizedSelected) return items;

  const exactTopic = items.filter((item) => normalizeTopic(item.topic) === normalizedSelected);
  if (exactTopic.length > 0) return exactTopic;

  const topicContainsSelection = items.filter((item) => {
    const topic = normalizeTopic(item.topic);
    return topic.includes(normalizedSelected) || normalizedSelected.includes(topic);
  });
  if (topicContainsSelection.length > 0) return topicContainsSelection;

  const selectedConcept = items.find((item) => {
    const concept = normalizeTopic(item.concept);
    return concept === normalizedSelected || concept.includes(normalizedSelected) || normalizedSelected.includes(concept);
  });
  if (selectedConcept) {
    return items.filter((item) => normalizeTopic(item.topic) === normalizeTopic(selectedConcept.topic));
  }

  return [];
}

function buildSuggestions(nodes: Node[], edges: [string, string][], activeId?: string): Node[] {
  const unlockIds = edges.filter(([from]) => from === activeId).map(([, to]) => to);
  const unlocked = unlockIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is Node => Boolean(node));
  const lowMastery = nodes
    .filter((node) => node.id !== activeId && !unlockIds.includes(node.id))
    .sort((a, b) => a.mastery - b.mastery);

  return [...unlocked, ...lowMastery].slice(0, 3);
}

function prerequisitesFor(node: Node, edges: [string, string][], find: (id: string) => Node | undefined): string[] {
  const graphPrerequisites = edges
    .filter(([, to]) => to === node.id)
    .map(([from]) => find(from)?.label)
    .filter((label): label is string => Boolean(label));

  if (graphPrerequisites.length > 0) return graphPrerequisites;
  return REQUIRED_PREREQUISITES[node.id] ?? REQUIRED_PREREQUISITES[normalizeTopic(node.item.concept)] ?? [];
}

function layoutPositions(count: number): Array<{ x: number; y: number }> {
  if (count <= 1) return [{ x: 50, y: 50 }];
  if (count === 2) return [{ x: 28, y: 50 }, { x: 72, y: 50 }];
  if (count === 3) return [{ x: 22, y: 62 }, { x: 50, y: 32 }, { x: 78, y: 62 }];
  if (count === 4) return [{ x: 18, y: 68 }, { x: 38, y: 34 }, { x: 62, y: 34 }, { x: 82, y: 68 }];
  if (count === 5) return [{ x: 14, y: 70 }, { x: 32, y: 38 }, { x: 50, y: 18 }, { x: 68, y: 38 }, { x: 86, y: 70 }];

  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const ring = 34;
    return {
      x: 50 + Math.cos(angle) * ring,
      y: 50 + Math.sin(angle) * ring,
    };
  });
}

function normalizeTopic(value?: string) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const PREREQUISITE_EDGES: Record<string, [string, string][]> = {
  linear_algebra: [
    ["la_vectors", "la_matrices"],
    ["la_vectors", "la_projections"],
    ["la_matrices", "la_eigen"],
    ["la_projections", "la_eigen"],
  ],
  calculus: [
    ["calc_limits", "calc_derivatives"],
    ["calc_derivatives", "calc_gradients"],
    ["calc_gradients", "calc_hessians"],
  ],
};

const REQUIRED_PREREQUISITES: Record<string, string[]> = {
  la_vectors: ["Coordinate systems", "Basic algebra", "Number lines"],
  la_matrices: ["Vectors", "Systems of equations", "Arithmetic operations"],
  la_projections: ["Vectors", "Dot products", "Basic trigonometry"],
  la_eigen: ["Vectors", "Matrices", "Solving equations"],
  calc_limits: ["Functions", "Graphs", "Basic algebra"],
  calc_derivatives: ["Limits", "Functions", "Slope of a line"],
  calc_gradients: ["Derivatives", "Partial derivatives", "Multivariable functions"],
  calc_hessians: ["Gradients", "Second derivatives", "Matrices"],
};

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
