import { Navigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/routes";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { currentUser, isAuthenticated, loading } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-foreground">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-plum" aria-hidden="true" />
          <span>Preparing your learning space</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} search={{ redirect: pathname }} replace />;
  }

  if (!currentUser?.profileComplete && currentUser?.role !== "module_leader") {
    return <Navigate to={ROUTES.PROFILE_SETUP} replace />;
  }

  return children;
}
