import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

import { ROUTES } from "@/lib/routes";

export function CTA() {
  return (
    <section id="start" className="px-6 py-32">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="relative mx-auto max-w-5xl rounded-[2.5rem] overflow-hidden p-14 md:p-20 text-center"
        style={{ backgroundImage: "var(--gradient-aurora)" }}
      >
        <div className="absolute inset-0 grain text-white" />
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-white/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 size-96 rounded-full bg-gold/30 blur-3xl" />
        <div className="relative">
          <h2 className="font-display text-4xl md:text-6xl text-white text-balance leading-[1.02]">
            Begin a learning relationship that <span className="italic">grows with you.</span>
          </h2>
          <p className="font-reading mt-5 text-white/85 max-w-xl mx-auto text-pretty">
            Choose a subject. Answer a few questions. EvolvED takes it from there.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              to={ROUTES.SIGNUP}
              className="rounded-full bg-white text-foreground px-7 py-3.5 text-sm font-medium hover:scale-[1.02] transition-transform"
            >
              Start learning free
            </Link>
            <Link
              to={ROUTES.LESSON}
              className="rounded-full border border-white/40 text-white px-7 py-3.5 text-sm hover:bg-white/10 transition-colors"
            >
              Watch a lesson
            </Link>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
