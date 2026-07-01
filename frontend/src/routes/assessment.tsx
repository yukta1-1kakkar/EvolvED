import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { MathText } from "@/components/learning/MathText";
import { VectorArrowDiagram } from "@/components/learning/VectorArrowDiagram";
import { isVectorVisualText } from "@/components/learning/vectorVisual";
import { useGenerateQuiz, useSubmitAssessment } from "@/hooks/useAssessment";
import { useAuth } from "@/hooks/useAuth";
import { completeActiveRoadmapLesson, prepareNextRoadmapLessonContext } from "@/lib/lesson-progress";
import type { ApiJson, ApiRecord } from "@/types/api";

export const Route = createFileRoute("/assessment")({ component: AssessmentPage });

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
      {!sessionId && <p className="text-sm text-muted-foreground">Select a lesson from your roadmap before starting an assessment.</p>}
      {quiz.isLoading && <p className="text-sm text-muted-foreground">Generating a quiz from your current lesson...</p>}
      {quiz.isError && <p className="text-sm text-destructive">{quiz.error.message}</p>}
      {questions.length > 0 && (
        <div className="max-w-5xl space-y-4">
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
            <div className="rounded-3xl border border-plum/20 bg-plum/[0.04] p-6">
              <div className="text-[10px] uppercase tracking-[0.22em] text-plum">Learner model updated</div>
              <div className="mt-2 font-display text-4xl">{Math.round(submit.data.score * 100)}%</div>
              <MathText as="p" className="mt-3 text-sm leading-relaxed" text={submit.data.detailed_feedback} />
              <MathText
                as="p"
                className="mt-3 text-sm text-muted-foreground"
                text={`Next-lesson adaptation: ${textValue(submit.data.adaptation.action) || "Teaching strategy recalibrated from this result."}`}
              />
              <button
                type="button"
                onClick={evolveNextLesson}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background hover:opacity-90"
              >
                <ArrowRight className="size-4" /> Evolve my next lesson
              </button>
            </div>
          )}
        </div>
      )}
    </AppShell>
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
                <span className="mr-2 inline-flex size-4 items-center justify-center rounded border border-current text-[10px]">{selected ? "x" : ""}</span>
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
    isVector: isVectorVisualText(record) || isVectorVisualText(question.prompt),
  };
  return rendered.imageUrl || rendered.title || rendered.description || rendered.isVector ? rendered : null;
}

function arrayValue(value: ApiJson | undefined) {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
