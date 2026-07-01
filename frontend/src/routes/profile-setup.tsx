import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { createLearnerProfile } from "@/lib/api";
import { ROUTES } from "@/lib/routes";

const profileSchema = z.object({
  educationLevel: z.string().min(1, "Choose your education level."),
  interests: z.enum(["Calculus", "Linear Algebra"], { required_error: "Choose a subject." }),
  learningGoal: z.string().min(2, "Tell us what you want to achieve."),
  pacePreference: z.string().min(1, "Choose a learning pace."),
  learningAvailability: z.string().min(1, "Choose your learning availability."),
  preferredModality: z.string().min(1, "Choose a learning style."),
  topicFamiliarity: z.string().min(1, "Choose your current familiarity."),
  accessibility: z.boolean(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export const Route = createFileRoute("/profile-setup")({
  head: () => ({
    meta: [
      { title: "Learner details - EvolvED" },
      { name: "description", content: "Tell EvolvED how you learn best." },
    ],
  }),
  component: ProfileSetupPage,
});

function ProfileSetupPage() {
  const { currentUser, completeProfile, loading } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { accessibility: false },
  });

  useEffect(() => {
    if (!loading && !currentUser) {
      void navigate({ to: ROUTES.LOGIN, replace: true });
    }
  }, [currentUser, loading, navigate]);

  async function onSubmit(values: ProfileFormValues) {
    if (!currentUser) return;

    setSaving(true);
    try {
      await createLearnerProfile({
        learner_id: currentUser.id,
        age_group: getAgeGroup(currentUser.age),
        education_level: values.educationLevel,
        learning_goal: values.learningGoal,
        pace_preference: values.pacePreference,
        preferred_modality: [values.preferredModality],
        topic: values.interests,
        topic_familiarity: values.topicFamiliarity,
        accessibility: { additional_support: values.accessibility },
        learning_availability: values.learningAvailability,
      });
      completeProfile(values.interests, "", {
        educationLevel: values.educationLevel,
        pacePreference: values.pacePreference,
        preferredModality: values.preferredModality,
        topicFamiliarity: values.topicFamiliarity,
        learningAvailability: values.learningAvailability,
        accessibilitySupport: values.accessibility,
      });
      await navigate({ to: ROUTES.KNOWLEDGE, replace: true });
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Profile setup failed. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Personalize your learning"
      title={`Let's shape your learning space${currentUser?.fullName ? `, ${currentUser.fullName.split(" ")[0]}` : ""}.`}
      subtitle="A few details help EvolvED choose the right pace, examples, and teaching style from your first lesson."
    >
      <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
        Learner details
      </div>
      <h2 className="mt-3 font-display text-3xl leading-tight">How do you learn best?</h2>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
        <Field label="Education level" htmlFor="educationLevel" error={errors.educationLevel?.message}>
          <Select id="educationLevel" {...register("educationLevel")}>
            <option value="">Choose a level</option>
            <option>School</option>
            <option>Undergraduate</option>
            <option>Postgraduate</option>
            <option>Professional or independent learner</option>
          </Select>
        </Field>

        <Field label="Subject track" htmlFor="interests" error={errors.interests?.message}>
          <Select id="interests" {...register("interests")}>
            <option value="">Choose a track</option>
            <option value="Calculus">Calculus</option>
            <option value="Linear Algebra">Linear Algebra</option>
          </Select>
        </Field>

        <Field label="Primary learning goal" htmlFor="learningGoal" error={errors.learningGoal?.message}>
          <Input id="learningGoal" placeholder="e.g. prepare for an exam or build strong foundations" {...register("learningGoal")} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preferred pace" htmlFor="pacePreference" error={errors.pacePreference?.message}>
            <Select id="pacePreference" {...register("pacePreference")}>
              <option value="">Choose a pace</option>
              <option value="gentle">Gentle and thorough</option>
              <option value="balanced">Balanced</option>
              <option value="fast">Fast and challenging</option>
            </Select>
          </Field>
          <Field label="Current familiarity" htmlFor="topicFamiliarity" error={errors.topicFamiliarity?.message}>
            <Select id="topicFamiliarity" {...register("topicFamiliarity")}>
              <option value="">Choose a level</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </Select>
          </Field>
        </div>

        <Field label="Preferred learning style" htmlFor="preferredModality" error={errors.preferredModality?.message}>
          <Select id="preferredModality" {...register("preferredModality")}>
            <option value="">Choose a style</option>
            <option value="visual">Visual examples and diagrams</option>
            <option value="audio">Audio learning</option>
            <option value="reading">Detailed written explanations</option>
          </Select>
        </Field>

        <Field label="Learning availability" htmlFor="learningAvailability" error={errors.learningAvailability?.message}>
          <Select id="learningAvailability" {...register("learningAvailability")}>
            <option value="">Choose your daily time</option>
            <option value="30_min">30 min/day</option>
            <option value="60_min">1 hr/day</option>
            <option value="120_min">2 hr/day</option>
          </Select>
        </Field>

        <label className="flex items-start gap-3 rounded-xl border border-border bg-background/45 p-3 text-sm text-muted-foreground">
          <input type="checkbox" className="mt-0.5 size-4 accent-plum" {...register("accessibility")} />
          <span>I would like additional accessibility support and clearer step-by-step explanations.</span>
        </label>

        {errors.root?.message && (
          <div className="flex gap-2 rounded-xl border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4" />
            <span>{errors.root.message}</span>
          </div>
        )}

        <Button type="submit" className="h-12 w-full rounded-xl" disabled={saving || loading || !currentUser}>
          {saving ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          Start learning
        </Button>
      </form>
    </AuthLayout>
  );
}

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium">{label}</label>
      {children}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="h-12 w-full rounded-xl border border-input bg-background/70 px-4 text-sm" {...props} />;
}

function getAgeGroup(age?: number) {
  if (age === undefined) return null;
  if (age < 13) return "child";
  if (age < 18) return "teen";
  return "adult";
}
