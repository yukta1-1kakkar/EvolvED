import { Link } from "@tanstack/react-router";

import { ROUTES } from "@/lib/routes";

export function Footer() {
  return (
    <footer className="px-6 pb-12 pt-8 border-t border-border/60">
      <div className="mx-auto max-w-6xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-sm text-muted-foreground">
        <div>
          <div className="font-display text-foreground text-lg">EvolvED</div>
          <p className="mt-1 text-xs">
            A living teaching intelligence. © {new Date().getFullYear()}
          </p>
        </div>
        <nav className="flex flex-wrap gap-6 text-xs">
          <Link to={ROUTES.PEDAGOGY} className="hover:text-foreground">
            Pedagogy
          </Link>
          <span>Research</span>
          <span>Accessibility</span>
          <span>Privacy</span>
          <span>Contact</span>
        </nav>
      </div>
    </footer>
  );
}
