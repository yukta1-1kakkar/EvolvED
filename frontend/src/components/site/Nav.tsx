import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

import { EvolvedLogo } from "@/components/brand/EvolvedLogo";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/routes";

export function Nav() {
  const { currentUser, isAuthenticated } = useAuth();
  const isModuleLeader = currentUser?.role === "module_leader";
  const isClassStudent = currentUser?.accountType === "class_student";
  const appEntry = isAuthenticated ? (isModuleLeader ? ROUTES.TEACHER : isClassStudent ? ROUTES.ALERTS : ROUTES.KNOWLEDGE) : ROUTES.LOGIN;
  const appSearch = isAuthenticated ? undefined : { redirect: ROUTES.KNOWLEDGE };

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
        <div className="flex items-center gap-2">
          <Link
            to={ROUTES.LOGIN}
            className="hidden sm:inline text-sm text-muted-foreground hover:text-foreground px-3"
          >
            Sign in
          </Link>
          <Link
            to={appEntry}
            search={appSearch}
            className="rounded-full bg-foreground text-background text-sm px-4 py-2 hover:opacity-90 transition-opacity"
          >
            {isModuleLeader ? "Teacher Dashboard" : "Enter EvolvED"}
          </Link>
        </div>
      </nav>
    </motion.header>
  );
}
