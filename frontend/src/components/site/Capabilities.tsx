import { motion } from "framer-motion";

const items = [
  { k: "Multimodal lessons", v: "Text, diagrams, MathJax, code, audio narration, 3D visualizations - composed to fit how you learn best." },
  { k: "Concept maps", v: "Navigate prerequisites and mastery as a living map of what you know and what's next." },
  { k: "Memory across sessions", v: "EvolvED remembers what clicked, what didn't, and which analogies worked for you." },
  { k: "Accessibility first", v: "Dyslexia mode, focus mode, reduced motion, adjustable spacing - built in, not bolted on." },
  { k: "Confidence-aware", v: "Quizzes capture certainty, not just correctness, to detect fragile understanding." },
  { k: "Explainable AI", v: "See what the tutor believes about you and why it chose this lesson, this moment." },
];

export function Capabilities() {
  return (
    <section className="px-6 py-32 border-t border-border/60">
      <div className="mx-auto max-w-6xl">
        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-12 mb-16">
          <h2 className="font-display text-4xl md:text-5xl leading-[1.05]">
            A teaching system, <span className="italic">not a chatbot.</span>
          </h2>
          <p className="font-reading text-lg text-muted-foreground max-w-xl text-pretty">
            EvolvED is built on a foundation of pedagogy, cognitive science, and
            adaptive intelligence - every surface is designed to teach.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-3xl overflow-hidden">
          {items.map((it, i) => (
            <motion.div
              key={it.k}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: i * 0.06, duration: 0.6 }}
              className="bg-card p-8 group hover:bg-muted/40 transition-colors"
            >
              <div className="text-xs font-mono text-muted-foreground mb-4">0{i + 1}</div>
              <h3 className="font-display text-xl mb-2">{it.k}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{it.v}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
