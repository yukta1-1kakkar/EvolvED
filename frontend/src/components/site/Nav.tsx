import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

import { EvolvedLogo } from "@/components/brand/EvolvedLogo";
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
          <EvolvedLogo className="size-8 transition-transform group-hover:rotate-3" />
          <span className="font-display text-lg tracking-tight">EvolvED</span>
        </Link>
        <div className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
          <Link to={ROUTES.KNOWLEDGE} className="hover:text-foreground transition-colors">
            Knowledge
          </Link>
          <Link to={ROUTES.LESSON} className="hover:text-foreground transition-colors">
            Lesson
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
