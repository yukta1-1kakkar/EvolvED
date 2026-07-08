import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Plus, UserRoundPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { getStudentClassroom, joinClass } from "@/lib/api/classroom";

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
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const classroom = useQuery({
    queryKey: ["student-classroom", currentUser?.id],
    queryFn: () => getStudentClassroom(currentUser?.id ?? ""),
    enabled: Boolean(currentUser?.id),
  });
  const join = useMutation({
    mutationFn: () => joinClass(currentUser?.id ?? "", code.trim()),
    onSuccess: async () => {
      setCode("");
      setShowJoin(false);
      await queryClient.invalidateQueries({ queryKey: ["student-classroom", currentUser?.id] });
    },
  });

  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get("code");
    if (inviteCode) {
      setCode(inviteCode.toUpperCase());
      setShowJoin(true);
    }
  }, []);

  return (
    <AppShell title="Join a class" subtitle="Use the join code from your module leader to enter classroom mode." accent="Classroom">
      <section className="max-w-xl space-y-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">Current classes</div>
          <div className="space-y-2">
            {(classroom.data?.classes ?? []).map((item) => (
              <div key={item.class_id} className="rounded-xl border border-border bg-background/70 px-3 py-2 text-sm">
                <div className="font-medium">{item.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">Join code {item.join_code}</div>
              </div>
            ))}
            {!classroom.isLoading && (classroom.data?.classes ?? []).length === 0 && (
              <div className="rounded-xl bg-muted/30 px-3 py-4 text-sm text-muted-foreground">You have not joined any classes yet.</div>
            )}
          </div>
        </div>
        {!showJoin && (
          <Button type="button" onClick={() => setShowJoin(true)}>
            <Plus />
            Join another class
          </Button>
        )}
        {showJoin && (
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
        )}
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
