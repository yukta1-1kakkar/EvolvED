import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, UserRoundPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { joinClass } from "@/lib/api/classroom";

export const Route = createFileRoute("/join-class")({
  head: () => ({
    meta: [
      { title: "Join Class - EvolvED" },
      { name: "description", content: "Join a module leader's EvolvED class with a code." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <JoinClassPage />
    </ProtectedRoute>
  ),
});

function JoinClassPage() {
  const { currentUser } = useAuth();
  const [code, setCode] = useState("");
  const join = useMutation({
    mutationFn: () => joinClass(currentUser?.id ?? "", code.trim()),
  });

  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get("code");
    if (inviteCode) setCode(inviteCode.toUpperCase());
  }, []);

  return (
    <AppShell title="Join a class" subtitle="Use the join code from your module leader to enter classroom mode." accent="Classroom">
      <section className="max-w-xl rounded-2xl border border-border bg-card p-6">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim()) join.mutate();
          }}
        >
          <label className="block text-sm font-medium" htmlFor="joinCode">Join code</label>
          <Input
            id="joinCode"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="ABC12345"
            className="h-12 text-lg tracking-[0.2em]"
          />
          <Button type="submit" disabled={!code.trim() || join.isPending}>
            {join.isPending ? <Loader2 className="animate-spin" /> : <UserRoundPlus />}
            Join class
          </Button>
        </form>
        {join.isSuccess && (
          <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-700">
            <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4" /> Joined {join.data.name}</div>
            <p className="mt-1">Your teacher can now see your class progress and assessment analytics.</p>
          </div>
        )}
        {join.isError && <p className="mt-4 text-sm text-destructive">{join.error.message}</p>}
      </section>
    </AppShell>
  );
}
