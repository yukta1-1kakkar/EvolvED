import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/routes";

const forgotPasswordSchema = z.object({
  email: z.string().min(1, "Email is required.").email("Enter a valid email address."),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot Password — EvolvED" },
      { name: "description", content: "Request EvolvED password reset instructions." },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { forgotPassword, loading } = useAuth();
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordFormValues) {
    try {
      await forgotPassword(values.email);
      setSent(true);
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Reset request failed. Please try again.",
      });
    }
  }

  return (
    <AuthLayout
      eyebrow="Recover access"
      title="A calm reset, then back to learning."
      subtitle="We will send instructions without revealing whether a learner account exists for that email."
    >
      <div>
        <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Account recovery
        </div>
        <h2 className="mt-3 font-display text-3xl leading-tight">Forgot password</h2>
        <p className="mt-2 text-sm text-muted-foreground">Enter your email and check your inbox.</p>
      </div>

      {sent ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-7 rounded-2xl border border-plum/20 bg-plum/8 p-5"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 text-plum" />
            <div>
              <h3 className="font-medium">Instructions sent</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                If an account exists for this email, password reset instructions have been sent.
              </p>
            </div>
          </div>
          <Button asChild className="mt-5 h-11 w-full rounded-xl">
            <Link to={ROUTES.LOGIN}>
              <ArrowLeft />
              Back to sign in
            </Link>
          </Button>
        </motion.div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-5" noValidate>
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={Boolean(errors.email)}
              className="h-12 rounded-xl bg-background/70 px-4"
              {...register("email")}
            />
            {errors.email?.message && (
              <p className="mt-2 text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          {errors.root?.message && (
            <div
              className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-4" />
              <span>{errors.root.message}</span>
            </div>
          )}

          <Button type="submit" className="h-12 w-full rounded-xl" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Mail />}
            Send reset instructions
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link
          to={ROUTES.LOGIN}
          className="font-medium text-plum transition-colors hover:text-orchid"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
