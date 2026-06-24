import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { useGenerateQuiz, useSubmitAssessment } from "@/hooks/useAssessment";
import { useAuth } from "@/hooks/useAuth";
import type { ApiJson, ApiRecord } from "@/types/api";

export const Route = createFileRoute("/assessment")({ component: AssessmentPage });

type AssessmentAnswer = ApiRecord & {
  selected_options: string[];
  long_answer: string;
};

function AssessmentPage() {
  const { currentUser } = useAuth();
  const [sessionId, setSessionId] = useState("");
  const [answers, setAnswers] = useState<Record<string, AssessmentAnswer>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const quiz = useGenerateQuiz({ learner_id: currentUser?.id ?? "", session_id: sessionId });
  const submit = useSubmitAssessment();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSessionId(window.localStorage.getItem("evolved.currentLessonSession") ?? "");
  }, []);

  function submitQuiz() {
    if (!currentUser || !quiz.data) return;
    submit.mutate({ learner_id: currentUser.id, session_id: quiz.data.session_id, answers, confidence });
  }

  const questions = quiz.data?.questions ?? [];
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
          <button
            type="button"
            onClick={submitQuiz}
            disabled={submit.isPending || questions.some((question, index) => !answerComplete(answers[questionId(question, index)]))}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background disabled:opacity-50"
          >
            {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Submit and evolve my next lesson
          </button>
          {submit.isError && <p className="text-sm text-destructive">{submit.error.message}</p>}
          {submit.data && (
            <div className="rounded-3xl border border-plum/20 bg-plum/[0.04] p-6">
              <div className="text-[10px] uppercase tracking-[0.22em] text-plum">Learner model updated</div>
              <div className="mt-2 font-display text-4xl">{Math.round(submit.data.score * 100)}%</div>
              <p className="mt-3 text-sm leading-relaxed">{submit.data.detailed_feedback}</p>
              <p className="mt-3 text-sm text-muted-foreground">Next-lesson adaptation: {textValue(submit.data.adaptation.action) || "Teaching strategy recalibrated from this result."}</p>
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

  function toggleOption(option: string) {
    const selectedOptions = answer.selected_options.includes(option)
      ? answer.selected_options.filter((item) => item !== option)
      : [...answer.selected_options, option];
    onAnswer({ ...answer, selected_options: selectedOptions });
  }

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Question {index + 1} - Multiple select + long answer</div>
      <h2 className="mt-3 font-display text-2xl">{textValue(question.prompt)}</h2>
      {visual?.imageUrl && (
        <img
          src={visual.imageUrl}
          alt={visual.title || textValue(question.prompt) || `Question ${index + 1} visual`}
          className="mt-5 max-h-[520px] w-full rounded-2xl border border-border bg-background object-contain"
        />
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
                {option}
              </button>
            );
          })}
        </div>
      </div>
      <label className="mt-5 block text-xs font-medium text-muted-foreground">
        {textValue(question.long_answer_prompt) || "Explain your reasoning in 3 to 6 sentences"}
        <textarea
          value={answer.long_answer}
          onChange={(event) => onAnswer({ ...answer, long_answer: event.target.value })}
          className="mt-2 min-h-36 w-full rounded-2xl border border-input bg-background p-4 text-base leading-7 outline-none focus:border-plum"
          placeholder="Write your answer and reasoning"
        />
      </label>
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

function answerComplete(answer: AssessmentAnswer | undefined) {
  return Boolean(answer && answer.selected_options.length > 0 && answer.long_answer.trim().length >= 20);
}

function questionId(question: ApiRecord, index: number) {
  return textValue(question.id) || `question-${index + 1}`;
}

function optionsFromQuestion(question: ApiRecord) {
  const options = arrayValue(question.options).map(String).filter(Boolean);
  return options.length > 0 ? options : ["I can identify the concept", "I can use the diagram", "I can explain the reasoning", "I need to review this"];
}

function visualFromQuestion(question: ApiRecord): { imageUrl?: string; title?: string; description?: string } | null {
  const visual = question.visual_asset ?? question.visualAsset ?? question.diagram;
  if (typeof visual !== "object" || visual === null || Array.isArray(visual)) return null;
  const record = visual as ApiRecord;
  return {
    imageUrl: textValue(record.imageUrl),
    title: textValue(record.title),
    description: textValue(record.description),
  };
}

function arrayValue(value: ApiJson | undefined) {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
