import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Accessibility, ArrowRight, BookOpen, Check, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { MathText } from "@/components/learning/MathText";
import { VectorArrowDiagram } from "@/components/learning/VectorArrowDiagram";
import { isVectorVisualText } from "@/components/learning/vectorVisual";
import { useGenerateQuiz, useSubmitAssessment } from "@/hooks/useAssessment";
import { useAuth } from "@/hooks/useAuth";
import { completeActiveRoadmapLesson, prepareNextRoadmapLessonContext } from "@/lib/lesson-progress";
import type { ApiJson, ApiRecord } from "@/types/api";

export const Route = createFileRoute("/assessment")({
  component: () => (
    <ProtectedRoute>
      <AssessmentPage />
    </ProtectedRoute>
  ),
});

type AssessmentAnswer = ApiRecord & {
  selected_options: string[];
  long_answer: string;
};

function AssessmentPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState("");
  const [answers, setAnswers] = useState<Record<string, AssessmentAnswer>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [readerMode, setReaderMode] = useState<ReaderMode>(() => currentUser?.accessibilitySupport ? "dyslexia" : "standard");
  const quiz = useGenerateQuiz({ learner_id: currentUser?.id ?? "", session_id: sessionId });
  const submit = useSubmitAssessment();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSessionId(window.localStorage.getItem("evolved.currentLessonSession") ?? "");
  }, []);

  useEffect(() => {
    if (currentUser?.id && submit.data) {
      completeActiveRoadmapLesson(currentUser.id);
    }
  }, [currentUser?.id, submit.data]);

  function submitQuiz() {
    if (!currentUser || !quiz.data) return;
    submit.mutate({ learner_id: currentUser.id, session_id: quiz.data.session_id, answers, confidence });
  }

  function evolveNextLesson() {
    const hasNextLesson = prepareNextRoadmapLessonContext();
    void navigate({ to: hasNextLesson ? "/lesson-view" : "/lesson" });
  }

  function retakeAssessment() {
    setAnswers({});
    setConfidence({});
    submit.reset();
    void quiz.refetch();
  }

  function followRecommendedAction(actionText: string) {
    if (shouldRetakeAssessment(actionText)) {
      retakeAssessment();
      return;
    }
    void navigate({ to: "/lesson-view" });
  }

  const questions = quiz.data?.questions ?? [];
  const incompleteQuestions = questions
    .map((question, index) => ({ id: questionId(question, index), number: index + 1 }))
    .filter((question) => !answerComplete(answers[question.id]));
  const canSubmit = questions.length > 0 && incompleteQuestions.length === 0 && !submit.isPending;
  const submitHint = incompleteQuestions.length
    ? `Complete question${incompleteQuestions.length === 1 ? "" : "s"} ${incompleteQuestions.map((question) => question.number).join(", ")} before submitting.`
    : "Ready to submit.";
  return (
    <AppShell title="Adaptive assessment" subtitle="Multiple-select checks plus written reasoning from lesson visuals." accent={submit.isPending ? "Evolving" : "Adaptive"}>
      <div className={readerModeClass(readerMode)}>
        <article className="max-w-5xl space-y-4">
          <ReaderControls mode={readerMode} onChange={setReaderMode} />
          {!sessionId && <p className="text-sm text-muted-foreground">Select a lesson from your roadmap before starting an assessment.</p>}
          {quiz.isLoading && <p className="text-sm text-muted-foreground">Generating an AI assessment from your current lesson. This can take a minute on the first run...</p>}
          {quiz.isError && <p className="text-sm text-destructive">{quiz.error.message}</p>}
          {questions.length > 0 && (
            <>
              {questions.map((question, index) => {
                const id = questionId(question, index);
                return (
                  <QuestionCard
                    key={id}
                    question={question}
                    index={index}
                    answer={answers[id] ?? emptyAnswer()}
                    confidence={confidence[id] ?? 70}
                    onAnswer={(value) => setAnswers((current) => ({ ...current, [id]: value }))}
                    onConfidence={(value) => setConfidence((current) => ({ ...current, [id]: value }))}
                  />
                );
              })}
              {!submit.data && (
                <>
                  <button
                    type="button"
                    onClick={submitQuiz}
                    disabled={!canSubmit}
                    title={submitHint}
                    className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background disabled:opacity-50"
                  >
                    {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    Submit and evaluate
                  </button>
                  {!canSubmit && !submit.isPending && <p className="text-xs text-muted-foreground">{submitHint}</p>}
                </>
              )}
              {submit.isError && <p className="text-sm text-destructive">{submit.error.message}</p>}
              {submit.data && (
                <AssessmentResultCard
                  score={submit.data.score}
                  feedback={submit.data.detailed_feedback}
                  nextAction={humanizeIdentifier(textValue(submit.data.adaptation.action))}
                  recommendationAction={recommendedActionText(submit.data.detailed_feedback, textValue(submit.data.adaptation.action))}
                  onRecommended={() => followRecommendedAction(`${textValue(submit.data.adaptation.action)} ${submit.data.detailed_feedback}`)}
                  onNext={evolveNextLesson}
                />
              )}
            </>
          )}
        </article>
      </div>
    </AppShell>
  );
}

