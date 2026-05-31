import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { Brain, Sparkles, BookOpen, Target, Infinity as Inf, Compass } from "lucide-react";

const chapters = [
  {
    id: "intelligence",
    chapter: "I",
    eyebrow: "Adaptive Intelligence",
    title: "Begins by understanding you.",
    body: "Every learner has a fingerprint — pace, prior knowledge, misconceptions, what makes a concept finally click. EvolvED builds and refines this model from the first question you ask.",
    icon: Brain,
    visual: <LearnerModelVisual />,
  },
  {
    id: "pedagogy",
    chapter: "II",
    eyebrow: "Pedagogical Reasoning",
    title: "Thinks like a great teacher.",
    body: "Not all knowledge is taught the same way. EvolvED reasons over teaching strategies — when to scaffold, when to challenge, when to use analogy, when to step back.",
    icon: Compass,
    visual: <PedagogyVisual />,
  },
  {
    id: "lessons",
    chapter: "III",
    eyebrow: "Lesson Generation",
    title: "Composes lessons in real time.",
    body: "Lessons aren't pulled from a shelf. They're written for the version of you that exists right now — with diagrams, problems, narration, and code, tuned to the moment.",
    icon: BookOpen,
    visual: <LessonVisual />,
  },
  {
    id: "assess",
    chapter: "IV",
    eyebrow: "Assessment & Adaptation",
    title: "Listens to how you answer, not just what.",
    body: "Confidence, hesitation, partial understanding — EvolvED reads all of it. Each response refines its picture of your mastery and changes what comes next.",
    icon: Target,
    visual: <AssessVisual />,
  },
  {
    id: "evolve",
    chapter: "V",
    eyebrow: "Continuous Evolution",
    title: "Grows with you, forever.",
    body: "Your tutor isn't static. As you learn, EvolvED evolves its teaching strategies, retrieves memory across sessions, and gets better at teaching specifically you.",
    icon: Inf,
    visual: <EvolveVisual />,
  },
];

export function Story() {
  return (
    <div className="relative">
      {chapters.map((c, i) => (
        <Chapter key={c.id} {...c} flip={i % 2 === 1} index={i} />
      ))}
    </div>
  );
}

function Chapter({
  id, chapter, eyebrow, title, body, icon: Icon, visual, flip, index,
}: typeof chapters[number] & { flip: boolean; index: number }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [60, -60]);

  return (
    <section ref={ref} id={id} className="relative px-6 py-32">
      <div className={`mx-auto max-w-6xl grid lg:grid-cols-2 gap-16 items-center ${flip ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-muted-foreground mb-5">
            <span className="font-display italic text-base normal-case tracking-normal text-orchid">Chapter {chapter}</span>
            <span className="h-px flex-1 bg-border" />
            <span>{eyebrow}</span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl leading-[1.05] text-balance">{title}</h2>
          <p className="font-reading mt-5 text-lg text-muted-foreground leading-relaxed text-pretty max-w-lg">
            {body}
          </p>
          <div className="mt-8 inline-flex items-center gap-2.5 text-sm text-muted-foreground">
            <span className="size-9 rounded-full grid place-items-center bg-card border border-border">
              <Icon className="size-4 text-plum" />
            </span>
            <span>Section {String(index + 1).padStart(2, "0")} of 05</span>
          </div>
        </motion.div>

        <motion.div style={{ y }} className="relative">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="relative aspect-[5/4] rounded-3xl glass overflow-hidden shadow-[var(--shadow-soft)]"
          >
            {visual}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* ——— Visuals ——— */

function LearnerModelVisual() {
  const traits = [
    { label: "Conceptual depth", v: 0.78 },
    { label: "Procedural fluency", v: 0.62 },
    { label: "Visual reasoning", v: 0.88 },
    { label: "Recall stability", v: 0.45 },
    { label: "Confidence calibration", v: 0.71 },
  ];
  return (
    <div className="absolute inset-0 p-8 flex flex-col">
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-6">Learner snapshot</div>
      <div className="space-y-5 flex-1 flex flex-col justify-center">
        {traits.map((t, i) => (
          <div key={t.label}>
            <div className="flex justify-between text-xs mb-1.5">
              <span>{t.label}</span>
              <span className="text-muted-foreground tabular-nums">{Math.round(t.v * 100)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${t.v * 100}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1.2, delay: 0.2 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="h-full rounded-full"
                style={{ backgroundImage: "var(--gradient-aurora)" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PedagogyVisual() {
  const strategies = ["Scaffold", "Worked example", "Analogy", "Socratic", "Spaced recall", "Challenge"];
  return (
    <div className="absolute inset-0 p-8 grid place-items-center">
      <div className="relative w-full max-w-sm">
        {strategies.map((s, i) => {
          const a = (i / strategies.length) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(a) * 110;
          const y = Math.sin(a) * 110;
          const active = i === 2;
          return (
            <motion.div
              key={s}
              initial={{ opacity: 0, scale: 0.6 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 + i * 0.08, duration: 0.5 }}
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-full text-xs whitespace-nowrap border ${
                active ? "bg-foreground text-background border-transparent shadow-[var(--shadow-glow)]" : "bg-card border-border text-muted-foreground"
              }`}
              style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
            >
              {s}
            </motion.div>
          );
        })}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full border border-dashed border-border" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-3 rounded-full" style={{ backgroundImage: "var(--gradient-aurora)" }} />
      </div>
    </div>
  );
}

