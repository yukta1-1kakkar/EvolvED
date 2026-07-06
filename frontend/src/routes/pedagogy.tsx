import { createFileRoute } from "@tanstack/react-router";
import { Compass, Gauge, Layers, MessageCircle } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useTeachingStrategy } from "@/hooks/useLesson";
import { getActiveRoadmapTopic, getCompletedRoadmapLessonCount } from "@/lib/lesson-progress";

export const Route = createFileRoute("/pedagogy")({
  component: () => (
    <ProtectedRoute>
      <PedagogyPage />
    </ProtectedRoute>
  ),
});

function PedagogyPage() {
  const { currentUser } = useAuth();
  const topic = getActiveRoadmapTopic(currentUser?.id) || currentUser?.learningTopic || "";
  const completedLessons = getCompletedRoadmapLessonCount(currentUser?.id, topic);
  const strategy = useTeachingStrategy({
    learner_id: currentUser?.id ?? "",
    topic,
    constraints: {
      completed_lessons: completedLessons,
      profile_learning_style: currentUser?.preferredModality || "",
      profile_pace: currentUser?.pacePreference || "",
      profile_familiarity: currentUser?.topicFamiliarity || "",
      accessibility_support: Boolean(currentUser?.accessibilitySupport),
    },
  });

  return (
    <AppShell title="Teaching strategy" subtitle={`Generated from your live learner model${topic ? ` for ${topic}` : ""}.`} accent={strategy.isFetching ? "Reasoning" : "Live strategy"}>
      {strategy.isLoading && <Skeleton className="h-72 rounded-3xl" />}
      {strategy.isError && (
        <div className="rounded-3xl border border-rose/30 bg-rose/5 p-6">
          <div className="font-medium">Strategy generation failed</div>
          <p className="mt-2 text-sm text-muted-foreground">{strategy.error.message}</p>
          <button onClick={() => void strategy.refetch()} className="mt-4 rounded-full bg-foreground px-4 py-2 text-sm text-background">Retry generation</button>
        </div>
      )}
      {strategy.data && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Tile icon={Compass} label="Approach" value={compactStrategyValue(strategy.data.strategy_type, "approach")} />
          <Tile icon={Gauge} label="Pacing" value={compactStrategyValue(strategy.data.pacing_strategy, "pacing")} />
          <Tile icon={Layers} label="Difficulty" value={compactStrategyValue(strategy.data.difficulty_level, "difficulty")} />
          <Tile icon={MessageCircle} label="Interaction density" value={compactStrategyValue(strategy.data.interaction_density, "interaction")} />
          <div className="rounded-3xl border border-border bg-card p-6 md:col-span-2 xl:col-span-4">
            <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Recommended modalities</div>
            <div className="mt-4 flex flex-wrap gap-2">
              {strategy.data.recommended_modalities.map((modality) => (
                <span key={modality} className="rounded-full border border-border px-3 py-1.5 text-sm">{compactModality(modality)}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Tile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <Icon className="size-4 text-plum" />
      <div className="mt-4 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl">{humanize(value)}</div>
    </div>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactStrategyValue(value: string | null | undefined, kind: "approach" | "pacing" | "difficulty" | "interaction") {
  const text = String(value || "").toLowerCase();
  const maps = {
    approach: [
      ["remed", "Remedial"],
      ["scaffold", "Scaffolded"],
      ["challenge", "Challenging"],
      ["analogy", "Analogical"],
      ["adaptive", "Adaptive"],
    ],
    pacing: [
      ["slow", "Slow"],
      ["gentle", "Slow"],
      ["fast", "Fast"],
      ["acceler", "Fast"],
      ["balanced", "Balanced"],
      ["moderate", "Balanced"],
    ],
    difficulty: [
      ["beginner", "Beginner"],
      ["remed", "Beginner"],
      ["intermediate", "Intermediate"],
      ["advanced", "Advanced"],
    ],
    interaction: [
      ["high", "High"],
      ["dense", "High"],
      ["medium", "Medium"],
      ["moderate", "Medium"],
      ["low", "Low"],
    ],
  }[kind];
  return maps.find(([needle]) => text.includes(needle))?.[1] ?? "Adaptive";
}

function compactModality(value: string) {
  const text = value.toLowerCase();
  if (text.includes("visual") || text.includes("diagram")) return "Visual";
  if (text.includes("audio") || text.includes("listen")) return "Audio";
  if (text.includes("symbol")) return "Symbolic";
  if (text.includes("interact") || text.includes("practice")) return "Interactive";
  if (text.includes("written") || text.includes("read")) return "Written";
  return humanize(value).split(/\s+/)[0] || "Adaptive";
}
