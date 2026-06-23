import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BookMarked,
  CheckCircle2,
  GitBranch,
  ListChecks,
  MessageCircle,
  Network,
  Play,
  RefreshCw,
  Sparkles,
  Target,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState, type ElementType, type FormEvent, type SelectHTMLAttributes } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useLesson, useRoadmap, useTutorInteraction } from "@/hooks/useLesson";
import { synthesizeLessonAudio } from "@/lib/api";
import type { ApiJson, ApiRecord, LessonBlueprint, LessonRoadmapItem } from "@/types/api";

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
  const initialBrief = makeInitialBrief(currentUser);
  const [draft, setDraft] = useState<LessonBrief>(initialBrief);
  const [brief, setBrief] = useState<LessonBrief>(initialBrief);
  const [selectedLesson, setSelectedLesson] = useState<LessonRoadmapItem | null>(null);
  const roadmapConstraints = constraintsFromBrief(brief);
  const lessonConstraints = constraintsFromBrief({
    ...brief,
    education_level: draft.education_level,
    familiarity_level: draft.familiarity_level,
    pace: draft.pace,
    learning_style: draft.learning_style,
    availability: draft.availability,
    accessibility_support: draft.accessibility_support,
  });
  const roadmap = useRoadmap({
    learner_id: currentUser?.id ?? "",
    topic: brief.topic,
    constraints: roadmapConstraints,
  });
  const lesson = useLesson({
    learner_id: currentUser?.id ?? "",
    topic: brief.topic,
    selected_lesson: selectedLesson ? roadmapItemToRecord(selectedLesson) : undefined,
    constraints: lessonConstraints,
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

  useEffect(() => {
    const nextBrief = makeInitialBrief(currentUser);
    setDraft(nextBrief);
    setBrief(nextBrief);
    setSelectedLesson(null);
  }, [
    currentUser?.id,
    currentUser?.learningTopic,
    currentUser?.educationLevel,
    currentUser?.topicFamiliarity,
    currentUser?.pacePreference,
    currentUser?.preferredModality,
    currentUser?.learningAvailability,
    currentUser?.accessibilitySupport,
  ]);

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
          generationSource={roadmap.data.generation_source}
          generationModel={roadmap.data.generation_model}
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
                {lesson.data.learning_style && (
                  <div className="mt-3 inline-flex rounded-full border border-background/30 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-background/80">
                    {lesson.data.learning_style}
                  </div>
                )}
                <div className="mt-3">
                  <SourceBadge source={lesson.data.generation_source} model={lesson.data.generation_model} inverse />
                </div>
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

            <AdaptiveLessonPayload lesson={lesson.data} />

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
            <option>Audio Learning</option>
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

function AdaptiveLessonPayload({ lesson }: { lesson: LessonBlueprint }) {
  const hasAudio = Boolean(lesson.audioNarration || lesson.ttsContent || lesson.audioSections?.length);
  const mediaCandidates = [
    ...(lesson.visualElements ?? []),
    ...(lesson.graphData ?? []),
    ...(lesson.diagramDescriptions ?? []),
  ];
  const videos = mediaCandidates.filter((item) => item.type === "video" && isValidMediaUrl(stringValue(item.videoUrl), "video"));
  const audioAssets = mediaCandidates.filter((item) => item.type === "audio" && isValidMediaUrl(stringValue(item.audioUrl), "audio"));
  const visualCandidates = mediaCandidates.filter((item) => item.type !== "video" && item.type !== "audio");
  const visuals = Array.from(
    new Map(
      visualCandidates.map((item, index) => [
        stringValue(item.id) || stringValue(item.imageUrl) || `${recordTitle(item, index)}-${index}`,
        item,
      ]),
    ).values(),
  );
  const hasVisuals = visuals.length > 0 || Boolean(lesson.conceptMaps?.length || lesson.flowDiagrams?.length);
  const practiceItems = [...(lesson.practiceExercises ?? []), ...(lesson.interactiveQuestions ?? [])];

  return (
    <div className="space-y-5">
      {videos.map((video, index) => <VideoLesson key={recordKey(video, index)} video={video} index={index} />)}
      {hasAudio && (
        <AudioLesson
          narration={lesson.ttsContent || lesson.audioNarration || ""}
          sections={lesson.audioSections ?? []}
          audioAsset={audioAssets[0]}
        />
      )}
      {hasVisuals && (
        <VisualLesson
          visualElements={visuals}
          conceptMaps={lesson.conceptMaps ?? []}
          flowDiagrams={lesson.flowDiagrams ?? []}
        />
      )}
      {practiceItems.length > 0 && <PracticeLesson items={practiceItems} />}
    </div>
  );
}

function AudioLesson({ narration, sections, audioAsset }: { narration: string; sections: ApiRecord[]; audioAsset?: ApiRecord }) {
  const storedAudioUrl = resolveMediaUrl(stringValue(audioAsset?.audioUrl));
  const [audioUrl, setAudioUrl] = useState(storedAudioUrl);
  const [status, setStatus] = useState(storedAudioUrl ? "Narration ready" : narration ? "Preparing narration..." : "Narration script ready");
  const [useBrowserNarration, setUseBrowserNarration] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!narration || storedAudioUrl) return;
    let cancelled = false;
    let objectUrl = "";

    synthesizeLessonAudio(narration)
      .then((blob) => {
        if (cancelled) return;
        if (!blob.size || !["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"].includes(blob.type)) {
          throw new Error(`Invalid lesson audio response: type=${blob.type || "unknown"} size=${blob.size}`);
        }
        objectUrl = URL.createObjectURL(blob);
        setAudioUrl(objectUrl);
        setStatus("Narration ready");
      })
      .catch((error) => {
        console.error("Lesson audio generation/playback failed", error);
        const browserSpeechAvailable = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
        setUseBrowserNarration(browserSpeechAvailable);
        setStatus(browserSpeechAvailable ? "Browser narration ready" : "Narration script ready");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [narration, storedAudioUrl]);

  function playBrowserNarration() {
    if (!narration || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(narration);
    utterance.onstart = () => {
      console.info("Lesson browser narration playback started", { characters: narration.length });
      setSpeaking(true);
      setStatus("Playing narration");
    };
    utterance.onend = () => {
      console.info("Lesson browser narration playback completed");
      setSpeaking(false);
      setStatus("Browser narration ready");
    };
    utterance.onerror = (event) => {
      console.error("Lesson browser narration playback failed", event);
      setSpeaking(false);
      setStatus("Narration script ready");
    };
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        <Volume2 className="size-3.5 text-plum" /> Audio lesson
      </div>
      <div className="mt-4 rounded-2xl bg-muted/35 p-4">
        {audioUrl ? (
          <audio
            ref={audioRef}
            controls
            src={audioUrl}
            className="w-full"
            preload="metadata"
            onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
            onCanPlay={() => console.info("Lesson audio URL verified and ready", { audioUrl })}
            onPlay={() => console.info("Lesson audio playback started", { audioUrl })}
            onError={(event) => console.error("Lesson audio player failed", event.currentTarget.error)}
          />
        ) : useBrowserNarration ? (
          <button type="button" onClick={playBrowserNarration} disabled={speaking} className="flex items-center gap-2 text-sm text-muted-foreground disabled:opacity-60">
            <Play className="size-4 text-plum" /> {status}
          </button>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Play className="size-4 text-plum" /> {status}
          </div>
        )}
      </div>
      {audioUrl && (
        <label className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          Playback speed
          <select
            value={playbackRate}
            onChange={(event) => {
              const rate = Number(event.target.value);
              setPlaybackRate(rate);
              if (audioRef.current) audioRef.current.playbackRate = rate;
            }}
            className="rounded-lg border border-border bg-background px-2 py-1"
          >
            {[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
          </select>
        </label>
      )}
      {sections.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {sections.map((section, index) => (
            <div key={recordKey(section, index)} className="rounded-2xl border border-border p-4 text-sm leading-relaxed">
              <div className="font-medium">{recordTitle(section, index)}</div>
              <p className="mt-2 text-muted-foreground">{stringValue(section.script) || recordBody(section)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function VisualLesson({
  visualElements,
  conceptMaps,
  flowDiagrams,
}: {
  visualElements: ApiRecord[];
  conceptMaps: ApiRecord[];
  flowDiagrams: ApiRecord[];
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        <Network className="size-3.5 text-plum" /> Visual layer
      </div>
      {conceptMaps.map((map, index) => (
        <ConceptMap key={recordKey(map, index)} map={map} index={index} />
      ))}
      {flowDiagrams.map((flow, index) => (
        <FlowDiagram key={recordKey(flow, index)} flow={flow} index={index} />
      ))}
      {visualElements.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {visualElements.map((item, index) => (
            <div key={recordKey(item, index)} className="rounded-2xl border border-border bg-muted/20 p-4">
              <div className="text-sm font-medium">{recordTitle(item, index)}</div>
              {isValidMediaUrl(stringValue(item.imageUrl), "image") && (
                <img
                  src={stringValue(item.imageUrl)}
                  alt={stringValue(item.description) || recordTitle(item, index)}
                  className="mt-3 aspect-video w-full rounded-xl border border-border bg-background object-contain"
                  onError={(event) => {
                    console.error("Lesson visual failed to render", { title: recordTitle(item, index), url: event.currentTarget.src });
                    event.currentTarget.hidden = true;
                  }}
                />
              )}
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{stringValue(item.caption) || stringValue(item.description) || recordBody(item)}</p>
              {recordsFrom(item.items).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {recordsFrom(item.items).map((entry, itemIndex) => (
                    <span key={`${recordKey(item, index)}-${itemIndex}`} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                      {valueToText(entry)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ConceptMap({ map, index }: { map: ApiRecord; index: number }) {
  const nodes = recordArray(map.nodes);
  const edges = recordArray(map.edges);

  return (
    <div className="mt-4 rounded-2xl border border-plum/20 bg-plum/[0.04] p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Network className="size-4 text-plum" /> {recordTitle(map, index)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {nodes.map((node, nodeIndex) => (
          <span key={recordKey(node, nodeIndex)} className="rounded-xl border border-border bg-background px-3 py-2 text-sm">
            {stringValue(node.label) || recordTitle(node, nodeIndex)}
          </span>
        ))}
      </div>
      {edges.length > 0 && (
        <div className="mt-4 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          {edges.map((edge, edgeIndex) => (
            <div key={recordKey(edge, edgeIndex)} className="flex items-center gap-2">
              <span>{stringValue(edge.from)}</span>
              <ArrowRight className="size-3 text-plum" />
              <span>{stringValue(edge.to)}</span>
              {stringValue(edge.label) && <span className="text-foreground/70">({stringValue(edge.label)})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FlowDiagram({ flow, index }: { flow: ApiRecord; index: number }) {
  const steps = recordsFrom(flow.steps);

  return (
    <div className="mt-4 rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <GitBranch className="size-4 text-plum" /> {recordTitle(flow, index)}
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-4">
        {steps.map((step, stepIndex) => (
          <div key={`${recordKey(flow, index)}-${stepIndex}`} className="min-h-20 rounded-xl bg-muted/35 p-3 text-sm leading-relaxed">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Step {stepIndex + 1}</div>
            {valueToText(step)}
          </div>
        ))}
      </div>
    </div>
  );
}

function PracticeLesson({ items }: { items: ApiRecord[] }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        <ListChecks className="size-3.5 text-plum" /> Practice first
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map((item, index) => (
          <div key={recordKey(item, index)} className="rounded-2xl border border-border p-4 text-sm leading-relaxed">
            <div className="font-medium">{stringValue(item.prompt) || recordTitle(item, index)}</div>
            {stringValue(item.hint) && <p className="mt-2 text-muted-foreground">Hint: {stringValue(item.hint)}</p>}
            {stringValue(item.feedback) && <p className="mt-2 text-muted-foreground">Feedback: {stringValue(item.feedback)}</p>}
            {!stringValue(item.prompt) && !stringValue(item.hint) && !stringValue(item.feedback) && <p className="mt-2 text-muted-foreground">{recordBody(item)}</p>}
          </div>
        ))}
      </div>
    </section>
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
  generationSource,
  generationModel,
}: {
  lessons: LessonRoadmapItem[];
  selectedId?: string;
  onSelect: (item: LessonRoadmapItem) => void;
  loading: boolean;
  generationSource?: string;
  generationModel?: string | null;
}) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Personalized roadmap</div>
        <div className="flex items-center gap-2">
          <SourceBadge source={generationSource} model={generationModel} />
          {loading && <div className="text-xs text-muted-foreground">Generating selected lesson...</div>}
        </div>
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

function VideoLesson({ video, index }: { video: ApiRecord; index: number }) {
  const videoUrl = resolveMediaUrl(stringValue(video.videoUrl));
  const thumbnailUrl = resolveMediaUrl(stringValue(video.thumbnailUrl));
  const captionsUrl = resolveMediaUrl(stringValue(video.captionsUrl));
  const narration = stringValue(video.narration);
  const script = typeof video.videoScript === "object" && video.videoScript !== null && !Array.isArray(video.videoScript) ? video.videoScript : {};
  const scenes = recordArray(script.scenes);
  const lastNarratedScene = useRef(-1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceType = stringValue(video.contentType) || (videoUrl.endsWith(".mp4") ? "video/mp4" : "video/webm");

  useEffect(() => {
    const player = videoRef.current;
    if (!player || !videoUrl) return;
    console.info("Lesson video player initialization", { videoId: video.videoId, videoUrl, sourceType, canPlayType: player.canPlayType(sourceType) });
    player.load();
  }, [sourceType, video.videoId, videoUrl]);

  function narrateAt(currentTime: number) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const sceneIndex = scenes.length ? Math.min(Math.floor(currentTime / 4), scenes.length - 1) : 0;
    if (sceneIndex === lastNarratedScene.current) return;
    lastNarratedScene.current = sceneIndex;
    const sceneNarration = stringValue(scenes[sceneIndex]?.narration) || narration;
    if (!sceneNarration) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(sceneNarration);
    utterance.onerror = (event) => console.error("Lesson video narration failed", event);
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        <Play className="size-3.5 text-plum" /> Visual lesson video
      </div>
      <h3 className="mt-2 text-lg font-medium">{recordTitle(video, index)}</h3>
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        poster={isValidMediaUrl(stringValue(video.thumbnailUrl), "image") ? thumbnailUrl : undefined}
        className="mt-4 aspect-video w-full rounded-2xl border border-border bg-black"
        onLoadStart={() => console.info("Lesson video load started", { videoId: video.videoId, videoUrl, sourceType })}
        onLoadedMetadata={(event) => console.info("Video render request verified", { videoId: video.videoId, duration: event.currentTarget.duration, videoUrl })}
        onCanPlay={(event) => console.info("Lesson video can play", { videoId: video.videoId, duration: event.currentTarget.duration, readyState: event.currentTarget.readyState, networkState: event.currentTarget.networkState })}
        onPlaying={(event) => console.info("Lesson video playback active", { videoId: video.videoId, currentTime: event.currentTarget.currentTime })}
        onWaiting={(event) => console.warn("Lesson video waiting for data", { videoId: video.videoId, currentTime: event.currentTarget.currentTime, readyState: event.currentTarget.readyState })}
        onStalled={(event) => console.warn("Lesson video network stalled", { videoId: video.videoId, networkState: event.currentTarget.networkState })}
        onPlay={(event) => {
          console.info("Lesson video playback result: started", { videoId: video.videoId, videoUrl });
          lastNarratedScene.current = -1;
          narrateAt(event.currentTarget.currentTime);
        }}
        onTimeUpdate={(event) => narrateAt(event.currentTarget.currentTime)}
        onSeeked={(event) => {
          lastNarratedScene.current = -1;
          narrateAt(event.currentTarget.currentTime);
        }}
        onPause={() => typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.cancel()}
        onEnded={() => typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.cancel()}
        onError={(event) => {
          const error = event.currentTarget.error;
          const labels: Record<number, string> = { 1: "MEDIA_ERR_ABORTED", 2: "MEDIA_ERR_NETWORK", 3: "MEDIA_ERR_DECODE", 4: "MEDIA_ERR_SRC_NOT_SUPPORTED" };
          console.error("Lesson video playback failed", {
            videoId: video.videoId,
            videoUrl,
            sourceType,
            code: error?.code,
            category: error?.code ? labels[error.code] : "UNKNOWN_MEDIA_ERROR",
            message: error?.message,
            networkState: event.currentTarget.networkState,
            readyState: event.currentTarget.readyState,
          });
        }}
      >
        <source key={videoUrl} src={videoUrl} type={sourceType} />
        {isValidMediaUrl(stringValue(video.captionsUrl), "video") && <track kind="captions" src={captionsUrl} srcLang="en" label="English" default />}
      </video>
      <p className="mt-3 text-sm text-muted-foreground">{stringValue(video.description)}</p>
    </section>
  );
}

function SourceBadge({ source, model, inverse = false }: { source?: string; model?: string | null; inverse?: boolean }) {
  const isAi = source === "ai";
  const label = isAi ? "AI generated" : "Generation pending";
  const title = model ? `${label}: ${model}` : label;
  return (
    <span
      title={title}
      className={`inline-flex rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${
        inverse
          ? "border-background/30 text-background/80"
          : isAi
            ? "border-plum/25 bg-plum/[0.06] text-plum"
            : "border-border bg-muted/35 text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}

function LessonSection({ section, index }: { section: ApiRecord; index: number }) {
  const explanation = stringValue(section.explanation) || stringValue(section.content);
  const example = stringValue(section.example);
  const practice = stringValue(section.practice);
  const hint = stringValue(section.hint);
  const feedback = stringValue(section.feedback);
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
      {practice && <Detail label="Practice" text={practice} />}
      {hint && <Detail label="Hint" text={hint} />}
      {feedback && <Detail label="Feedback" text={feedback} />}
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

function isValidMediaUrl(value: string, kind: "image" | "video" | "audio") {
  if (!value) return false;
  if (value.startsWith("/")) return true;
  if (value.startsWith(`data:${kind}/`)) return true;
  if (kind === "image" && value.startsWith("data:image/")) return true;
  if (value.startsWith("blob:")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    console.error("Invalid lesson media URL", { kind, value, error });
    return false;
  }
}

function resolveMediaUrl(value: string) {
  if (!value || value.startsWith("data:") || value.startsWith("blob:") || /^https?:\/\//i.test(value)) return value;
  const apiBase = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").trim();
  const mediaPath = value.startsWith("/") ? value : `/${value}`;
  if (/^https?:\/\//i.test(apiBase)) {
    return new URL(mediaPath, apiBase).toString();
  }
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  return new URL(`${apiBase.replace(/\/$/, "")}${mediaPath}`, origin).toString();
}

function recordsFrom(value: ApiJson | undefined): ApiJson[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function recordArray(value: ApiJson | undefined): ApiRecord[] {
  return recordsFrom(value).filter((item): item is ApiRecord => typeof item === "object" && item !== null && !Array.isArray(item));
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

function makeInitialBrief(
  user: {
    learningTopic?: string;
    educationLevel?: string;
    topicFamiliarity?: string;
    pacePreference?: string;
    preferredModality?: string;
    learningAvailability?: string;
    accessibilitySupport?: boolean;
  } | null | undefined,
): LessonBrief {
  return {
    topic: user?.learningTopic ?? "",
    education_level: toEducationLabel(user?.educationLevel),
    familiarity_level: toFamiliarityLabel(user?.topicFamiliarity),
    pace: toPaceLabel(user?.pacePreference),
    learning_style: toLearningStyleLabel(user?.preferredModality),
    availability: toAvailabilityLabel(user?.learningAvailability),
    accessibility_support: Boolean(user?.accessibilitySupport),
  };
}

function toEducationLabel(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "school") return "School";
  if (normalized === "postgraduate") return "Postgraduate";
  if (normalized.includes("professional") || normalized.includes("independent")) return "Professional / Independent Learner";
  return "Undergraduate";
}

function toFamiliarityLabel(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "intermediate") return "Intermediate";
  if (normalized === "advanced") return "Advanced";
  return "Beginner";
}

function toPaceLabel(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "gentle") return "Gentle and Thorough";
  if (normalized === "fast") return "Fast and Challenging";
  return "Balanced";
}

function toLearningStyleLabel(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "visual") return "Visual Examples and Diagrams";
  if (normalized === "audio") return "Audio Learning";
  if (normalized === "practice") return "Practice First Learning";
  if (normalized === "reading" || normalized === "written") return "Detailed Written Explanations";
  return "Balanced Mix";
}

function toAvailabilityLabel(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "60_min" || normalized === "1 hr/day") return "1 hr/day";
  if (normalized === "120_min" || normalized === "2 hr/day") return "2 hr/day";
  return "30 min/day";
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
