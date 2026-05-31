import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Check, X, ArrowRight, Sparkles } from "lucide-react";
import { useSubmitAssessment } from "@/hooks/useAssessment";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/assessment")({
  head: () => ({
    meta: [
      { title: "Assessment — EvolvED" },
      { name: "description", content: "Adaptive quizzes that listen to how confident you feel, not just whether you're right." },
    ],
  }),
  component: AssessPage,
});

const questions = [
  {
    q: "If f(x) = x², what is f′(2)?",
    options: ["2", "4", "x²", "2x"],
    correct: 1,
    explain: "f′(x) = 2x, so f′(2) = 4. The derivative at a point is a number; the derivative as a function is 2x.",
  },
  {
    q: "Which strategy best fits a 'rate of change' word problem?",
    options: ["Substitute and simplify", "Set up f(x), differentiate, evaluate", "Integrate first, then solve", "Use the chain rule directly"],
    correct: 1,
    explain: "Translate the situation into a function, differentiate, then evaluate at the requested instant.",
  },
];

function AssessPage() {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [conf, setConf] = useState(70);
  const { currentUser } = useAuth();
  const submitAssessment = useSubmitAssessment();
  const q = questions[i];

  const next = () => { setPicked(null); setI((i + 1) % questions.length); };
  const answer = (idx: number) => {
    setPicked(idx);
    submitAssessment.mutate({
      learner_id: currentUser?.id ?? "",
      session_id: "frontend-checkpoint",
      answers: {
        question: q.q,
        selected_answer: q.options[idx],
        selected_index: idx,
        correct_index: q.correct,
        confidence: conf,
      },
    });
  };

  return (
    <AppShell title="Checkpoint" subtitle="Adaptive · weighted by confidence" accent={submitAssessment.isPending ? "Submitting" : "Calibrating"}>
      <div className="grid lg:grid-cols-[1fr_300px] gap-8">
        <div>
          {/* progress */}
          <div className="flex gap-1.5 mb-8">
            {[...Array(5)].map((_, k) => (
              <div key={k} className={`h-1 flex-1 rounded-full ${k <= i ? "bg-foreground" : "bg-border"}`} />
            ))}
          </div>

          <motion.div key={i} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-border bg-card p-8 md:p-10">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-4">Question {i + 1} · Derivatives</div>
            <h2 className="font-display text-2xl md:text-3xl leading-snug mb-8 text-balance">{q.q}</h2>

            <div className="space-y-2.5">
              {q.options.map((opt, idx) => {
                const isPicked = picked === idx;
                const showResult = picked !== null;
                const isCorrect = idx === q.correct;
                return (
                  <button key={opt} disabled={picked !== null || submitAssessment.isPending} onClick={() => answer(idx)}
                    className={`group w-full text-left px-5 py-4 rounded-2xl border transition-all flex items-center gap-3 ${
                      showResult && isCorrect ? "border-emerald-500/40 bg-emerald-500/5" :
                      showResult && isPicked && !isCorrect ? "border-rose/40 bg-rose/5" :
                      isPicked ? "border-foreground bg-foreground/5" :
                      "border-border hover:border-plum/50"
                    }`}>
                    <span className="size-7 rounded-full border border-border grid place-items-center text-xs font-mono">{String.fromCharCode(65 + idx)}</span>
                    <span className="font-display flex-1">{opt}</span>
                    {showResult && isCorrect && <Check className="size-4 text-emerald-600" />}
                    {showResult && isPicked && !isCorrect && <X className="size-4 text-rose" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-8 rounded-2xl bg-muted/40 px-5 py-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-muted-foreground">How confident are you?</span>
                <span className="font-mono tabular-nums">{conf}%</span>
              </div>
              <input type="range" min={0} max={100} value={conf} onChange={(e) => setConf(+e.target.value)}
                className="w-full accent-plum" />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>guessing</span><span>sure</span>
              </div>
            </div>

            <AnimatePresence>
              {picked !== null && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="mt-6 rounded-2xl p-5 border border-border bg-gradient-to-br from-orchid/5 to-gold/5">
                    <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2 flex items-center gap-2">
                      <Sparkles className="size-3 text-gold" /> Why this matters
                    </div>
                    <p className="text-sm leading-relaxed">{q.explain}</p>
                    <button onClick={next} className="mt-4 inline-flex items-center gap-1.5 text-sm rounded-full bg-foreground text-background px-4 py-2 hover:opacity-90">
                      Next question <ArrowRight className="size-3.5" />
                    </button>
                    {submitAssessment.isError && (
                      <div className="mt-3 rounded-xl border border-rose/30 bg-rose/5 p-3 text-xs text-muted-foreground">
                        {submitAssessment.error.message}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-border p-5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">Live mastery delta</div>
            {[
              ["Derivatives", "+0.06", true],
              ["Limits", "+0.02", true],
              ["Chain rule", "−0.01", false],
            ].map(([k, v, up]) => (
              <div key={k as string} className="flex items-center justify-between py-1.5 text-sm">
                <span>{k}</span>
                <span className={`font-mono tabular-nums ${up ? "text-emerald-600" : "text-rose"}`}>{v}</span>
              </div>
            ))}
          </div>
          <div className="rounded-3xl border border-border p-5 bg-card">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">Adaptation</div>
            <p className="text-sm text-foreground/85 leading-relaxed">
              {submitAssessment.data ? "Assessment submitted to the backend. Mastery estimates are reflected as they return." : "Your answer will be sent to the backend assessment endpoint."}
            </p>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
