import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  BookMarked,
  CheckCircle2,
  GitBranch,
  ListChecks,
  MessageCircle,
  Mic,
  MicOff,
  Network,
  Play,
  Pause,
  RefreshCw,
  Send,
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
import { ROUTES } from "@/lib/routes";
import type { ApiJson, ApiRecord, LessonBlueprint, LessonRoadmapItem } from "@/types/api";

export const Route = createFileRoute("/lesson")({
  validateSearch: (search): LessonSearch => ({
    topic: typeof search.topic === "string" ? search.topic : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Lesson - EvolvED" },
      { name: "description", content: "An adaptive lesson roadmap and concept-first lesson composed in real time by EvolvED." },
    ],
  }),
  component: LessonPage,
});

export const LESSON_CONTEXT_STORAGE_KEY = "evolved.pendingLessonContext";
export const LESSON_ROADMAP_TOPIC_STORAGE_KEY = "evolved.pendingRoadmapTopic";

type LessonSearch = {
  topic?: string;
};

export type LessonBrief = {
  topic: string;
  education_level: string;
  familiarity_level: string;
  pace: string;
  learning_style: string;
  availability: string;
  accessibility_support: boolean;
};

export type LessonLaunchContext = {
  brief: LessonBrief;
  selectedLesson: LessonRoadmapItem;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function LessonPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { topic: searchTopic } = Route.useSearch();
  const initialBrief = makeInitialBrief(currentUser, searchTopic);
  const [draft, setDraft] = useState<LessonBrief>(initialBrief);
  const [brief, setBrief] = useState<LessonBrief>(initialBrief);
  const roadmapConstraints = constraintsFromBrief(brief);
  const roadmap = useRoadmap({
    learner_id: currentUser?.id ?? "",
    topic: brief.topic,
    constraints: roadmapConstraints,
  });

  function regenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const topic = draft.topic.trim();
    if (!topic) return;
    const nextBrief = { ...draft, topic };
    setBrief(nextBrief);
    if (JSON.stringify(nextBrief) === JSON.stringify(brief)) void roadmap.refetch();
  }

  function chooseLesson(item: LessonRoadmapItem) {
    const launchContext: LessonLaunchContext = { brief: launchBriefFromPreferences(brief, draft), selectedLesson: item };
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(LESSON_CONTEXT_STORAGE_KEY, JSON.stringify(launchContext));
    }
    void navigate({ to: "/lesson-view" });
  }

  function updateDraft(nextBrief: LessonBrief) {
    setDraft(nextBrief);
    if (nextBrief.topic.trim() === brief.topic.trim()) {
      setBrief(nextBrief);
    }
  }

  useEffect(() => {
    const nextBrief = makeInitialBrief(currentUser, searchTopic);
    const pendingTopic = consumePendingRoadmapTopic();
    if (pendingTopic) nextBrief.topic = pendingTopic;
    setDraft(nextBrief);
    setBrief(nextBrief);
  }, [
    currentUser?.id,
    currentUser?.learningTopic,
    currentUser?.educationLevel,
    currentUser?.topicFamiliarity,
    currentUser?.pacePreference,
    currentUser?.preferredModality,
    currentUser?.learningAvailability,
    currentUser?.accessibilitySupport,
    searchTopic,
  ]);

  return (
    <AppShell
      title={brief.topic || "Create your lesson"}
      subtitle="Choose a topic and preferences, then pick a roadmap lesson to open it on its own page."
      accent={roadmap.isFetching ? "Planning" : "Roadmap ready"}
    >
      <div className="mb-4 flex justify-end">
        <Link
          to={ROUTES.KNOWLEDGE}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <Network className="size-4" /> Open knowledge map
        </Link>
      </div>
      <LessonBriefForm draft={draft} onChange={updateDraft} onSubmit={regenerate} loading={roadmap.isFetching} />

      {roadmap.isLoading && <RoadmapSkeleton />}
      {roadmap.isError && <ErrorPanel title="Roadmap generation failed" message={roadmap.error.message} onRetry={() => void roadmap.refetch()} />}
      {roadmap.data && (
        <RoadmapCards
          lessons={roadmap.data.lessons}
          onSelect={chooseLesson}
          loading={false}
          generationSource={roadmap.data.generation_source}
          generationModel={roadmap.data.generation_model}
        />
      )}

    </AppShell>
  );
}

