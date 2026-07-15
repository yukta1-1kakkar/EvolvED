import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Accessibility, ArrowRight, BookOpen, Check, Loader2, RotateCcw, Sparkles, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { MathText } from "@/components/learning/MathText";
import { VectorArrowDiagram } from "@/components/learning/VectorArrowDiagram";
import { isVectorVisualText } from "@/components/learning/vectorVisual";
import { useGenerateQuiz, useSubmitAssessment } from "@/hooks/useAssessment";
import { useAuth } from "@/hooks/useAuth";
import { useAdaptivePageTimer } from "@/hooks/useAdaptivePageTimer";
import { getStudentClassroom, recordPublishedContentPageTiming, startPublishedContent, type StudentClassAlert } from "@/lib/api/classroom";
import { completeActiveRoadmapLesson, prepareNextRoadmapLessonContext } from "@/lib/lesson-progress";
import type { ApiJson, ApiRecord } from "@/types/api";

export const Route = createFileRoute("/assessment")({
  validateSearch: (search) => ({
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
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
  if (currentUser?.accountType === "class_student") {
    return <PublishedAssessmentPage learnerId={currentUser.id} />;
  }
  return <AdaptiveAssessmentPage />;
}

function AdaptiveAssessmentPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState("");
  const [answers, setAnswers] = useState<Record<string, AssessmentAnswer>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [readerMode, setReaderMode] = useState<ReaderMode>(() => currentUser?.accessibilitySupport ? "dyslexia" : "standard");
  const [pageIndex, setPageIndex] = useState(0);
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

  useEffect(() => {
    setPageIndex(0);
  }, [quiz.data?.quiz_id]);

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
    setPageIndex(0);
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
  const currentQuestion = questions[pageIndex];
  const currentQuestionId = currentQuestion ? questionId(currentQuestion, pageIndex) : "";
  const isLastQuestion = questions.length > 0 && pageIndex === questions.length - 1;
  useAdaptivePageTimer({
    learnerId: currentUser?.id ?? "",
    sessionId,
    pageKey: currentQuestion ? `assessment-question-${pageIndex + 1}` : "",
    pageTitle: currentQuestion ? `Question ${pageIndex + 1}` : "",
    pageKind: "assessment",
    enabled: Boolean(currentQuestion && !submit.data),
  });
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
              {!submit.data && currentQuestion && (
                <>
                  <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3 text-sm">
                    <span className="text-muted-foreground">Question {pageIndex + 1} of {questions.length}</span>
                  </div>
                  <QuestionCard
                    key={currentQuestionId}
                    question={currentQuestion}
                    index={pageIndex}
                    answer={answers[currentQuestionId] ?? emptyAnswer()}
                    confidence={confidence[currentQuestionId] ?? 70}
                    onAnswer={(value) => setAnswers((current) => ({ ...current, [currentQuestionId]: value }))}
                    onConfidence={(value) => setConfidence((current) => ({ ...current, [currentQuestionId]: value }))}
                  />
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
                    <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))} className="rounded-full border border-border px-5 py-2.5 text-sm disabled:opacity-50">Previous</button>
                    {isLastQuestion ? (
                      <button type="button" onClick={submitQuiz} disabled={!canSubmit} title={submitHint} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background disabled:opacity-50">
                        {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Submit and evaluate
                      </button>
                    ) : (
                      <button type="button" disabled={!answerComplete(answers[currentQuestionId])} onClick={() => setPageIndex((value) => Math.min(questions.length - 1, value + 1))} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background disabled:opacity-50">
                        Next question <ArrowRight className="size-4" />
                      </button>
                    )}
                  </div>
                  {isLastQuestion && !canSubmit && !submit.isPending && <p className="text-xs text-muted-foreground">{submitHint}</p>}
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

function PublishedAssessmentPage({ learnerId }: { learnerId: string }) {
  const { draft } = Route.useSearch();
  const classroom = useQuery({
    queryKey: ["student-classroom", learnerId],
    queryFn: () => getStudentClassroom(learnerId),
  });
  const assessments = (classroom.data?.alerts ?? []).filter((item) => item.kind === "assessment" && !item.completed);
  const selected = assessments.find((item) => item.draft_id === draft) ?? assessments[0];

  return (
    <AppShell title="Published assessments" subtitle="Only assessments accepted and published by your teacher appear here." accent={classroom.isFetching ? "Syncing" : "Teacher approved"}>
      {classroom.isLoading && <p className="text-sm text-muted-foreground">Loading published assessments...</p>}
      {classroom.isError && <p className="text-sm text-destructive">{classroom.error.message}</p>}
      {!classroom.isLoading && !selected && (
        <div className="grid min-h-48 place-items-center rounded-2xl border border-border bg-card text-sm text-muted-foreground">
          No new assessments have been published.
        </div>
      )}
      {selected && <PublishedAssessment alert={selected} assessments={assessments} learnerId={learnerId} />}
    </AppShell>
  );
}

function PublishedAssessment({ alert, assessments, learnerId }: { alert: StudentClassAlert; assessments: StudentClassAlert[]; learnerId: string }) {
  const questions = arrayValue(alert.published_content.questions).filter((item): item is ApiRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  const presentation = recordValue(alert.published_content.learner_presentation);
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<Record<string, AssessmentAnswer>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [readerMode, setReaderMode] = useState<ReaderMode>("standard");
  const [pageIndex, setPageIndex] = useState(0);
  const normalizedQuestions = questions.map((question) => ({ ...question, prompt: question.prompt ?? question.question }));
  const currentQuestion = normalizedQuestions[pageIndex];
  const currentQuestionId = currentQuestion ? questionId(currentQuestion, pageIndex) : "";
  const isLastQuestion = normalizedQuestions.length > 0 && pageIndex >= normalizedQuestions.length - 1;
  const submit = useSubmitAssessment();
  const queryClient = useQueryClient();

  useEffect(() => {
    void startPublishedContent(learnerId, alert.draft_id).catch((error) => {
      console.error("Could not record published assessment start", error);
    });
    setPageIndex(0);
  }, [alert.draft_id, learnerId]);

  usePublishedAssessmentPageTimer({
    learnerId,
    draftId: alert.draft_id,
    pageKey: currentQuestion ? `assessment-question-${pageIndex + 1}` : "assessment-intro",
    pageTitle: currentQuestion ? `Question ${pageIndex + 1}` : alert.title,
  });

  useEffect(() => {
    if (!submit.data) return;
    void queryClient.invalidateQueries({ queryKey: ["student-classroom", learnerId] });
    void navigate({ to: "/results" });
  }, [learnerId, navigate, queryClient, submit.data]);

  function submitQuiz() {
    submit.mutate({
      learner_id: learnerId,
      session_id: `published:${alert.draft_id}`,
      answers,
      confidence,
    });
  }

  function readCurrentQuestion() {
    if (!currentQuestion || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const prompt = textValue(currentQuestion.prompt);
    const options = questionRequirements(currentQuestion).needsOptions ? arrayValue(currentQuestion.options).map(String).join(". ") : "";
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(`${prompt}. ${options}`));
  }

  if (submit.data) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-border bg-card p-8">
        <div className="flex items-center gap-3 font-display text-2xl">
          <Check className="size-6 text-emerald-600" />
          Submitted
        </div>
      </div>
    );
  }

  return (
    <div className={readerModeClass(readerMode)}>
      <div className="max-w-5xl space-y-4">
        <ReaderControls mode={readerMode} onChange={setReaderMode} />
        <section className="rounded-2xl border border-plum/20 bg-plum/5 p-4" aria-label="Personalized assessment presentation">
          <div className="text-xs uppercase tracking-[0.16em] text-plum">Your assessment format</div>
          <div className="mt-2 flex flex-wrap gap-2 text-sm font-medium">
            <span className="rounded-full bg-background px-3 py-1">{textValue(presentation.pace_label) || "Balanced"}</span>
            <span className="rounded-full bg-background px-3 py-1">{textValue(presentation.modality_label) || "Detailed written explanations"}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{textValue(presentation.pace_guidance)} {textValue(presentation.modality_guidance)}</p>
        </section>
        {assessments.length > 1 && (
          <nav className="flex flex-wrap gap-2" aria-label="Published assessments">
            {assessments.map((assessment) => (
              <Link key={assessment.draft_id} to="/assessment" search={{ draft: assessment.draft_id }} className={`rounded-full border px-4 py-2 text-sm ${assessment.draft_id === alert.draft_id ? "border-plum bg-plum/10 text-plum" : "border-border"}`}>
                {assessment.title}
              </Link>
            ))}
          </nav>
        )}
        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-plum">{alert.class_name} · Published by {alert.leader_name}</div>
              <h2 className="mt-2 font-display text-3xl">{alert.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{textValue(alert.published_content.fairness)}</p>
            </div>
            <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              Question {Math.min(pageIndex + 1, Math.max(1, normalizedQuestions.length))} of {normalizedQuestions.length}
            </div>
            {textValue(presentation.modality) === "audio" && currentQuestion && (
              <button type="button" onClick={readCurrentQuestion} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
                <Volume2 className="size-3.5" /> Read question aloud
              </button>
            )}
          </div>
        </section>
        {currentQuestion && (
          <>
            <QuestionCard
              key={currentQuestionId}
              question={currentQuestion}
              index={pageIndex}
              answer={answers[currentQuestionId] ?? emptyAnswer()}
              confidence={confidence[currentQuestionId] ?? 70}
              onAnswer={(value) => setAnswers((current) => ({ ...current, [currentQuestionId]: value }))}
              onConfidence={(value) => setConfidence((current) => ({ ...current, [currentQuestionId]: value }))}
            />
            <div className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))} className="rounded-full border border-border px-5 py-2.5 text-sm disabled:opacity-50">
                Previous
              </button>
              <div className="text-sm text-muted-foreground">Answer this question to continue.</div>
              <button type="button" disabled={!publishedAnswerComplete(currentQuestion, answers[currentQuestionId]) || isLastQuestion} onClick={() => setPageIndex((value) => Math.min(normalizedQuestions.length - 1, value + 1))} className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background disabled:opacity-50">
                Next question <ArrowRight className="size-4" />
              </button>
            </div>
          </>
        )}
        {normalizedQuestions.length > 0 && (
          <button type="button" onClick={submitQuiz} disabled={!isLastQuestion || normalizedQuestions.some((question, index) => !publishedAnswerComplete(question, answers[questionId(question, index)])) || submit.isPending} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background disabled:opacity-50">
            {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Submit published assessment
          </button>
        )}
        {submit.isError && <p className="text-sm text-destructive">{submit.error.message}</p>}
      </div>
    </div>
  );

  return (
    <div className={readerModeClass(readerMode)}>
      <div className="max-w-5xl space-y-4">
        <ReaderControls mode={readerMode} onChange={setReaderMode} />
        {assessments.length > 1 && (
          <nav className="flex flex-wrap gap-2" aria-label="Published assessments">
            {assessments.map((assessment) => (
              <Link key={assessment.draft_id} to="/assessment" search={{ draft: assessment.draft_id }} className={`rounded-full border px-4 py-2 text-sm ${assessment.draft_id === alert.draft_id ? "border-plum bg-plum/10 text-plum" : "border-border"}`}>
                {assessment.title}
              </Link>
            ))}
          </nav>
        )}
        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="text-xs uppercase tracking-[0.16em] text-plum">{alert.class_name} · Published by {alert.leader_name}</div>
          <h2 className="mt-2 font-display text-3xl">{alert.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{textValue(alert.published_content.fairness)}</p>
        </section>
        {questions.map((question, index) => {
          const normalized = { ...question, prompt: question.prompt ?? question.question };
          const id = questionId(normalized, index);
          return (
            <QuestionCard
              key={id}
              question={normalized}
              index={index}
              answer={answers[id] ?? emptyAnswer()}
              confidence={confidence[id] ?? 70}
              onAnswer={(value) => setAnswers((current) => ({ ...current, [id]: value }))}
              onConfidence={(value) => setConfidence((current) => ({ ...current, [id]: value }))}
            />
          );
        })}
        {questions.length > 0 && (
          <button type="button" onClick={submitQuiz} disabled={questions.some((question, index) => !publishedAnswerComplete(question, answers[questionId(question, index)])) || submit.isPending} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background disabled:opacity-50">
            {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Submit published assessment
          </button>
        )}
        {submit.isError && <p className="text-sm text-destructive">{submit.error.message}</p>}
      </div>
    </div>
  );
}

type ReaderMode = "standard" | "dyslexia" | "focus";

function usePublishedAssessmentPageTimer({ learnerId, draftId, pageKey, pageTitle }: { learnerId: string; draftId: string; pageKey: string; pageTitle: string }) {
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    startedAtRef.current = Date.now();
    function flush() {
      const now = Date.now();
      const secondsSpent = (now - startedAtRef.current) / 1000;
      startedAtRef.current = now;
      if (secondsSpent < 1) return;
      void recordPublishedContentPageTiming({
        learnerId,
        draftId,
        pageKey,
        pageTitle,
        secondsSpent,
      }).catch((error) => {
        console.error("Could not record published assessment page timing", error);
      });
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flush();
      else startedAtRef.current = Date.now();
    }
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [draftId, learnerId, pageKey, pageTitle]);
}

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
  const requirements = questionRequirements(question);
  const options = requirements.needsOptions ? optionsFromQuestion(question) : [];
  const visual = visualFromQuestion(question);
  const needsOption = requirements.needsOptions && answer.selected_options.length === 0;
  const answerLength = answer.long_answer.trim().length;
  const needsLongAnswer = requirements.needsLongAnswer && answerLength < MIN_LONG_ANSWER_CHARS;

  function toggleOption(option: string) {
    const selectedOptions = requirements.singleOption
      ? [option]
      : answer.selected_options.includes(option)
      ? answer.selected_options.filter((item) => item !== option)
      : [...answer.selected_options, option];
    onAnswer({ ...answer, selected_options: selectedOptions });
  }

  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Question {index + 1} - {requirements.label}</div>
      <MathText as="h2" className="mt-3 font-display text-2xl" text={textValue(question.prompt)} />
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
        </figure>
      )}
      {requirements.needsOptions && <div className="mt-5">
        <div className="text-xs font-medium text-muted-foreground">{requirements.singleOption ? "Select one answer" : "Select all correct choices"}</div>
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
      </div>}
      {requirements.needsLongAnswer && <label className="mt-5 block">
        <textarea
          value={answer.long_answer}
          onChange={(event) => onAnswer({ ...answer, long_answer: event.target.value })}
          className="mt-2 min-h-36 w-full rounded-2xl border border-input bg-background p-4 text-base leading-7 outline-none focus:border-plum"
          placeholder="Write your answer and reasoning"
        />
      </label>}
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

