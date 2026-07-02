import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import {
  LESSON_CONTEXT_STORAGE_KEY,
  LessonExperience,
  type LessonLaunchContext,
} from "@/routes/lesson";

export const Route = createFileRoute("/lesson-view")({
  head: () => ({
    meta: [
      { title: "Lesson View - EvolvED" },
      { name: "description", content: "A focused generated lesson view for the selected roadmap stage." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <LessonViewPage />
    </ProtectedRoute>
  ),
});

function LessonViewPage() {
  const navigate = useNavigate();
  const [context, setContext] = useState<LessonLaunchContext | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(LESSON_CONTEXT_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as LessonLaunchContext;
        if (parsed?.brief?.topic && parsed?.selectedLesson?.title) {
          setContext(parsed);
        }
      } catch (error) {
        console.error("Stored lesson context is invalid", error);
      }
    }
    setLoaded(true);
  }, []);

  return (
    <AppShell
      title={context?.selectedLesson.title || "Lesson"}
      subtitle={context ? "Generated from your selected roadmap stage." : "Select a roadmap lesson first."}
      accent={context ? "Composing" : "Missing selection"}
    >
      <button
        type="button"
        onClick={() => void navigate({ to: "/lesson" })}
        className="mb-5 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Roadmap
      </button>

      {context ? (
        <LessonExperience brief={context.brief} selectedLesson={context.selectedLesson} lessonIndex={context.lessonIndex} />
      ) : loaded ? (
        <div className="rounded-3xl border border-border bg-card p-6">
          <div className="font-medium">No roadmap lesson selected</div>
          <p className="mt-2 text-sm text-muted-foreground">Go back to the roadmap and choose a lesson to generate.</p>
        </div>
      ) : null}
    </AppShell>
  );
}
