import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Sparkles, MessageCircle, Lightbulb, ChevronRight, BookMarked, Play, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useLesson } from "@/hooks/useLesson";
import type { ApiJson, ApiRecord } from "@/types/api";

export const Route = createFileRoute("/lesson")({
  head: () => ({
    meta: [
      { title: "Lesson — EvolvED" },
      { name: "description", content: "An adaptive lesson composed in real time by EvolvED." },
    ],
  }),
  component: LessonPage,
});

function LessonPage() {
  const [hintOpen, setHintOpen] = useState(false);
  const { currentUser } = useAuth();
  const topic = "Derivatives";
  const lesson = useLesson({
    learner_id: currentUser?.id ?? "",
    topic,
    constraints: { modality: "visual-first", pace: "short working memory windows" },
  });
  const sections = lesson.data?.lesson_structure ?? [];

  return (
    <AppShell title={lesson.data ? `${topic}, adaptively` : "Generating lesson"} subtitle={`${currentUser?.fullName ?? "Learner"} · generated from the EvolvED backend.`} accent={lesson.isFetching ? "Composing" : "Live"}>
      <div className="grid xl:grid-cols-[1fr_360px] gap-8">
        <article className="min-w-0">
          {/* Progress rail */}
          <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
            {lesson.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-28 rounded-full" />)
            ) : sections.length > 0 ? (
              sections.map((s, i) => (
              <div key={getSectionKey(s, i)} className={`flex items-center gap-2 shrink-0 px-3 py-1.5 rounded-full border text-xs ${i === 0 ? "bg-foreground text-background border-transparent" : i < 2 ? "border-border text-muted-foreground" : "border-dashed border-border text-muted-foreground/70"}`}>
                {i < 2 && <CheckCircle2 className="size-3" />}
                <span>{i + 1}. {getSectionTitle(s, i)}</span>
              </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No lesson sections returned yet.</div>
            )}
          </div>

          {lesson.isLoading && <LessonSkeleton />}
          {lesson.isError && (
            <ErrorPanel message={lesson.error.message} onRetry={() => void lesson.refetch()} />
          )}
          {lesson.data && (
            <>
              <Reveal>
                <h2 className="font-display text-2xl md:text-3xl leading-tight mb-4">Lesson blueprint</h2>
                <p className="font-reading text-lg leading-relaxed text-foreground/85 mb-6">
                  Estimated duration: {lesson.data.estimated_lesson_duration || "not specified"} minutes · modalities:{" "}
                  {lesson.data.modality_sequence.join(", ") || "adaptive"}
                </p>
              </Reveal>

              <Reveal delay={0.1}>
            <figure className="my-8 rounded-3xl overflow-hidden border border-border bg-card">
              <CurveZoom />
              <figcaption className="px-5 py-3 text-xs text-muted-foreground border-t border-border flex items-center justify-between">
                <span>Fig. 1 · Visual support for {topic}</span>
                <button className="flex items-center gap-1.5 text-foreground hover:text-plum">
                  <Play className="size-3" /> Replay
                </button>
              </figcaption>
            </figure>
              </Reveal>

              {lesson.data.lesson_structure.map((section, i) => (
                <Reveal key={getSectionKey(section, i)} delay={0.12 + i * 0.05}>
                  <div className="rounded-2xl p-6 border border-border bg-muted/30 my-8">
                    <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-3 flex items-center gap-2">
                      <BookMarked className="size-3" /> Section {i + 1}
                    </div>
                    <h3 className="font-display text-xl mb-3">{getSectionTitle(section, i)}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{sectionToText(section)}</p>
                  </div>
                </Reveal>
              ))}

          <Reveal delay={0.4}>
            <div className="rounded-3xl border border-border p-6 my-8 relative overflow-hidden">
              <div className="absolute -top-32 -right-32 size-64 rounded-full opacity-20" style={{ backgroundImage: "var(--gradient-aurora)", filter: "blur(40px)" }} />
              <div className="relative">
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">Your turn · 1 of 3</div>
                <h3 className="font-display text-xl mb-4">Estimate <Eq>f'(3)</Eq> for <Eq>f(x) = x^2</Eq>.</h3>
                <div className="grid sm:grid-cols-2 gap-2 mb-4">
                  {["3", "6", "9", "x²"].map((c) => (
                    <button key={c} className="text-left px-4 py-3 rounded-xl border border-border bg-card hover:border-plum/60 transition-colors font-display">
                      {c}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <button onClick={() => setHintOpen(true)} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                    <Lightbulb className="size-3.5 text-gold" /> Hint
                  </button>
                  <div className="flex items-center gap-2 ml-auto text-muted-foreground">
                    <span>Confidence</span>
                    <input type="range" defaultValue={70} className="accent-plum w-32" />
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          <AnimatePresence>
            {hintOpen && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-gold/40 bg-gold/5 p-5 mb-8">
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2 flex items-center gap-2">
                  <Lightbulb className="size-3 text-gold" /> Adaptive hint · scaffolded
                </div>
                <p className="text-sm leading-relaxed">
                  Notice the pattern from Fig. 1: at <Eq>x = 2</Eq> the slope was <Eq>4</Eq>. What was the relationship between the input and the slope?
                </p>
              </motion.div>
            )}
          </AnimatePresence>
            </>
          )}
        </article>

        {/* Tutor */}
        <aside className="xl:sticky xl:top-20 h-fit">
          <div className="rounded-3xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <div className="size-8 rounded-full grid place-items-center" style={{ backgroundImage: "var(--gradient-aurora)" }}>
                <Sparkles className="size-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-medium">Tutor</div>
                <div className="text-[10px] text-muted-foreground">Strategy · Worked example → Practice</div>
              </div>
            </div>
            <div className="p-5 space-y-4 text-sm">
              <TutorMsg>
                {lesson.data ? "I generated this lesson from the current backend blueprint and will adapt as assessment signals arrive." : "I am waiting for the backend lesson blueprint."}
              </TutorMsg>
              <TutorMsg me>
                Why <Eq>4</Eq> and not <Eq>2x</Eq>?
              </TutorMsg>
              <TutorMsg>
                Both are right — <Eq>4</Eq> is the slope <em>at that exact point</em>, and <Eq>2x</Eq> is the formula for every point. We'll unify them next.
              </TutorMsg>
              <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                <MessageCircle className="size-4 text-muted-foreground" />
                <input placeholder="Ask anything about this lesson…" className="flex-1 bg-transparent outline-none text-sm" />
                <ChevronRight className="size-4 text-muted-foreground" />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-border p-5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">Why this, why now</div>
            <ul className="space-y-2.5 text-xs text-foreground/80">
              {(lesson.data?.interaction_points ?? []).slice(0, 3).map((point, i) => (
                <li key={i} className="flex gap-2"><span className="text-plum">·</span>{sectionToText(point)}</li>
              ))}
              {lesson.data?.interaction_points.length === 0 && <li className="text-muted-foreground">No interaction rationale returned.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function LessonSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-3xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-rose/30 bg-rose/5 p-5">
      <div className="font-medium">Lesson could not be generated</div>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <button onClick={onRetry} className="mt-4 rounded-full bg-foreground px-4 py-2 text-sm text-background">
        Try again
      </button>
    </div>
  );
}

function getSectionKey(section: ApiRecord, index: number) {
  const id = section.id;
  return typeof id === "string" ? id : `section-${index}`;
}

function getSectionTitle(section: ApiRecord, index: number) {
  for (const key of ["title", "heading", "name", "type", "concept"]) {
    const value = section[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return `Learning step ${index + 1}`;
}

function sectionToText(value: ApiJson): string {
  if (value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(sectionToText).filter(Boolean).join(" ");
  }
  return Object.entries(value)
    .filter(([key]) => !["id", "title", "heading", "name"].includes(key))
    .map(([key, entry]) => `${key}: ${sectionToText(entry)}`)
    .filter((text) => text.trim().length > 0)
    .join(" ");
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}

function Eq({ children }: { children: React.ReactNode }) {
  return <span className="font-display italic text-foreground">{children}</span>;
}

function TutorMsg({ children, me }: { children: React.ReactNode; me?: boolean }) {
  return (
    <div className={`flex ${me ? "justify-end" : ""}`}>
      <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 leading-relaxed ${me ? "bg-foreground text-background" : "bg-muted/50"}`}>
        {children}
      </div>
    </div>
  );
}

function CurveZoom() {
  return (
    <svg viewBox="0 0 600 260" className="w-full h-auto block">
      <defs>
        <linearGradient id="cv" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="oklch(0.45 0.18 300)" />
          <stop offset="1" stopColor="oklch(0.74 0.22 330)" />
        </linearGradient>
      </defs>
      {[0,1,2].map(i => (
        <g key={i} transform={`translate(${i * 200}, 0)`}>
          <rect x="0" y="0" width="200" height="260" fill="oklch(0.97 0.008 75)" />
          <line x1="0" y1="200" x2="200" y2="200" stroke="oklch(0.88 0.012 75)" />
          <line x1="100" y1="0" x2="100" y2="260" stroke="oklch(0.88 0.012 75)" />
          {/* curve, increasingly straight */}
          <motion.path
            d={i === 0
              ? "M10,240 Q100,40 190,240"
              : i === 1
              ? "M20,220 Q100,110 180,30"
              : "M20,210 L180,30"}
            fill="none" stroke="url(#cv)" strokeWidth="2.5"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, delay: i * 0.3 }}
          />
          <circle cx={i === 0 ? 130 : i === 1 ? 120 : 110} cy={i === 0 ? 110 : i === 1 ? 90 : 100} r="4" fill="oklch(0.82 0.15 80)" />
          <text x="10" y="20" fontSize="10" fill="oklch(0.48 0.02 265)" fontFamily="monospace">×{Math.pow(10, i)}</text>
        </g>
      ))}
    </svg>
  );
}
