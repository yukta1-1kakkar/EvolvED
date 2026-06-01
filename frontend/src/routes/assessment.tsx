import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { useGenerateQuiz, useSubmitAssessment } from "@/hooks/useAssessment";
import { useAuth } from "@/hooks/useAuth";
import { useLesson } from "@/hooks/useLesson";
import type { ApiRecord } from "@/types/api";

export const Route = createFileRoute("/assessment")({ component: AssessmentPage });

function AssessmentPage() {
  const { currentUser } = useAuth();
  const lesson = useLesson({
    learner_id: currentUser?.id ?? "",
    topic: currentUser?.learningTopic ?? "",
    project_context: currentUser?.learningProject ?? defaultProject(currentUser?.learningTopic),
  });
  const quiz = useGenerateQuiz({ learner_id: currentUser?.id ?? "", session_id: lesson.data?.lesson_id ?? "" });
  const submit = useSubmitAssessment();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});

  function submitQuiz() {
    if (!currentUser || !quiz.data) return;
    submit.mutate({ learner_id: currentUser.id, session_id: quiz.data.session_id, answers, confidence });
  }

  const questions = quiz.data?.questions ?? [];
  return (
    <AppShell title="Adaptive assessment" subtitle="A generated quiz that updates your learner model and shapes the next lesson." accent={submit.isPending ? "Evolving" : "Adaptive"}>
      {(lesson.isLoading || quiz.isLoading) && <p className="text-sm text-muted-foreground">Generating a quiz from your current lesson...</p>}
      {(lesson.isError || quiz.isError) && <p className="text-sm text-destructive">{lesson.error?.message ?? quiz.error?.message}</p>}
      {questions.length > 0 && (
        <div className="max-w-4xl space-y-4">
          {questions.map((question, index) => (
            <QuestionCard key={questionId(question, index)} question={question} index={index} answer={answers[questionId(question, index)] ?? ""} confidence={confidence[questionId(question, index)] ?? 70} onAnswer={(value) => setAnswers((current) => ({ ...current, [questionId(question, index)]: value }))} onConfidence={(value) => setConfidence((current) => ({ ...current, [questionId(question, index)]: value }))} />
          ))}
          <button onClick={submitQuiz} disabled={submit.isPending || questions.some((question, index) => !(answers[questionId(question, index)] ?? "").trim())} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background disabled:opacity-50">
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

function QuestionCard({ question, index, answer, confidence, onAnswer, onConfidence }: { question: ApiRecord; index: number; answer: string; confidence: number; onAnswer: (value: string) => void; onConfidence: (value: number) => void }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Question {index + 1} · {textValue(question.type) || "Reasoning"}</div>
      <h2 className="mt-3 font-display text-xl">{textValue(question.prompt)}</h2>
      {Array.isArray(question.options) && <div className="mt-4 grid gap-2 sm:grid-cols-2">{question.options.map((option) => <button key={String(option)} type="button" onClick={() => onAnswer(String(option))} className={`rounded-xl border px-4 py-3 text-left text-sm ${answer === String(option) ? "border-plum bg-plum/[0.06]" : "border-border"}`}>{String(option)}</button>)}</div>}
      {!Array.isArray(question.options) && <textarea value={answer} onChange={(event) => onAnswer(event.target.value)} className="mt-4 min-h-28 w-full rounded-2xl border border-input bg-background p-4 text-sm outline-none focus:border-plum" placeholder="Write your answer and reasoning" />}
      <label className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">Confidence <input type="range" min="0" max="100" value={confidence} onChange={(event) => onConfidence(Number(event.target.value))} className="accent-plum" /><span>{confidence}%</span></label>
    </section>
  );
}

function questionId(question: ApiRecord, index: number) {
  return textValue(question.id) || `question-${index + 1}`;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function defaultProject(topic?: string) {
  return topic ? `Build a practical ${topic} mini project` : "";
}
