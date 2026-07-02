import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

import { ROUTES } from "@/lib/routes";

import { KnowledgeGraph } from "./KnowledgeGraph";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-36 pb-28 px-6">
      <div
        className="absolute inset-0 -z-10"
        style={{ background: "var(--gradient-veil)" }}
        aria-hidden
      />
      <div className="mx-auto max-w-6xl grid lg:grid-cols-[1.1fr_1fr] gap-16 items-center">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 backdrop-blur px-3 py-1.5 text-xs text-muted-foreground"
          >
            <span className="size-1.5 rounded-full bg-orchid animate-pulse" />
            Adaptive educational intelligence - v1.0
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.05 }}
            className="font-display mt-6 text-5xl md:text-7xl leading-[0.95] text-balance"
          >
            Education that{" "}
            <span
              className="italic bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-aurora)" }}
            >
              evolves
            </span>{" "}
            with every learner.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="font-reading mt-6 max-w-xl text-lg text-muted-foreground text-pretty leading-relaxed"
          >
            EvolvED is a living teaching intelligence. It understands how you think, reasons about
            pedagogy, generates lessons in real time, and adapts its strategy as you grow.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25 }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <Link
              to={ROUTES.SIGNUP}
              className="group relative overflow-hidden rounded-full px-6 py-3 text-sm font-medium text-white shadow-[var(--shadow-glow)]"
              style={{ backgroundImage: "var(--gradient-aurora)" }}
            >
              <span className="relative z-10">Start learning</span>
            </Link>
            <Link
              to={ROUTES.INTELLIGENCE}
              className="rounded-full border border-border bg-card/50 backdrop-blur px-6 py-3 text-sm hover:bg-card transition-colors"
            >
              Explore EvolvED
            </Link>
          </motion.div>

          <motion.dl
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="mt-14 grid grid-cols-3 gap-6 max-w-md"
          >
            {[
              ["12.4M", "concepts modeled"],
              ["94%", "mastery accuracy"],
              ["many", "adaptive paths"],
            ].map(([k, v]) => (
              <div key={v}>
                <div className="font-display text-2xl">{k}</div>
                <div className="text-xs text-muted-foreground mt-1">{v}</div>
              </div>
            ))}
          </motion.dl>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="relative aspect-square"
        >
          <KnowledgeGraph />
        </motion.div>
      </div>
    </section>
  );
}