export function LessonExperience({
  brief,
  selectedLesson,
}: {
  brief: LessonBrief;
  selectedLesson: LessonRoadmapItem;
}) {
  const { currentUser } = useAuth();
  const lesson = useLesson({
    learner_id: currentUser?.id ?? "",
    topic: brief.topic,
    selected_lesson: roadmapItemToRecord(selectedLesson),
    constraints: constraintsFromBrief(brief),
  });
  const tutor = useTutorInteraction();
  const [question, setQuestion] = useState("");
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorAudioUrl, setTutorAudioUrl] = useState("");
  const [tutorAudioStatus, setTutorAudioStatus] = useState("");
  const [tutorAudioPlaying, setTutorAudioPlaying] = useState(false);
  const [tutorResponseMode, setTutorResponseMode] = useState<"text" | "audio">("text");
  const [recordingQuestion, setRecordingQuestion] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("");
  const tutorAudioRef = useRef<HTMLAudioElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

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
    setTutorAudioUrl("");
    setTutorAudioStatus("");
    setTutorAudioPlaying(false);
  }, [tutor.data?.answer]);

  useEffect(() => {
    return () => {
      if (tutorAudioUrl) URL.revokeObjectURL(tutorAudioUrl);
    };
  }, [tutorAudioUrl]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  function toggleQuestionRecording() {
    if (recordingQuestion) {
      recognitionRef.current?.stop();
      setRecordingQuestion(false);
      setRecordingStatus("Recording stopped");
      return;
    }
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: BrowserSpeechRecognitionConstructor; webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { SpeechRecognition?: BrowserSpeechRecognitionConstructor; webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setRecordingStatus("Voice input is not supported in this browser");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => {
      setRecordingQuestion(true);
      setRecordingStatus("Listening...");
    };
    recognition.onend = () => {
      setRecordingQuestion(false);
      setRecordingStatus((current) => current === "Listening..." ? "Voice captured" : current);
    };
    recognition.onerror = (event) => {
      setRecordingQuestion(false);
      setRecordingStatus(event.error ? `Voice input failed: ${event.error}` : "Voice input failed");
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setQuestion(transcript.trim());
      setRecordingStatus("Voice captured");
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (error) {
      console.error("Voice question recording failed to start", error);
      setRecordingQuestion(false);
      setRecordingStatus("Voice input failed to start");
    }
  }

  async function prepareTutorAudio() {
    const answer = tutor.data?.answer?.trim();
    if (!answer) return;
    if (tutorAudioUrl) {
      const player = tutorAudioRef.current;
      if (!player) return;
      if (player.paused) {
        void player.play();
      } else {
        player.pause();
      }
      return;
    }
    setTutorAudioStatus("Preparing audio...");
    try {
      const blob = await synthesizeLessonAudio(answer);
      if (!blob.size || !["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"].includes(blob.type)) {
        throw new Error(`Invalid tutor audio response: type=${blob.type || "unknown"} size=${blob.size}`);
      }
      const objectUrl = URL.createObjectURL(blob);
      setTutorAudioUrl(objectUrl);
      setTutorAudioStatus("Ready");
      window.setTimeout(() => void tutorAudioRef.current?.play(), 0);
    } catch (error) {
      console.error("Tutor audio generation failed", error);
      setTutorAudioStatus("Audio unavailable");
    }
  }

  if (lesson.isLoading) return <LessonSkeleton />;
  if (lesson.isError) return <ErrorPanel message={lesson.error.message} onRetry={() => void lesson.refetch()} />;
  if (!lesson.data) return null;

  return (
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
              <p className="mt-2 text-sm font-medium">{selectedLessonTitle(lesson.data.selected_lesson) || selectedLesson.title || lesson.data.topic}</p>
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
            <div className="mt-4 grid grid-cols-2 rounded-2xl border border-border bg-muted/25 p-1">
              {[
                { value: "text", label: "Text" },
                { value: "audio", label: "Audio" },
              ].map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setTutorResponseMode(mode.value as "text" | "audio")}
                  className={`rounded-xl px-3 py-2 text-xs font-medium ${tutorResponseMode === mode.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {tutor.data && (
              <div className="mt-4 rounded-2xl bg-muted/35 p-4">
                {tutorResponseMode === "text" && <TutorAnswerText answer={tutor.data.answer} />}
                <div className={`${tutorResponseMode === "audio" ? "" : "mt-3"} flex flex-wrap items-center gap-2`}>
                  <button
                    type="button"
                    onClick={prepareTutorAudio}
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs ${tutorResponseMode === "audio" ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {tutorAudioPlaying ? <Pause className="size-3.5" /> : <Volume2 className="size-3.5" />}
                    {tutorAudioPlaying ? "Pause audio" : tutorAudioUrl ? "Play audio" : "Play answer"}
                  </button>
                  {tutorAudioStatus && <span className="text-xs text-muted-foreground">{tutorAudioStatus}</span>}
                  {tutorResponseMode === "audio" && !tutorAudioStatus && <span className="text-xs text-muted-foreground">Listen to the same tutor answer.</span>}
                  {tutorAudioUrl && (
                    <audio
                      ref={tutorAudioRef}
                      src={tutorAudioUrl}
                      preload="metadata"
                      className="hidden"
                      onPlay={() => setTutorAudioPlaying(true)}
                      onPause={() => setTutorAudioPlaying(false)}
                      onEnded={() => setTutorAudioPlaying(false)}
                      onError={(event) => {
                        console.error("Tutor audio player failed", event.currentTarget.error);
                        setTutorAudioStatus("Audio unavailable");
                      }}
                    />
                  )}
                </div>
                {tutorResponseMode === "audio" && (
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Show text version</summary>
                    <div className="mt-3 rounded-xl bg-background/70 p-3">
                      <TutorAnswerText answer={tutor.data.answer} />
                    </div>
                  </details>
                )}
              </div>
            )}
            {tutor.isError && <p className="mt-3 text-sm text-destructive">{tutor.error.message}</p>}
            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                askTutor();
              }}
            >
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    askTutor();
                  }
                }}
                placeholder="Ask for a hint or a simpler explanation"
                className="min-h-24 flex-1 rounded-2xl border border-input bg-background p-3 text-sm outline-none focus:border-plum"
              />
              <button
                type="button"
                onClick={toggleQuestionRecording}
                className={`self-end rounded-full border p-3 transition-colors ${recordingQuestion ? "border-plum bg-plum/10 text-plum" : "border-border text-muted-foreground hover:text-foreground"}`}
                aria-label={recordingQuestion ? "Stop recording question" : "Record question"}
                title={recordingQuestion ? "Stop recording" : "Record question"}
              >
                {recordingQuestion ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </button>
              <button
                type="submit"
                disabled={tutor.isPending || !question.trim()}
                className="self-end rounded-full bg-foreground p-3 text-background transition-opacity disabled:opacity-50"
                aria-label="Send question to AI tutor"
              >
                <Send className="size-4" />
              </button>
            </form>
            {recordingStatus && <p className="mt-2 text-xs text-muted-foreground">{recordingStatus}</p>}
            {tutor.isPending && <p className="mt-2 text-xs text-muted-foreground">Tutor is responding...</p>}
          </aside>
        </div>
      )}
    </div>
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

function TutorAnswerText({ answer }: { answer: string }) {
  const lines = answer.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {lines.map((line, index) => {
        const match = line.match(/^([^:]{2,24}):\s*(.*)$/);
        if (match) {
          return (
            <div key={`${line}-${index}`}>
              <span className="font-medium">{match[1]}:</span>
              {match[2] && <span className="ml-1 text-foreground/80">{match[2]}</span>}
            </div>
          );
        }
        return <p key={`${line}-${index}`} className="text-foreground/80">{line}</p>;
      })}
    </div>
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
    <div className="mt-5 rounded-3xl border border-border p-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
      <div className="flex items-center gap-2 text-lg font-medium">
        <GitBranch className="size-4 text-plum" /> {recordTitle(flow, index)}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {steps.map((step, stepIndex) => (
          <div
            key={`${recordKey(flow, index)}-${stepIndex}`}
            className="min-h-28 break-words rounded-xl bg-muted/35 p-5 text-lg leading-8 animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
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
  topicOverride?: string,
): LessonBrief {
  return {
    topic: topicOverride?.trim() || (user?.learningTopic ?? ""),
    education_level: toEducationLabel(user?.educationLevel),
    familiarity_level: toFamiliarityLabel(user?.topicFamiliarity),
    pace: toPaceLabel(user?.pacePreference),
    learning_style: toLearningStyleLabel(user?.preferredModality),
    availability: toAvailabilityLabel(user?.learningAvailability),
    accessibility_support: Boolean(user?.accessibilitySupport),
  };
}

function consumePendingRoadmapTopic() {
  if (typeof window === "undefined") return "";
  const topic = window.sessionStorage.getItem(LESSON_ROADMAP_TOPIC_STORAGE_KEY)?.trim() ?? "";
  if (topic) window.sessionStorage.removeItem(LESSON_ROADMAP_TOPIC_STORAGE_KEY);
  return topic;
}

function launchBriefFromPreferences(roadmapBrief: LessonBrief, currentDraft: LessonBrief): LessonBrief {
  return {
    ...roadmapBrief,
    education_level: currentDraft.education_level,
    familiarity_level: currentDraft.familiarity_level,
    pace: currentDraft.pace,
    learning_style: currentDraft.learning_style,
    availability: currentDraft.availability,
    accessibility_support: currentDraft.accessibility_support,
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
