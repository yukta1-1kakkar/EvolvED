import { createFileRoute } from "@tanstack/react-router";
import {
  BookMarked,
  CheckCircle2,
  Hammer,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useLesson, useTutorInteraction } from "@/hooks/useLesson";
import type { ApiJson, ApiRecord } from "@/types/api";

export const Route = createFileRoute("/lesson")({
  head: () => ({
    meta: [
      { title: "Lesson - EvolvED" },
      { name: "description", content: "An adaptive, project-aware lesson composed in real time by EvolvED." },
    ],
  }),
  component: LessonPage,
});

type LessonBrief = {
  topic: string;
  project_context: string;
};

function LessonPage() {
  const { currentUser } = useAuth();
  const initialTopic = currentUser?.learningTopic ?? "";
  const initialProject = currentUser?.learningProject ?? defaultProject(initialTopic);
  const [draft, setDraft] = useState<LessonBrief>({ topic: initialTopic, project_context: initialProject });
  const [brief, setBrief] = useState<LessonBrief>({ topic: initialTopic, project_context: initialProject });
  const lesson = useLesson({
    learner_id: currentUser?.id ?? "",
    ...brief,
  });
  const tutor = useTutorInteraction();
  const [question, setQuestion] = useState("");

  function regenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const topic = draft.topic.trim();
    const project_context = draft.project_context.trim();
    if (!topic || !project_context) return;
    setBrief({ topic, project_context });
    if (topic === brief.topic && project_context === brief.project_context) void lesson.refetch();
  }

  function askTutor(action = "question") {
    if (!currentUser || !lesson.data || !question.trim()) return;
    tutor.mutate({
      learner_id: currentUser.id,
      session_id: lesson.data.lesson_id,
      question: question.trim(),
      action,
    });
  }

  return (
    <AppShell
      title={lesson.data?.topic || brief.topic || "Create your lesson"}
      subtitle="A focused lesson that teaches the topic through the project you want to build."
      accent={lesson.isFetching ? "Composing" : "Lesson ready"}
    >
      <LessonBriefForm draft={draft} onChange={setDraft} onSubmit={regenerate} loading={lesson.isFetching} />

      {lesson.isLoading && <LessonSkeleton />}
      {lesson.isError && <ErrorPanel message={lesson.error.message} onRetry={() => void lesson.refetch()} />}
      {lesson.data && (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <article className="space-y-5">
            <section className="overflow-hidden rounded-3xl border border-border bg-card">
              <div className="bg-foreground px-6 py-5 text-background">
                <div className="text-[10px] uppercase tracking-[0.24em] text-background/65">Your lesson</div>
                <h2 className="mt-2 max-w-3xl font-display text-3xl">{lesson.data.learning_objective}</h2>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-background/75">{lesson.data.lesson_summary}</p>
              </div>
              <div className="grid gap-4 px-6 py-5 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    <Hammer className="size-3.5 text-plum" /> Applied project
                  </div>
                  <p className="mt-2 text-sm font-medium">{lesson.data.project_context}</p>
                </div>
                <div className="text-xs text-muted-foreground">
                  {lesson.data.estimated_lesson_duration || "Adaptive"} min
                </div>
              </div>
            </section>

            {lesson.data.lesson_structure.map((section, index) => (
              <LessonSection key={recordKey(section, index)} section={section} index={index} />
            ))}
          </article>

          <aside className="space-y-4 xl:sticky xl:top-20 xl:h-fit">
            <div className="rounded-3xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <Sparkles className="size-3.5 text-plum" /> AI tutor
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Ask about this lesson. Your questions become part of your learner memory.</p>
              {tutor.data && <div className="mt-4 rounded-2xl bg-muted/35 p-4 text-sm leading-relaxed">{tutor.data.answer}</div>}
              {tutor.isError && <p className="mt-3 text-sm text-destructive">{tutor.error.message}</p>}
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask for a hint or a simpler explanation" className="mt-4 min-h-24 w-full rounded-2xl border border-input bg-background p-3 text-sm outline-none focus:border-plum" />
              <div className="mt-3 flex flex-wrap gap-2">
                {["question", "simpler_explanation", "example", "hint"].map((action) => (
                  <button key={action} type="button" onClick={() => askTutor(action)} disabled={tutor.isPending || !question.trim()} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50">
                    {humanize(action)}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-3xl border border-border bg-card p-5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Lesson path</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {lesson.data.modality_sequence.map((modality, index) => (
                  <span key={`${modality}-${index}`} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                    {humanize(modality)}
                  </span>
                ))}
              </div>
            </div>
            <AgentList icon={MessageCircle} title="Try as you learn" empty="No practice prompts returned." items={lesson.data.interaction_points} />
            <AgentList icon={Target} title="Check your understanding" empty="No checkpoints returned." items={lesson.data.assessment_points} />
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function LessonBriefForm({
  draft,
  onChange,
  onSubmit,
  loading,
}: {
  draft: LessonBrief;
  onChange: (brief: LessonBrief) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="mb-7 rounded-3xl border border-plum/20 bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-plum">
            <Sparkles className="size-3.5" /> Lesson studio
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Choose what to learn and the project that should make it useful.</p>
        </div>
        <button
          type="submit"
          disabled={loading || !draft.topic.trim() || !draft.project_context.trim()}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Generating lesson" : "Generate lesson"}
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-medium text-muted-foreground">
          Topic to learn
          <Input
            className="mt-2"
            value={draft.topic}
            onChange={(event) => onChange({ ...draft, topic: event.target.value })}
            placeholder="e.g. Derivatives"
          />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Project to build toward
          <Input
            className="mt-2"
            value={draft.project_context}
            onChange={(event) => onChange({ ...draft, project_context: event.target.value })}
            placeholder="e.g. Tune the braking curve for a delivery robot"
          />
        </label>
      </div>
    </form>
  );
}

function LessonSection({ section, index }: { section: ApiRecord; index: number }) {
  const explanation = stringValue(section.explanation) || stringValue(section.content);
  const example = stringValue(section.example);
  const projectConnection = stringValue(section.project_connection);
  const checkpoint = stringValue(section.checkpoint);

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        <BookMarked className="size-3" /> Lesson part {index + 1}
      </div>
      <h3 className="mt-3 font-display text-2xl">{recordTitle(section, index)}</h3>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground/80">{explanation}</p>
      {example && <Detail label="Example" text={example} />}
      {projectConnection && <Detail label="Use it in your project" text={projectConnection} accent />}
      {checkpoint && (
        <div className="mt-4 flex gap-3 rounded-2xl bg-muted/40 p-4 text-sm leading-relaxed">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-plum" />
          <div><span className="font-medium">Quick check:</span> {checkpoint}</div>
        </div>
      )}
    </section>
  );
}

function Detail({ label, text, accent = false }: { label: string; text: string; accent?: boolean }) {
  return (
    <div className={`mt-4 rounded-2xl border p-4 text-sm leading-relaxed ${accent ? "border-plum/20 bg-plum/[0.04]" : "border-border bg-muted/20"}`}>
      <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      {text}
    </div>
  );
}

function AgentList({ icon: Icon, title, empty, items }: { icon: React.ElementType; title: string; empty: string; items: ApiRecord[] }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <Icon className="size-3.5 text-plum" /> {title}
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item, index) => (
          <div key={recordKey(item, index)} className="rounded-2xl bg-muted/35 p-4 text-sm leading-relaxed">
            {stringValue(item.prompt) || recordBody(item)}
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">{empty}</p>}
      </div>
    </div>
  );
}

function LessonSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="size-4 text-plum" /> Composing explanations, examples, and project checkpoints.
      </div>
      <Skeleton className="h-56 rounded-3xl" />
      <Skeleton className="h-72 rounded-3xl" />
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-3xl border border-rose/30 bg-rose/5 p-6">
      <div className="font-medium">Lesson generation failed</div>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <button onClick={onRetry} className="mt-4 rounded-full bg-foreground px-4 py-2 text-sm text-background">Retry generation</button>
    </div>
  );
}

function recordKey(record: ApiRecord, index: number) {
  const id = record.id ?? record.step ?? record.segment_id ?? record.interaction_id ?? record.assessment_id;
  return typeof id === "string" || typeof id === "number" ? String(id) : `record-${index}`;
}

function recordTitle(record: ApiRecord, index: number) {
  for (const key of ["title", "segment_title", "heading", "name", "activity", "concept"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return `Lesson part ${index + 1}`;
}

function recordBody(record: ApiRecord) {
  const omitted = new Set(["id", "step", "segment_id", "title", "segment_title", "heading", "name", "type"]);
  return Object.entries(record)
    .filter(([key]) => !omitted.has(key))
    .map(([key, value]) => `${humanize(key)}: ${valueToText(value)}`)
    .join("\n");
}

function stringValue(value: ApiJson | undefined) {
  return typeof value === "string" ? value : "";
}

function valueToText(value: ApiJson): string {
  if (value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(valueToText).join(", ");
  return Object.entries(value).map(([key, item]) => `${humanize(key)}: ${valueToText(item)}`).join(", ");
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function defaultProject(topic: string) {
  return topic ? `Build a practical ${topic} mini project` : "";
}
