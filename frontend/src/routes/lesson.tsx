import { createFileRoute } from "@tanstack/react-router";
import {
  BookMarked,
  CheckCircle2,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useState, type ElementType, type FormEvent, type SelectHTMLAttributes } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useLesson, useRoadmap, useTutorInteraction } from "@/hooks/useLesson";
import type { ApiJson, ApiRecord, LessonRoadmapItem } from "@/types/api";

export const Route = createFileRoute("/lesson")({
  head: () => ({
    meta: [
      { title: "Lesson - EvolvED" },
      { name: "description", content: "An adaptive lesson roadmap and concept-first lesson composed in real time by EvolvED." },
    ],
  }),
  component: LessonPage,
});

type LessonBrief = {
  topic: string;
  education_level: string;
  familiarity_level: string;
  pace: string;
  learning_style: string;
  availability: string;
  accessibility_support: boolean;
};

function LessonPage() {
  const { currentUser } = useAuth();
  const initialTopic = currentUser?.learningTopic ?? "";
  const initialBrief = makeInitialBrief(initialTopic);
  const [draft, setDraft] = useState<LessonBrief>(initialBrief);
  const [brief, setBrief] = useState<LessonBrief>(initialBrief);
  const [selectedLesson, setSelectedLesson] = useState<LessonRoadmapItem | null>(null);
  const constraints = constraintsFromBrief(brief);
  const roadmap = useRoadmap({
    learner_id: currentUser?.id ?? "",
    topic: brief.topic,
    constraints,
  });
  const lesson = useLesson({
    learner_id: currentUser?.id ?? "",
    topic: brief.topic,
    selected_lesson: selectedLesson ? roadmapItemToRecord(selectedLesson) : undefined,
    constraints,
  });
  const tutor = useTutorInteraction();
  const [question, setQuestion] = useState("");

  function regenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const topic = draft.topic.trim();
    if (!topic) return;
    const nextBrief = { ...draft, topic };
    setBrief(nextBrief);
    setSelectedLesson(null);
    if (JSON.stringify(nextBrief) === JSON.stringify(brief)) void roadmap.refetch();
  }

  function chooseLesson(item: LessonRoadmapItem) {
    setSelectedLesson(item);
    if (selectedLesson?.id === item.id) void lesson.refetch();
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

  useEffect(() => {
    if (!lesson.data || typeof window === "undefined") return;
    window.localStorage.setItem("evolved.currentLessonSession", lesson.data.lesson_id);
  }, [lesson.data]);

  return (
    <AppShell
      title={lesson.data?.topic || brief.topic || "Create your lesson"}
      subtitle="Choose a topic and preferences, then pick a roadmap lesson to generate content."
      accent={lesson.isFetching ? "Composing" : roadmap.isFetching ? "Planning" : "Lesson ready"}
    >
      <LessonBriefForm draft={draft} onChange={setDraft} onSubmit={regenerate} loading={roadmap.isFetching} />

      {roadmap.isLoading && <RoadmapSkeleton />}
      {roadmap.isError && <ErrorPanel title="Roadmap generation failed" message={roadmap.error.message} onRetry={() => void roadmap.refetch()} />}
      {roadmap.data && (
        <RoadmapCards
          lessons={roadmap.data.lessons}
          selectedId={selectedLesson?.id}
          onSelect={chooseLesson}
          loading={lesson.isFetching}
        />
      )}

      {lesson.isLoading && selectedLesson && <LessonSkeleton />}
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
                    <Target className="size-3.5 text-plum" /> Selected lesson
                  </div>
                  <p className="mt-2 text-sm font-medium">{selectedLessonTitle(lesson.data.selected_lesson) || selectedLesson?.title || lesson.data.topic}</p>
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
          <p className="mt-2 text-sm text-muted-foreground">Choose what to learn and how you want the roadmap adapted.</p>
        </div>
        <button
          type="submit"
          disabled={loading || !draft.topic.trim()}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm text-background transition-opacity disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Generating roadmap" : "Generate roadmap"}
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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
          Education level
          <Select value={draft.education_level} onChange={(event) => onChange({ ...draft, education_level: event.target.value })}>
            <option>School</option>
            <option>Undergraduate</option>
            <option>Postgraduate</option>
            <option>Professional / Independent Learner</option>
          </Select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Current familiarity
          <Select value={draft.familiarity_level} onChange={(event) => onChange({ ...draft, familiarity_level: event.target.value })}>
            <option>Beginner</option>
            <option>Intermediate</option>
            <option>Advanced</option>
          </Select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Preferred pace
          <Select value={draft.pace} onChange={(event) => onChange({ ...draft, pace: event.target.value })}>
            <option>Gentle and Thorough</option>
            <option>Balanced</option>
            <option>Fast and Challenging</option>
          </Select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Learning style
          <Select value={draft.learning_style} onChange={(event) => onChange({ ...draft, learning_style: event.target.value })}>
            <option>Visual Examples and Diagrams</option>
            <option>Practice First Learning</option>
            <option>Detailed Written Explanations</option>
            <option>Balanced Mix</option>
          </Select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Learning availability
          <Select value={draft.availability} onChange={(event) => onChange({ ...draft, availability: event.target.value })}>
            <option>30 min/day</option>
            <option>1 hr/day</option>
            <option>2 hr/day</option>
          </Select>
        </label>
      </div>
      <label className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.accessibility_support}
          onChange={(event) => onChange({ ...draft, accessibility_support: event.target.checked })}
          className="size-4 accent-plum"
        />
        Accessibility support
      </label>
    </form>
  );
}