function LessonVisual() {
  const lines = [
    "Let's build intuition for derivatives.",
    "Imagine zooming into a curve until it looks straight…",
    "The slope of that tiny line is f'(x).",
    "▣  Try: estimate f'(2) for f(x) = x²",
  ];
  return (
    <div className="absolute inset-0 p-8 flex flex-col">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-5">
        <Sparkles className="size-3 text-gold" /> Composing lesson · derivatives
      </div>
      <div className="font-reading space-y-3 text-[15px] leading-relaxed">
        {lines.map((l, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 + i * 0.25, duration: 0.5 }}
            className={i === lines.length - 1 ? "mt-4 p-3 rounded-xl bg-muted/60 border border-border text-sm" : ""}
          >
            {l}
            {i === lines.length - 2 && (
              <motion.span
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + (i + 0.5) * 0.25 }}
                className="inline-block w-2 h-4 align-middle ml-0.5 bg-foreground animate-pulse"
              />
            )}
          </motion.p>
        ))}
      </div>
    </div>
  );
}

function AssessVisual() {
  return (
    <div className="absolute inset-0 p-8 flex flex-col justify-center">
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-5">Question 3 of 5</div>
      <div className="font-reading text-base mb-5">What is the derivative of <span className="font-display italic">x³</span> ?</div>
      <div className="space-y-2">
        {[
          { t: "3x²", ok: true },
          { t: "x²", ok: false },
          { t: "3x", ok: false },
        ].map((o, i) => (
          <motion.div
            key={o.t}
            initial={{ opacity: 0, x: -10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 + i * 0.1 }}
            className={`px-4 py-2.5 rounded-xl border text-sm flex items-center justify-between ${
              o.ok ? "border-gold/60 bg-gold/10" : "border-border bg-card"
            }`}
          >
            <span className="font-display">{o.t}</span>
            {o.ok && <span className="text-[10px] uppercase tracking-[0.2em] text-graphite dark:text-muted-foreground">selected</span>}
          </motion.div>
        ))}
      </div>
      <div className="mt-6">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span>Confidence</span><span>78%</span>
        </div>
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            whileInView={{ width: "78%" }}
            viewport={{ once: true }}
            transition={{ duration: 1, delay: 0.5 }}
            className="h-full rounded-full"
            style={{ backgroundImage: "var(--gradient-warm)" }}
          />
        </div>
      </div>
    </div>
  );
}

function EvolveVisual() {
  return (
    <div className="absolute inset-0 p-8 flex flex-col">
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-5">Strategy evolution · last 30 days</div>
      <svg viewBox="0 0 300 180" className="flex-1 w-full">
        <defs>
          <linearGradient id="ev" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="oklch(0.45 0.18 300)" />
            <stop offset="0.5" stopColor="oklch(0.72 0.16 305)" />
            <stop offset="1" stopColor="oklch(0.82 0.15 80)" />
          </linearGradient>
          <linearGradient id="evf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="oklch(0.72 0.16 305)" stopOpacity="0.3" />
            <stop offset="1" stopColor="oklch(0.72 0.16 305)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d="M0,140 C40,130 60,120 90,100 C120,80 150,90 180,65 C210,42 240,38 300,20 L300,180 L0,180 Z"
          fill="url(#evf)"
          initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1.5 }}
        />
        <motion.path
          d="M0,140 C40,130 60,120 90,100 C120,80 150,90 180,65 C210,42 240,38 300,20"
          fill="none" stroke="url(#ev)" strokeWidth="2.5" strokeLinecap="round"
          initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 2, ease: "easeOut" }}
        />
        {[[40,130],[90,100],[180,65],[300,20]].map(([x,y], i) => (
          <motion.circle key={i} cx={x} cy={y} r={4} fill="oklch(0.99 0 0)" stroke="oklch(0.45 0.18 300)" strokeWidth={1.5}
            initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }}
            transition={{ delay: 0.5 + i * 0.2 }} style={{ transformOrigin: `${x}px ${y}px` }} />
        ))}
      </svg>
      <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
        {[["+34%","mastery velocity"],["−52%","time on stuck concepts"],["+12","new strategies learned"]].map(([k,v]) => (
          <div key={v}>
            <div className="font-display text-lg">{k}</div>
            <div className="text-muted-foreground text-[11px]">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
