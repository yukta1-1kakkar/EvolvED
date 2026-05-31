import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

import { ROUTES } from "@/lib/routes";

export function Nav() {
  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-0 inset-x-0 z-50 px-6 pt-5"
    >
      <nav className="glass mx-auto max-w-6xl flex items-center justify-between rounded-full pl-6 pr-2 py-2">
        <Link to={ROUTES.HOME} className="flex items-center gap-2 group">
          <Logo />
          <span className="font-display text-lg tracking-tight">EvolvED</span>
        </Link>
        <div className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
          <Link to={ROUTES.LESSON} className="hover:text-foreground transition-colors">
            Lesson
          </Link>
          <Link to={ROUTES.KNOWLEDGE} className="hover:text-foreground transition-colors">
            Knowledge
          </Link>
          <Link to={ROUTES.PROGRESS} className="hover:text-foreground transition-colors">
            Progress
          </Link>
          <Link to={ROUTES.INTELLIGENCE} className="hover:text-foreground transition-colors">
            Intelligence
          </Link>
          <Link to={ROUTES.PEDAGOGY} className="hover:text-foreground transition-colors">
            Pedagogy
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={ROUTES.LOGIN}
            className="hidden sm:inline text-sm text-muted-foreground hover:text-foreground px-3"
          >
            Sign in
          </Link>
          <Link
            to={ROUTES.LESSON}
            className="rounded-full bg-foreground text-background text-sm px-4 py-2 hover:opacity-90 transition-opacity"
          >
            Enter EvolvED
          </Link>
        </div>
      </nav>
    </motion.header>
  );
}

function Logo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      className="transition-transform group-hover:rotate-12"
    >
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0" stopColor="oklch(0.45 0.18 300)" />
          <stop offset="0.6" stopColor="oklch(0.72 0.16 305)" />
          <stop offset="1" stopColor="oklch(0.82 0.15 80)" />
        </linearGradient>
      </defs>
      <path
        d="M16 3 C 8 3 3 9 3 16 C 3 23 8 29 16 29 C 22 29 26 25 26 20 C 26 15 22 13 17 13 C 13 13 11 15 11 18"
        stroke="url(#lg)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="11" cy="18" r="2" fill="url(#lg)" />
    </svg>
  );
}
