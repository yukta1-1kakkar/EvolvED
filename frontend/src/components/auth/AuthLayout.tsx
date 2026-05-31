import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Brain, GraduationCap, LineChart, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { ROUTES } from "@/lib/routes";

export function AuthLayout({
  children,
  eyebrow,
  title,
  subtitle,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <main className="min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="grid min-h-dvh lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden bg-foreground px-10 py-8 text-background lg:flex lg:flex-col">
          <div
            className="absolute inset-0 opacity-80"
            style={{ backgroundImage: "var(--gradient-aurora)" }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(251,191,36,0.28),transparent_28%),radial-gradient(circle_at_76%_22%,rgba(250,247,242,0.18),transparent_26%),linear-gradient(145deg,rgba(17,24,39,0.78),rgba(31,41,55,0.62))]" />
          <div className="grain absolute inset-0 text-white" />

          <div className="relative z-10 flex items-center justify-between">
            <Link
              to={ROUTES.HOME}
              className="flex items-center gap-3 group"
              aria-label="EvolvED home"
            >
              <div className="grid size-10 place-items-center rounded-xl bg-white/12 ring-1 ring-white/20 backdrop-blur">
                <GraduationCap className="size-5 transition-transform group-hover:-rotate-6" />
              </div>
              <span className="font-display text-2xl">EvolvED</span>
            </Link>
            <div className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/80 backdrop-blur">
              Adaptive access
            </div>
          </div>

          <div className="relative z-10 my-auto max-w-2xl py-16">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mb-5 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-white/70">
                <Sparkles className="size-3.5 text-gold" />
                {eyebrow}
              </div>
              <h1 className="font-display text-5xl leading-[0.98] text-balance xl:text-6xl">
                {title}
              </h1>
              <p className="mt-6 max-w-xl font-reading text-lg leading-relaxed text-white/76 text-pretty">
                {subtitle}
              </p>
            </motion.div>

            <KnowledgeConstellation />

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              {[
                ["Learner model", "Live"],
                ["Strategy", "Personalized"],
                ["Growth", "+18%"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-2xl border border-white/12 bg-white/9 p-4 backdrop-blur"
                >
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/55">
                    {label}
                  </div>
                  <div className="mt-2 font-display text-xl text-white">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative flex min-h-dvh items-center px-5 py-8 sm:px-8 lg:px-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--orchid)_18%,transparent),transparent_55%)]" />
          <div className="relative mx-auto w-full max-w-md">
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <Link to={ROUTES.HOME} className="flex items-center gap-2">
                <div
                  className="size-8 rounded-lg"
                  style={{ backgroundImage: "var(--gradient-aurora)" }}
                />
                <span className="font-display text-xl">EvolvED</span>
              </Link>
            </div>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="glass rounded-3xl p-5 shadow-[var(--shadow-soft)] sm:p-7"
            >
              {children}
            </motion.div>
          </div>
        </section>
      </div>
    </main>
  );
}

function KnowledgeConstellation() {
  const nodes = [
    { x: 74, y: 74, icon: Brain },
    { x: 190, y: 36, icon: GraduationCap },
    { x: 318, y: 86, icon: LineChart },
    { x: 142, y: 160, icon: Sparkles },
    { x: 276, y: 194, icon: Brain },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      className="mt-10 max-w-xl rounded-[2rem] border border-white/12 bg-white/8 p-5 backdrop-blur"
      aria-hidden="true"
    >
      <svg viewBox="0 0 390 240" className="h-auto w-full">
        <defs>
          <linearGradient id="auth-line" x1="0" x2="1">
            <stop stopColor="rgba(251,191,36,0.9)" />
            <stop offset="1" stopColor="rgba(167,139,250,0.85)" />
          </linearGradient>
        </defs>
        {[
          [74, 74, 190, 36],
          [190, 36, 318, 86],
          [74, 74, 142, 160],
          [142, 160, 276, 194],
          [318, 86, 276, 194],
          [190, 36, 142, 160],
        ].map(([x1, y1, x2, y2], index) => (
          <motion.line
            key={`${x1}-${x2}-${index}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="url(#auth-line)"
            strokeWidth="1.5"
            strokeDasharray="6 8"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.78 }}
            transition={{ duration: 1.1, delay: 0.15 + index * 0.08 }}
          />
        ))}
        {nodes.map((node, index) => {
          const Icon = node.icon;
          return (
            <motion.g
              key={`${node.x}-${node.y}`}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.35 + index * 0.08 }}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r="25"
                fill="rgba(255,255,255,0.12)"
                stroke="rgba(255,255,255,0.22)"
              />
              <foreignObject x={node.x - 10} y={node.y - 10} width="20" height="20">
                <Icon className="size-5 text-white" />
              </foreignObject>
            </motion.g>
          );
        })}
      </svg>
    </motion.div>
  );
}
