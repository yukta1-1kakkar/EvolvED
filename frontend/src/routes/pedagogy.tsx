import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { motion } from "framer-motion";
import { Compass, Gauge, Layers, Repeat } from "lucide-react";

export const Route = createFileRoute("/pedagogy")({
  head: () => ({
    meta: [
      { title: "Pedagogy — EvolvED" },
      { name: "description", content: "How EvolvED is teaching you right now — and how that strategy has evolved." },
    ],
  }),
  component: PedagogyPage,
});

const strategies = [
  { k: "Worked example", w: 0.42, active: true },
  { k: "Socratic", w: 0.18 },
  { k: "Analogy", w: 0.14 },
  { k: "Scaffold", w: 0.12 },
  { k: "Spaced recall", w: 0.09 },
  { k: "Challenge", w: 0.05 },
];

function PedagogyPage() {
  return (
    <AppShell title="How EvolvED is teaching you" subtitle="A view into the active teaching strategy, pacing decisions, and how the approach has evolved across your sessions." accent="Worked ex.">
      <div className="grid xl:grid-cols-[1.1fr_1fr] gap-6 mb-6">
        <div className="rounded-3xl border border-border bg-card p-7">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground flex items-center gap-2"><Compass className="size-3" /> Active strategy</div>
          <h3 className="font-display text-3xl mt-2">Worked example, slow pace, visual-first.</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-md">For the next 12 minutes, EvolvED will show fully worked solutions before asking you to attempt similar problems.</p>

          <div className="mt-7 space-y-3.5">
            {strategies.map((s, i) => (
              <div key={s.k} className="flex items-center gap-3">
                <span className={`w-32 text-sm ${s.active ? "font-medium" : "text-muted-foreground"}`}>{s.k}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${s.w * 100}%` }} transition={{ duration: 1, delay: 0.1 * i, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full rounded-full"
                    style={{ backgroundImage: s.active ? "var(--gradient-aurora)" : "linear-gradient(90deg, oklch(0.7 0.04 295), oklch(0.85 0.03 295))" }} />
                </div>
                <span className="font-mono text-xs tabular-nums text-muted-foreground w-10 text-right">{Math.round(s.w * 100)}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Tile icon={Gauge} k="Pacing" v="−15%" sub="from baseline" />
          <Tile icon={Layers} k="Modality" v="Visual" sub="text + figure" />
          <Tile icon={Repeat} k="Repetition" v="Light" sub="2 spaced reviews queued" />
          <Tile icon={Compass} k="Next move" v="Practice" sub="after this section" />
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card p-7 mb-6">
        <div className="flex items-baseline justify-between mb-5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Strategy mix · last 30 sessions</div>
            <h3 className="font-display text-2xl mt-1">What's been working</h3>
          </div>
        </div>
        <StackedStrategies />
      </div>

      <div className="rounded-3xl border border-border p-7">
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-5">Pedagogical decisions today</div>
        <div className="grid sm:grid-cols-2 gap-x-10 gap-y-5 text-sm">
          {[
            ["09:14", "Opened with intuition before notation", "Your retention drops when symbolic form is shown first."],
            ["09:22", "Inserted a visual checkpoint", "Visual modality is your strongest channel."],
            ["09:31", "Switched from Socratic to Worked example", "Two fragile responses in a row."],
            ["09:44", "Scheduled spaced review of Limits in 2 days", "Recall decay risk crossed threshold."],
          ].map(([t, what, why]) => (
            <div key={t} className="flex gap-4">
              <span className="font-mono text-xs text-muted-foreground w-12 pt-1 shrink-0">{t}</span>
              <div>
                <div className="font-medium">{what}</div>
                <p className="text-xs text-muted-foreground mt-1">{why}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function Tile({ icon: Icon, k, v, sub }: { icon: React.ElementType; k: string; v: string; sub: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <Icon className="size-4 text-plum" />
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{k}</span>
      </div>
      <div className="font-display text-2xl mt-4">{v}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </motion.div>
  );
}

function StackedStrategies() {
  const days = 30;
  const cols = Array.from({ length: days }, (_, i) => {
    const seed = (i * 9301 + 49297) % 233280 / 233280;
    return [0.3 + seed * 0.2, 0.15 + (1 - seed) * 0.15, 0.1 + seed * 0.1, 0.1, 0.1, 0.1].map(x => x);
  });
  const colors = ["oklch(0.45 0.18 300)","oklch(0.72 0.16 305)","oklch(0.82 0.15 80)","oklch(0.82 0.12 55)","oklch(0.82 0.09 295)","oklch(0.92 0.05 85)"];
  return (
    <div>
      <div className="flex items-end gap-1 h-40">
        {cols.map((stack, i) => (
          <div key={i} className="flex-1 flex flex-col-reverse rounded-t overflow-hidden">
            {stack.map((v, j) => (
              <motion.div key={j} initial={{ height: 0 }} animate={{ height: `${v * 100}%` }} transition={{ duration: 0.8, delay: i * 0.01 }} style={{ background: colors[j] }} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-4 text-[11px] text-muted-foreground">
        {strategies.map((s, i) => (
          <span key={s.k} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: colors[i] }} />{s.k}
          </span>
        ))}
      </div>
    </div>
  );
}
