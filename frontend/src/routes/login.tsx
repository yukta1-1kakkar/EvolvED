import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/routes";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
  rememberMe: z.boolean().default(true),
});

type LoginFormValues = z.infer<typeof loginSchema>;

interface LoginSearch {
  redirect?: string;
}

export const Route = createFileRoute("/login")({
  validateSearch: (search): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Login — EvolvED" },
      { name: "description", content: "Return to your adaptive EvolvED learning space." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitSuccessful },
    setError,
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: true,
    },
  });

  async function onSubmit(values: LoginFormValues) {
    try {
      await login(values);
      await navigate({
        to: redirect && redirect.startsWith("/") ? redirect : ROUTES.LESSON,
        replace: true,
      });
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Login failed. Please try again.",
      });
    }
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Step back into the lesson that is learning you."
      subtitle="Your model, progress trail, and teaching strategy are waiting exactly where you left them."
    >
      <AuthHeading title="Sign in" subtitle="Continue into EvolvED." />

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-5" noValidate>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email)}
            className="h-12 rounded-xl bg-background/70 px-4"
            {...register("email")}
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Your password"
              aria-invalid={Boolean(errors.password)}
              className="h-12 rounded-xl bg-background/70 px-4 pr-12"
              {...register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-border accent-plum"
              {...register("rememberMe")}
            />
            Remember me
          </label>
          <Link
            to={ROUTES.FORGOT_PASSWORD}
            className="font-medium text-plum transition-colors hover:text-orchid"
          >
            Forgot password?
          </Link>
        </div>

        <StatusMessage
          error={errors.root?.message}
          success={isSubmitSuccessful ? "Authenticated. Opening your workspace." : undefined}
        />

        <Button type="submit" className="h-12 w-full rounded-xl" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <LogIn />}
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to EvolvED?{" "}
        <Link
          to={ROUTES.SIGNUP}
          className="font-medium text-plum transition-colors hover:text-orchid"
        >
          Create your learner profile
        </Link>
      </p>
    </AuthLayout>
  );
}

function AuthHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
        EvolvED access
      </div>
      <h2 className="mt-3 font-display text-3xl leading-tight">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function StatusMessage({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${
        error
          ? "border-destructive/25 bg-destructive/8 text-destructive"
          : "border-plum/20 bg-plum/8 text-plum"
      }`}
      role="status"
      aria-live="polite"
    >
      <AlertCircle className="mt-0.5 size-4" />
      <span>{error ?? success}</span>
    </motion.div>
  );
}