function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="mt-2 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm" {...props} />;
}

function RoadmapCards({
  lessons,
  selectedId,
  onSelect,
  loading,
}: {
  lessons: LessonRoadmapItem[];
  selectedId?: string;
  onSelect: (item: LessonRoadmapItem) => void;
  loading: boolean;
}) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Personalized roadmap</div>
        {loading && <div className="text-xs text-muted-foreground">Generating selected lesson...</div>}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {lessons.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className={`min-h-44 rounded-2xl border p-4 text-left transition ${selectedId === item.id ? "border-plum bg-plum/[0.06]" : "border-border bg-card hover:border-plum/50"}`}
          >
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>{item.difficulty}</span>
              <span>{item.estimated_duration} min</span>
            </div>
            <h3 className="mt-3 font-display text-xl">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function LessonSection({ section, index }: { section: ApiRecord; index: number }) {
  const explanation = stringValue(section.explanation) || stringValue(section.content);
  const example = stringValue(section.example);
  const conceptConnection = stringValue(section.concept_connection) || stringValue(section.project_connection);
  const checkpoint = stringValue(section.checkpoint);

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        <BookMarked className="size-3" /> Lesson part {index + 1}
      </div>
      <h3 className="mt-3 font-display text-2xl">{recordTitle(section, index)}</h3>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground/80">{explanation}</p>
      {example && <Detail label="Example" text={example} />}
      {conceptConnection && <Detail label="Concept connection" text={conceptConnection} accent />}
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

function AgentList({ icon: Icon, title, empty, items }: { icon: ElementType; title: string; empty: string; items: ApiRecord[] }) {
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
        <Sparkles className="size-4 text-plum" /> Composing explanations, examples, and checkpoints.
      </div>
      <Skeleton className="h-56 rounded-3xl" />
      <Skeleton className="h-72 rounded-3xl" />
    </div>
  );
}

function RoadmapSkeleton() {
  return (
    <div className="mb-7 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
    </div>
  );
}

function ErrorPanel({ title = "Lesson generation failed", message, onRetry }: { title?: string; message: string; onRetry: () => void }) {
  return (
    <div className="rounded-3xl border border-rose/30 bg-rose/5 p-6">
      <div className="font-medium">{title}</div>
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

function makeInitialBrief(topic: string): LessonBrief {
  return {
    topic,
    education_level: "Undergraduate",
    familiarity_level: "Beginner",
    pace: "Balanced",
    learning_style: "Balanced Mix",
    availability: "30 min/day",
    accessibility_support: false,
  };
}

function constraintsFromBrief(brief: LessonBrief): ApiRecord {
  return {
    education_level: brief.education_level,
    familiarity_level: brief.familiarity_level,
    pace: brief.pace,
    learning_style: brief.learning_style,
    availability: brief.availability,
    accessibility: { additional_support: brief.accessibility_support },
  };
}

function roadmapItemToRecord(item: LessonRoadmapItem): ApiRecord {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    difficulty: item.difficulty,
    estimated_duration: item.estimated_duration,
    objectives: item.objectives,
  };
}

function selectedLessonTitle(value: ApiRecord | null | undefined) {
  return typeof value?.title === "string" ? value.title : "";
}
