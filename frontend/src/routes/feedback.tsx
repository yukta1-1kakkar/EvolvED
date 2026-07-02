import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, MessageSquarePlus, Send, Star } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app/AppShell";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/hooks/useAuth";
import { submitPeerFeedback } from "@/lib/api";

export const Route = createFileRoute("/feedback")({
  component: () => (
    <ProtectedRoute>
      <FeedbackPage />
    </ProtectedRoute>
  ),
});

type FeedbackState = {
  reviewer_name: string;
  topic: string;
  rating: number;
  clarity: number;
  accessibility: number;
  modality_fit: number;
  comment: string;
};

function FeedbackPage() {
  const { currentUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FeedbackState>({
    reviewer_name: currentUser?.fullName ?? "",
    topic: currentUser?.learningTopic ?? "",
    rating: 4,
    clarity: 4,
    accessibility: 4,
    modality_fit: 4,
    comment: "",
  });

  useEffect(() => {
    if (!currentUser?.fullName) return;
    setForm((current) => current.reviewer_name ? current : { ...current, reviewer_name: currentUser.fullName });
  }, [currentUser?.fullName]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser?.id) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await submitPeerFeedback({
        learner_id: currentUser.id,
        lesson_id: typeof window === "undefined" ? null : window.localStorage.getItem("evolved.currentLessonSession"),
        ...form,
      });
      setSaved(true);
      setForm((current) => ({ ...current, comment: "" }));
    } catch (feedbackError) {
      setError(feedbackError instanceof Error ? feedbackError.message : "Feedback could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Peer feedback"
      subtitle="Collect human-in-the-loop review after a lesson demo, then use it to refine modality, pacing, and accessibility."
      accent={saved ? "Feedback saved" : "Review loop"}
    >
      <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_0.75fr]">
        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            <MessageSquarePlus className="size-3.5 text-plum" /> Peer review
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">
              Reviewer name
              <input
                value={form.reviewer_name}
                onChange={(event) => setForm({ ...form, reviewer_name: event.target.value })}
                placeholder="e.g. Aditi"
                className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="text-sm font-medium">
              Topic reviewed
              <input
                value={form.topic}
                onChange={(event) => setForm({ ...form, topic: event.target.value })}
                placeholder="e.g. Eigenvalues"
                className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              />
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium">
            Review notes
            <textarea
              value={form.comment}
              onChange={(event) => setForm({ ...form, comment: event.target.value })}
              placeholder="What helped, what confused the learner, and what should adapt next?"
              className="mt-2 min-h-40 w-full rounded-2xl border border-input bg-background p-4 text-sm leading-7 outline-none focus:border-plum"
            />
          </label>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          {saved && (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-plum">
              <CheckCircle2 className="size-4" /> Feedback saved for adaptation review.
            </p>
          )}
          <button
            type="submit"
            disabled={saving || !form.topic.trim()}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm text-background transition-opacity disabled:opacity-50"
          >
            <Send className="size-4" /> {saving ? "Saving feedback" : "Save peer feedback"}
          </button>
        </section>

        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Evaluation rubric</div>
          <div className="mt-4 space-y-4">
            <Rating label="Overall usefulness" value={form.rating} onChange={(rating) => setForm({ ...form, rating })} />
            <Rating label="Clarity" value={form.clarity} onChange={(clarity) => setForm({ ...form, clarity })} />
            <Rating label="Accessibility" value={form.accessibility} onChange={(accessibility) => setForm({ ...form, accessibility })} />
            <Rating label="Modality fit" value={form.modality_fit} onChange={(modality_fit) => setForm({ ...form, modality_fit })} />
          </div>
        </section>
      </form>
    </AppShell>
  );
}

function Rating({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">{label}</div>
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={`flex h-10 items-center justify-center rounded-xl border text-sm ${
              item <= value ? "border-plum bg-plum/[0.08] text-plum" : "border-border text-muted-foreground"
            }`}
            aria-label={`${label}: ${item}`}
          >
            <Star className="size-4" fill={item <= value ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
    </div>
  );
}
