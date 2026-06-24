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
  Pause,
  RefreshCw,
  Sparkles,
  Target,
  Volume2,
  X,
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
  const [tutorOpen, setTutorOpen] = useState(false);

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
    }, {
      onSuccess: () => setQuestion(""),
    });
  }

  useEffect(() => {
    if (!lesson.data || typeof window === "undefined") return;
    window.localStorage.setItem("evolved.currentLessonSession", lesson.data.lesson_id);
  }, [lesson.data]);

  useEffect(() => {
    setTutorOpen(false);
  }, [lesson.data?.lesson_id]);

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
        <div className="relative">
          <article className="space-y-6">
            <section className="overflow-hidden rounded-3xl border border-border bg-card">
              <div className="bg-foreground px-6 py-5 text-background">
                <div className="text-[10px] uppercase tracking-[0.24em] text-background/65">Your lesson</div>
                <h2 className="mt-2 max-w-5xl font-display text-3xl md:text-4xl">{lesson.data.learning_objective}</h2>
                <p className="mt-3 max-w-5xl text-base leading-8 text-background/75">{lesson.data.lesson_summary}</p>
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

            <div className="grid gap-4 lg:grid-cols-3">
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
            </div>
          </article>

          <button
            type="button"
            onClick={() => setTutorOpen(true)}
            className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-plum/25 bg-foreground px-4 py-3 text-sm text-background shadow-xl md:bottom-6 md:right-6"
          >
            <Sparkles className="size-4" /> AI tutor
          </button>

          {tutorOpen && (
            <div className="fixed inset-0 z-50">
              <button type="button" aria-label="Close AI tutor" onClick={() => setTutorOpen(false)} className="absolute inset-0 bg-foreground/25" />
              <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-card p-5 shadow-2xl">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    <Sparkles className="size-3.5 text-plum" /> AI tutor
                  </div>
                  <button type="button" onClick={() => setTutorOpen(false)} className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground" aria-label="Close AI tutor">
                    <X className="size-4" />
                  </button>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Ask about this lesson. Your questions become part of your learner memory.</p>
                {tutor.data && <div className="mt-4 rounded-2xl bg-muted/35 p-4 text-sm leading-relaxed">{tutor.data.answer}</div>}
                {tutor.isError && <p className="mt-3 text-sm text-destructive">{tutor.error.message}</p>}
                <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask for a hint or a simpler explanation" className="mt-4 min-h-32 w-full rounded-2xl border border-input bg-background p-3 text-sm outline-none focus:border-plum" />
                {tutor.isPending && <p className="mt-2 text-xs text-muted-foreground">Tutor is thinking...</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {["question", "simpler_explanation", "example", "hint"].map((action) => (
                    <button key={action} type="button" onClick={() => askTutor(action)} disabled={tutor.isPending || !question.trim()} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50">
                      {humanize(action)}
                    </button>
                  ))}
                </div>
              </aside>
            </div>
          )}
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
            <option>Detailed Written Explanations</option>
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
  const audioAssets = mediaCandidates.filter((item) => item.type === "audio" && isValidMediaUrl(stringValue(item.audioUrl), "audio"));
  const visualCandidates = mediaCandidates.filter((item) => item.type !== "audio");
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
  const [status, setStatus] = useState(storedAudioUrl ? "Ready" : narration ? "Preparing audio..." : "");
  const [useBrowserNarration, setUseBrowserNarration] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
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
        setStatus("Ready");
      })
      .catch((error) => {
        console.error("Lesson audio generation/playback failed", error);
        const browserSpeechAvailable = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
        setUseBrowserNarration(browserSpeechAvailable);
        setStatus("");
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
      setStatus("Playing");
    };
    utterance.onend = () => {
      console.info("Lesson browser narration playback completed");
      setSpeaking(false);
      setStatus("Ready");
    };
    utterance.onerror = (event) => {
      console.error("Lesson browser narration playback failed", event);
      setSpeaking(false);
      setStatus("");
    };
    window.speechSynthesis.speak(utterance);
  }

  function toggleAudioPlayback() {
    const player = audioRef.current;
    if (!player) return;
    if (player.paused) {
      void player.play();
    } else {
      player.pause();
    }
  }

  function pauseBrowserNarration() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setStatus("Ready");
  }

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        <Volume2 className="size-3.5 text-plum" /> Audio lesson
      </div>
      <div className="mt-4 rounded-2xl bg-muted/35 p-4">
        {audioUrl ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={toggleAudioPlayback}
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm text-background"
            >
              {audioPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              {audioPlaying ? "Pause" : "Play"}
            </button>
            <audio
              ref={audioRef}
              controls
              src={audioUrl}
              className="w-full"
              preload="metadata"
              onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
              onCanPlay={() => console.info("Lesson audio URL verified and ready", { audioUrl })}
              onPlay={() => {
                setAudioPlaying(true);
                console.info("Lesson audio playback started", { audioUrl });
              }}
              onPause={() => setAudioPlaying(false)}
              onEnded={() => setAudioPlaying(false)}
              onError={(event) => console.error("Lesson audio player failed", event.currentTarget.error)}
            />
          </div>
        ) : useBrowserNarration ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={playBrowserNarration} disabled={speaking} className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60">
              <Play className="size-4" /> Play
            </button>
            <button type="button" onClick={pauseBrowserNarration} disabled={!speaking} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground disabled:opacity-60">
              <Pause className="size-4" /> Pause
            </button>
            {speaking && <span className="self-center text-sm text-muted-foreground">{status}</span>}
          </div>
        ) : (
          status ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Play className="size-4 text-plum" /> {status}
            </div>
          ) : null
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
    <section className="rounded-3xl border border-border bg-card p-7">
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
        <div className="mt-6 grid gap-6">
          {visualElements.map((item, index) => (
            <div
              key={recordKey(item, index)}
              className="rounded-3xl border border-border bg-muted/20 p-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <div className="text-lg font-medium">{recordTitle(item, index)}</div>
              {isValidMediaUrl(stringValue(item.imageUrl), "image") && (
                <img
                  src={stringValue(item.imageUrl)}
                  alt={stringValue(item.description) || recordTitle(item, index)}
                  className="mt-4 min-h-[440px] w-full rounded-2xl border border-border bg-background object-contain md:min-h-[620px]"
                  onError={(event) => {
                    console.error("Lesson visual failed to render", { title: recordTitle(item, index), url: event.currentTarget.src });
                    event.currentTarget.hidden = true;
                  }}
                />
              )}
              <p className="mt-3 text-base leading-8 text-muted-foreground">{stringValue(item.caption) || stringValue(item.description) || recordBody(item)}</p>
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
  const nodeLabels = new Map(
    nodes.map((node, nodeIndex) => [
      stringValue(node.id) || `concept-${nodeIndex + 1}`,
      stringValue(node.label) || recordTitle(node, nodeIndex),
    ]),
  );
  const resolveNode = (value: string) => nodeLabels.get(value) || value;

  return (
    <div className="mt-5 rounded-3xl border border-plum/20 bg-plum/[0.04] p-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
      <div className="flex items-center gap-2 text-base font-medium">
        <Network className="size-4 text-plum" /> {recordTitle(map, index)}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {nodes.map((node, nodeIndex) => (
          <div
            key={recordKey(node, nodeIndex)}
            className="min-h-32 rounded-2xl border border-border bg-background p-4 text-sm leading-6 shadow-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
            style={{ animationDelay: `${nodeIndex * 80}ms` }}
          >
            <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Concept {nodeIndex + 1}</div>
            <div className="break-words text-base font-medium text-foreground">{stringValue(node.label) || recordTitle(node, nodeIndex)}</div>
          </div>
        ))}
      </div>
      {edges.length > 0 && (
        <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          {edges.map((edge, edgeIndex) => (
            <div
              key={recordKey(edge, edgeIndex)}
              className="flex min-h-14 items-center gap-2 rounded-2xl border border-border bg-background/70 p-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
              style={{ animationDelay: `${(nodes.length + edgeIndex) * 80}ms` }}
            >
              <span className="min-w-0 flex-1 break-words">{resolveNode(stringValue(edge.from))}</span>
              <ArrowRight className="size-4 shrink-0 text-plum" />
              <span className="min-w-0 flex-1 break-words">{resolveNode(stringValue(edge.to))}</span>
              {stringValue(edge.label) && <span className="shrink-0 rounded-full bg-plum/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-plum">{stringValue(edge.label)}</span>}
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
    <div className="mt-5 rounded-3xl border border-border p-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
      <div className="flex items-center gap-2 text-base font-medium">
        <GitBranch className="size-4 text-plum" /> {recordTitle(flow, index)}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {steps.map((step, stepIndex) => (
          <div
            key={`${recordKey(flow, index)}-${stepIndex}`}
            className="min-h-24 break-words rounded-xl bg-muted/35 p-4 text-base leading-7 animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
            style={{ animationDelay: `${stepIndex * 80}ms` }}
          >
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {lessons.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            title={item.title}
            className={`flex aspect-square overflow-hidden rounded-2xl border p-4 text-left transition ${selectedId === item.id ? "border-plum bg-plum/[0.06]" : "border-border bg-card hover:border-plum/50"}`}
          >
            <div className="flex min-h-0 w-full flex-col">
              <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                <span className="min-w-0 truncate">{compactText(item.difficulty, 2, 18)}</span>
                <span className="shrink-0">{item.estimated_duration} min</span>
              </div>
              <h3 className="mt-4 break-words text-base font-semibold leading-6 text-foreground">
                {compactText(item.title, 8, 76)}
              </h3>
              <p className="mt-3 break-words text-xs leading-5 text-muted-foreground">
                {compactText(item.description, 16, 120)}
              </p>
            </div>
          </button>
        ))}
      </div>
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
    <section className="rounded-3xl border border-border bg-card p-7">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        <BookMarked className="size-3" /> Lesson part {index + 1}
      </div>
      <h3 className="mt-3 font-display text-3xl">{recordTitle(section, index)}</h3>
      <p className="mt-4 whitespace-pre-wrap text-base leading-8 text-foreground/80">{explanation}</p>
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
    <div className={`mt-4 rounded-2xl border p-5 text-base leading-8 ${accent ? "border-plum/20 bg-plum/[0.04]" : "border-border bg-muted/20"}`}>
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
    <div className="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Skeleton className="aspect-square rounded-2xl" />
      <Skeleton className="aspect-square rounded-2xl" />
      <Skeleton className="aspect-square rounded-2xl" />
      <Skeleton className="aspect-square rounded-2xl" />
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

function compactText(value: string, maxWords: number, maxChars: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const words = normalized.split(" ");
  let compact = words.length > maxWords ? words.slice(0, maxWords).join(" ") : normalized;
  if (compact.length > maxChars) compact = compact.slice(0, maxChars).trimEnd();
  return compact.length < normalized.length ? `${compact.replace(/[.,;:!?-]+$/, "")}...` : compact;
}

function isValidMediaUrl(value: string, kind: "image" | "audio") {
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
  if (normalized === "reading" || normalized === "written") return "Detailed Written Explanations";
  return "Detailed Written Explanations";
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
