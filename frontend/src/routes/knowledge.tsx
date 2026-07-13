import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { MathText } from "@/components/learning/MathText";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useCurriculum } from "@/hooks/useCurriculum";
import { fetchRoadmap } from "@/hooks/useLesson";
import { useProgress } from "@/hooks/useProgress";
import { constraintsFromBrief, makeInitialBrief, prefetchRoadmapLessons } from "@/lib/lesson-planning";
import { getCompletedRoadmapLessonCount, setActiveRoadmapTopic } from "@/lib/lesson-progress";
import { LESSON_ROADMAP_TOPIC_STORAGE_KEY } from "@/routes/lesson";
import type { CurriculumItem } from "@/types/api";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Map - EvolvED" },
      { name: "description", content: "Explore the living map of what you know, what's next, and how concepts connect." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <KnowledgePage />
    </ProtectedRoute>
  ),
});

type Node = { id: string; x: number; y: number; label: string; mastery: number; group: string; item: CurriculumItem };

function KnowledgePage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const curriculum = useCurriculum();
  const progress = useProgress(currentUser?.id);
  const curriculumItems = curriculum.data?.items ?? [];
  const topicItems = filterItemsForSelectedTopic(curriculumItems, currentUser?.learningTopic);
  const visibleItems = topicItems.length > 0 ? topicItems : curriculumItems;
  const nodes = buildNodes(visibleItems, progress.data?.mastery ?? {}, currentUser?.id);
  const edges = buildEdges(visibleItems);
  const [active, setActive] = useState<string>("");
  const activeId = active && nodes.some((node) => node.id === active) ? active : nodes[0]?.id;
  const sel = nodes.find(n => n.id === activeId);
  const find = (id: string) => nodes.find(n => n.id === id);
  const topicLabel = visibleItems[0]?.topic ?? currentUser?.learningTopic ?? "Your topic";
  const unlockedIds = unlockedNodeIds(nodes, edges);
  const completedIds = completedNodeIds(nodes);
  const suggestions = buildSuggestions(nodes, edges, unlockedIds, completedIds);
  const prerequisiteLabels = sel ? prerequisitesFor(sel, edges, find) : [];
  const unlockLabels = sel ? edges.filter(([a]) => a === sel.id).map(([,b]) => find(b)?.label).filter(Boolean) : [];
  const selectedLocked = Boolean(sel && !unlockedIds.has(sel.id));
  const warmupBrief = useMemo(() => makeInitialBrief(currentUser), [currentUser]);
  const selectedWarmupBrief = useMemo(
    () => ({ ...warmupBrief, topic: !selectedLocked && sel?.label ? sel.label : "" }),
    [sel?.label, selectedLocked, warmupBrief],
  );
  const [warmingLessons, setWarmingLessons] = useState(false);

  useEffect(() => {
    if (!currentUser?.id) return;
    const briefs = [warmupBrief, selectedWarmupBrief].filter((brief, index, all) => (
      brief.topic && all.findIndex((candidate) => candidate.topic === brief.topic) === index
    ));
    if (!briefs.length) return;

    let cancelled = false;
    setWarmingLessons(true);
    void Promise.allSettled(
      briefs.map(async (brief) => {
        const request = { learner_id: currentUser.id, topic: brief.topic, constraints: constraintsFromBrief(brief) };
        const roadmap = await fetchRoadmap(queryClient, request);
        if (!cancelled && roadmap.lessons.length) {
          await prefetchRoadmapLessons(queryClient, currentUser.id, brief, roadmap.lessons);
        }
      }),
    ).finally(() => {
      if (!cancelled) setWarmingLessons(false);
    });

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, queryClient, selectedWarmupBrief, warmupBrief]);

  function openRoadmap(node: Node) {
    if (!unlockedIds.has(node.id)) {
      setActive(node.id);
      return;
    }

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(LESSON_ROADMAP_TOPIC_STORAGE_KEY, node.label);
    }
    setActiveRoadmapTopic(currentUser?.id, node.label);

    void navigate({ to: "/lesson", search: { topic: node.label } });
  }

  return (
    <AppShell title={`${topicLabel} knowledge map`} subtitle="Concepts arranged by prerequisites, unlocks, and your current mastery." accent={curriculum.isFetching || progress.isFetching ? "Syncing" : warmingLessons ? "Preparing lessons" : "Live"}>
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
              const locked = !unlockedIds.has(b);
              return (
                <motion.line
                  key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y}
                  stroke={locked ? "oklch(0.62 0.025 270)" : linked ? "oklch(0.45 0.18 300)" : "url(#edge2)"}
                  strokeWidth={linked ? 0.4 : 0.2}
                  strokeDasharray={locked ? "0.7,0.7" : undefined}
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: i * 0.04 }}
                />
              );
            })}
            {nodes.map((n, i) => {
              const isActive = n.id === activeId;
              const isUnlocked = unlockedIds.has(n.id);
              const isCompleted = completedIds.has(n.id);
              const r = 1.6 + n.mastery * 3.2;
              return (
                <g key={n.id} onClick={() => openRoadmap(n)} className={isUnlocked ? "cursor-pointer" : "cursor-not-allowed"}>
                  <motion.circle
                    cx={n.x} cy={n.y} r={r}
                    fill={isUnlocked ? `oklch(${0.5 + n.mastery * 0.35} ${0.15 + n.mastery * 0.05} ${300 - n.mastery * 30})` : "oklch(0.78 0.015 270)"}
                    stroke={isActive ? "oklch(0.22 0.025 270)" : "transparent"} strokeWidth={0.4}
                    opacity={isUnlocked ? 1 : 0.65}
                    initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.05, type: "spring", stiffness: 160 }}
                    style={{ transformOrigin: `${n.x}px ${n.y}px` }}
                  />
                  {isActive && isUnlocked && (
                    <motion.circle cx={n.x} cy={n.y} r={r}
                      fill="none" stroke="oklch(0.45 0.18 300)" strokeWidth={0.3}
                      animate={{ r: [r, r * 2.5], opacity: [0.8, 0] }}
                      transition={{ duration: 2, repeat: Infinity }} />
                  )}
                  {!isUnlocked && (
                    <text x={n.x} y={n.y + 0.8} textAnchor="middle" fontSize="2.6" fill="oklch(0.38 0.025 270)" className="font-medium pointer-events-none select-none">
                      x
                    </text>
                  )}
                  {isCompleted && (
                    <text x={n.x} y={n.y + 0.8} textAnchor="middle" fontSize="2.4" fill="white" className="font-medium pointer-events-none select-none">
                      ok
                    </text>
                  )}
                  <text x={n.x} y={n.y + r + 2.4} textAnchor="middle" fontSize="2.1" fill="oklch(0.22 0.025 270)" className="font-medium pointer-events-none select-none">
                    {labelLines(n.label).map((line, lineIndex) => (
                      <tspan key={line} x={n.x} dy={lineIndex === 0 ? 0 : 2.6}>{line}</tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </svg>
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
              <div><span className="text-foreground font-medium">Required prerequisites:</span> {prerequisiteLabels.join(" - ") || "None"}</div>
              <div><span className="text-foreground font-medium">Unlocks:</span> {unlockLabels.join(" - ") || "-"}</div>
              <div><span className="text-foreground font-medium">Status:</span> {selectedLocked ? "Locked" : completedIds.has(sel.id) ? "Completed" : "Unlocked"}</div>
            </div>
            <MathText as="p" className="mt-4 rounded-2xl bg-muted/35 p-4 text-sm leading-7 text-foreground/80" text={sel.item.content} />
            <button
              type="button"
              onClick={() => openRoadmap(sel)}
              disabled={selectedLocked}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-foreground text-background text-sm py-2.5 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {selectedLocked && <Lock className="size-4" />}
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

function buildNodes(items: CurriculumItem[], mastery: Record<string, number>, learnerId?: string): Node[] {
  const positions = layoutPositions(items.length);

  return items.map((item, index) => {
    const position = positions[index] ?? { x: 50, y: 50 };
    const label = humanize(item.concept);
    const backendMastery = relatedCurriculumMastery(item, mastery);
    const roadmapMastery = localRoadmapMastery(learnerId, item, label);
    return {
      id: item.id,
      x: position.x,
      y: position.y,
      label,
      mastery: Math.max(backendMastery, roadmapMastery),
      group: item.topic,
      item,
    };
  });
}

function relatedCurriculumMastery(item: CurriculumItem, mastery: Record<string, number>) {
  const concept = normalizeTopic(item.concept);
  const id = normalizeTopic(item.id);
  const aliases = concept.includes("vector")
    ? ["vector", "magnitude", "direction", "component", "scalar", "position"]
    : concept.includes("matri")
      ? ["matrix", "matrices", "matrix_multiplication", "matrix_addition"]
      : concept.includes("projection")
        ? ["projection", "orthogonal"]
        : concept.includes("eigen") || concept.includes("diagonal")
          ? ["eigenvalue", "eigenvector", "diagonal"]
          : [concept, id];
  const values = Object.entries(mastery)
    .filter(([key]) => {
      const normalized = normalizeTopic(key);
      return normalized === concept || normalized === id || aliases.some((alias) => normalized.includes(alias));
    })
    .map(([, value]) => clamp01(Number(value)))
    .filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function localRoadmapMastery(learnerId: string | undefined, item: CurriculumItem, label: string) {
  const completed = Math.max(
    getCompletedRoadmapLessonCount(learnerId, label),
    getCompletedRoadmapLessonCount(learnerId, item.concept),
    getCompletedRoadmapLessonCount(learnerId, item.id),
  );
  return clamp01(completed / ROADMAP_MASTERY_TARGET_LESSONS);
}

function normalizedMasteryMap(mastery: Record<string, number>) {
  const normalized = new Map<string, number>();
  Object.entries(mastery).forEach(([key, value]) => {
    const score = Number(value);
    if (!Number.isFinite(score)) return;
    normalized.set(normalizeTopic(key), Math.max(normalized.get(normalizeTopic(key)) ?? 0, clamp01(score)));
  });
  return normalized;
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

function labelLines(label: string) {
  const words = label.split(" ");
  if (label.length <= 16 || words.length === 1) return [label];
  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" ")].filter(Boolean);
}

function filterItemsForSelectedTopic(items: CurriculumItem[], selectedTopic?: string): CurriculumItem[] {
  const normalizedSelected = canonicalTrackTopic(selectedTopic);
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

function buildSuggestions(nodes: Node[], edges: [string, string][], unlockedIds: Set<string>, completedIds: Set<string>): Node[] {
  const directUnlockIds = new Set(
    edges
      .filter(([from, to]) => completedIds.has(from) && unlockedIds.has(to) && !completedIds.has(to))
      .map(([, to]) => to),
  );
  const directUnlocks = [...directUnlockIds]
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is Node => Boolean(node));
  const lowMastery = nodes
    .filter((node) => unlockedIds.has(node.id) && !completedIds.has(node.id) && !directUnlockIds.has(node.id))
    .sort((a, b) => a.mastery - b.mastery);

  return [...directUnlocks, ...lowMastery].slice(0, 3);
}

function unlockedNodeIds(nodes: Node[], edges: [string, string][]): Set<string> {
  const completedIds = completedNodeIds(nodes);
  return new Set(nodes.filter((node) => prerequisitesMet(node.id, edges, completedIds)).map((node) => node.id));
}

function completedNodeIds(nodes: Node[]): Set<string> {
  return new Set(nodes.filter((node) => node.mastery >= MASTERY_COMPLETE).map((node) => node.id));
}

function prerequisitesMet(nodeId: string, edges: [string, string][], completedIds: Set<string>) {
  const prerequisites = edges.filter(([, to]) => to === nodeId).map(([from]) => from);
  return prerequisites.length === 0 || prerequisites.every((id) => completedIds.has(id));
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

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function canonicalTrackTopic(value?: string) {
  const normalized = normalizeTopic(value);
  if (["linear_algebra", "linear_algebra_foundations", "vectors_matrices_norms_projections_eigenvalues_diagonalisation"].includes(normalized)) {
    return "linear_algebra";
  }
  if (["calculus", "limits_derivatives_gradients_multivariate_calculus_hessians"].includes(normalized)) {
    return "calculus";
  }
  return normalized;
}

const PREREQUISITE_EDGES: Record<string, [string, string][]> = {
  linear_algebra: [
    ["la_vectors", "la_matrices"],
    ["la_vectors", "la_norms"],
    ["la_norms", "la_projections"],
    ["la_matrices", "la_eigen"],
    ["la_projections", "la_eigen"],
    ["la_eigen", "la_diagonalisation"],
  ],
  calculus: [
    ["calc_limits", "calc_derivatives"],
    ["calc_derivatives", "calc_gradients"],
    ["calc_gradients", "calc_multivariable"],
    ["calc_multivariable", "calc_hessians"],
    ["calc_gradients", "calc_hessians"],
  ],
};

const REQUIRED_PREREQUISITES: Record<string, string[]> = {
  la_vectors: ["Coordinate systems", "Basic algebra", "Number lines"],
  la_matrices: ["Vectors", "Systems of equations", "Arithmetic operations"],
  la_norms: ["Vectors", "Squares and square roots", "Distance formula"],
  la_projections: ["Vectors", "Dot products", "Basic trigonometry"],
  la_eigen: ["Vectors", "Matrices", "Solving equations"],
  la_diagonalisation: ["Eigenvalues", "Eigenvectors", "Matrix multiplication"],
  calc_limits: ["Functions", "Graphs", "Basic algebra"],
  calc_derivatives: ["Limits", "Functions", "Slope of a line"],
  calc_gradients: ["Derivatives", "Partial derivatives", "Multivariable functions"],
  calc_multivariable: ["Derivatives", "Functions of several variables", "3D graphs"],
  calc_hessians: ["Gradients", "Second derivatives", "Matrices"],
};

const MASTERY_COMPLETE = 0.8;
const ROADMAP_MASTERY_TARGET_LESSONS = 8;

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