type ReaderMode = "standard" | "dyslexia" | "focus";

function ReaderControls({ mode, onChange }: { mode: ReaderMode; onChange: (mode: ReaderMode) => void }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          <Accessibility className="size-3.5 text-plum" /> Reader accessibility
        </div>
        <div className="grid grid-cols-3 rounded-2xl border border-border bg-muted/25 p-1 text-xs">
          {[
            { value: "standard", label: "Standard" },
            { value: "dyslexia", label: "Dyslexia" },
            { value: "focus", label: "Focus" },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value as ReaderMode)}
              className={`rounded-xl px-3 py-2 font-medium ${mode === item.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function readerModeClass(mode: ReaderMode) {
  if (mode === "dyslexia") return "reader-dyslexia";
  if (mode === "focus") return "reader-focus";
  return "";
}

function AssessmentResultCard({
  score,
  feedback,
  nextAction,
  recommendationAction,
  onRecommended,
  onNext,
}: {
  score: number;
  feedback: string;
  nextAction: string;
  recommendationAction: { label: string; mode: "review" | "retest" | "apply" };
  onRecommended: () => void;
  onNext: () => void;
}) {
  const result = splitAssessmentFeedback(feedback);
  return (
    <section className="rounded-3xl border border-plum/20 bg-plum/[0.04] p-6">
      <div className="grid gap-5 md:grid-cols-[auto_1fr] md:items-start">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-plum">Learner model updated</div>
          <div className="mt-2 font-display text-5xl">{Math.round(score * 100)}%</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Evaluation</div>
          <MathText as="p" className="mt-2 text-sm leading-7 text-foreground/85" text={result.evaluation} />
        </div>
      </div>

      {result.recommendation && (
        <div className="mt-4 rounded-2xl border border-amber-300/50 bg-amber-50 p-5 text-amber-950">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-semibold">
            <Sparkles className="size-3.5" /> Recommendation
          </div>
          <MathText as="p" className="mt-2 text-sm leading-7" text={result.recommendation} />
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-border bg-background p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Suggested next step</div>
          <MathText
            as="p"
            className="mt-1 text-sm font-medium"
            text={nextAction || "Teaching strategy recalibrated from this result."}
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onRecommended}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm text-foreground hover:border-plum/50"
          >
            {recommendationAction.mode === "retest" ? <RotateCcw className="size-4" /> : <BookOpen className="size-4" />}
            {recommendationAction.label}
          </button>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:opacity-90"
          >
            <ArrowRight className="size-4" /> Evolve my next lesson
          </button>
        </div>
      </div>
    </section>
  );
}

function QuestionCard({
  question,
  index,
  answer,
  confidence,
  onAnswer,
  onConfidence,
}: {
  question: ApiRecord;
  index: number;
  answer: AssessmentAnswer;
  confidence: number;
  onAnswer: (value: AssessmentAnswer) => void;
  onConfidence: (value: number) => void;
}) {
  const options = optionsFromQuestion(question);
  const visual = visualFromQuestion(question);
  const explanation = textValue(question.explanation);
  const needsOption = answer.selected_options.length === 0;
  const answerLength = answer.long_answer.trim().length;
  const needsLongAnswer = answerLength < MIN_LONG_ANSWER_CHARS;

  function toggleOption(option: string) {
    const selectedOptions = answer.selected_options.includes(option)
      ? answer.selected_options.filter((item) => item !== option)
      : [...answer.selected_options, option];
    onAnswer({ ...answer, selected_options: selectedOptions });
  }

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Question {index + 1} - Multiple select + long answer</div>
      <MathText as="h2" className="mt-3 font-display text-2xl" text={textValue(question.prompt)} />
      {explanation && <MathText as="p" className="mt-3 text-sm leading-relaxed text-muted-foreground" text={explanation} />}
      {visual && (
        <figure className="mt-5">
          {visual.isVector ? (
            <VectorArrowDiagram title={visual.title} description={visual.description} data={visual.data} />
          ) : visual.imageUrl && (
            <img
              src={visual.imageUrl}
              alt={visual.title || textValue(question.prompt) || `Question ${index + 1} visual`}
              className="max-h-[520px] w-full rounded-2xl border border-border bg-background object-contain"
            />
          )}
          {(visual.title || visual.description) && (
            <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <MathText as="span" text={`${visual.title}${visual.title && visual.description ? " - " : ""}${visual.description}`} />
            </figcaption>
          )}
        </figure>
      )}
      <div className="mt-5">
        <div className="text-xs font-medium text-muted-foreground">Select all correct choices</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const selected = answer.selected_options.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => toggleOption(option)}
                className={`rounded-xl border px-4 py-3 text-left text-sm transition ${selected ? "border-plum bg-plum/[0.08] text-foreground" : "border-border hover:border-plum/50"}`}
              >
                <span className="mr-2 inline-flex size-4 items-center justify-center rounded border border-current text-[10px]">
                  {selected && <Check className="size-3" />}
                </span>
                <MathText as="span" text={option} />
              </button>
            );
          })}
        </div>
      </div>
      <label className="mt-5 block text-xs font-medium text-muted-foreground">
        <MathText as="span" text={textValue(question.long_answer_prompt) || "Explain your reasoning in 3 to 6 sentences"} />
        <textarea
          value={answer.long_answer}
          onChange={(event) => onAnswer({ ...answer, long_answer: event.target.value })}
          className="mt-2 min-h-36 w-full rounded-2xl border border-input bg-background p-4 text-base leading-7 outline-none focus:border-plum"
          placeholder="Write your answer and reasoning"
        />
      </label>
      {(needsOption || needsLongAnswer) && (
        <p className="mt-2 text-xs text-muted-foreground">
          {needsOption ? "Select at least one choice. " : ""}
          {needsLongAnswer ? `${Math.max(0, MIN_LONG_ANSWER_CHARS - answerLength)} more characters needed.` : ""}
        </p>
      )}
      <label className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
        Confidence
        <input type="range" min="0" max="100" value={confidence} onChange={(event) => onConfidence(Number(event.target.value))} className="accent-plum" />
        <span>{confidence}%</span>
      </label>
    </section>
  );
}

function emptyAnswer(): AssessmentAnswer {
  return { selected_options: [], long_answer: "" };
}

const MIN_LONG_ANSWER_CHARS = 20;

function answerComplete(answer: AssessmentAnswer | undefined) {
  return Boolean(answer && answer.selected_options.length > 0 && answer.long_answer.trim().length >= MIN_LONG_ANSWER_CHARS);
}

function questionId(question: ApiRecord, index: number) {
  return textValue(question.id) || `question-${index + 1}`;
}

function optionsFromQuestion(question: ApiRecord) {
  const options = arrayValue(question.options).map(String).filter(Boolean);
  return options.length > 0 ? options : ["I can identify the concept", "I can use the diagram", "I can explain the reasoning", "I need to review this"];
}

function visualFromQuestion(question: ApiRecord): { imageUrl?: string; title?: string; description?: string; data?: unknown; isVector?: boolean } | null {
  const visual = question.visual_asset ?? question.visualAsset ?? question.diagram;
  if (typeof visual !== "object" || visual === null || Array.isArray(visual)) return null;
  const record = visual as ApiRecord;
  const rendered = {
    imageUrl: textValue(record.imageUrl),
    title: textValue(record.title),
    description: textValue(record.description),
    data: record.data,
    isVector: isVectorVisualText(record),
  };
  return rendered.imageUrl || rendered.data || rendered.title || rendered.description ? rendered : null;
}

function arrayValue(value: ApiJson | undefined) {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function humanizeIdentifier(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ").trim();
}

function splitAssessmentFeedback(feedback: string) {
  const [evaluation, recommendation] = feedback.split(/\bRecommendation:\s*/i);
  return {
    evaluation: evaluation.trim() || "Assessment submitted.",
    recommendation: recommendation?.trim() ?? "",
  };
}

function recommendedActionText(feedback: string, adaptationAction: string) {
  const text = `${adaptationAction} ${feedback}`.toLowerCase();
  if (/\b(retest|resubmit|retry|try again)\b/.test(text) && !/\b(remediate|review|re-engage|practice)\b/.test(text)) {
    return { label: "Retake assessment", mode: "retest" as const };
  }
  if (/\b(remediate|review|re-engage|practice|worked examples|not advance|do not advance)\b/.test(text)) {
    return { label: "Review lesson again", mode: "review" as const };
  }
  return { label: "Apply suggestion", mode: "apply" as const };
}

function shouldRetakeAssessment(actionText: string) {
  const text = actionText.toLowerCase();
  return /\b(retest|resubmit|retry|try again)\b/.test(text) && !/\b(remediate|review|re-engage|practice|worked examples)\b/.test(text);
}