function publishedAnswerComplete(question: ApiRecord, answer: AssessmentAnswer | undefined) {
  if (!answer) return false;
  const requirements = questionRequirements(question);
  return (!requirements.needsOptions || answer.selected_options.length > 0)
    && (!requirements.needsLongAnswer || answer.long_answer.trim().length >= MIN_LONG_ANSWER_CHARS);
}

function questionRequirements(question: ApiRecord) {
  const type = textValue(question.type).trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (type === "short_answer") return { needsOptions: false, needsLongAnswer: true, singleOption: false, label: "Short answer" };
  if (type === "mcq" || type === "multiple_choice") return { needsOptions: true, needsLongAnswer: false, singleOption: true, label: "Multiple choice" };
  return { needsOptions: true, needsLongAnswer: true, singleOption: false, label: "Multiple select + long answer" };
}

function questionId(question: ApiRecord, index: number) {
  return textValue(question.id) || `question-${index + 1}`;
}

function optionsFromQuestion(question: ApiRecord) {
  return arrayValue(question.options).map(String).filter(Boolean);
}

function visualFromQuestion(question: ApiRecord): { imageUrl?: string; title?: string; description?: string; data?: unknown; isVector?: boolean } | null {
  const visual = question.visual_asset ?? question.visualAsset ?? question.diagram;
  if (typeof visual !== "object" || visual === null || Array.isArray(visual)) return vectorVisualFromQuestionText(question);
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

function vectorVisualFromQuestionText(question: ApiRecord) {
  const prompt = textValue(question.prompt);
  const options = questionRequirements(question).needsOptions ? optionsFromQuestion(question).join(" ") : "";
  const text = `${prompt} ${options}`;
  const coordinateCount = text.match(/\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/g)?.length ?? 0;
  if (coordinateCount < 2 || !/\b(diagram|arrow|vector)\b/i.test(text) || !isVectorVisualText(text)) return null;
  return {
    title: "Vector diagram",
    description: prompt,
    data: [prompt],
    isVector: true,
  };
}

function arrayValue(value: ApiJson | undefined) {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: ApiJson | undefined): ApiRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
