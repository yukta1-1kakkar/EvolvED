import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/lib/routes";

const passwordRules = {
  min: (value: string) => value.length >= 8,
  upper: (value: string) => /[A-Z]/.test(value),
  lower: (value: string) => /[a-z]/.test(value),
  number: (value: string) => /\d/.test(value),
};

const signupSchema = z
  .object({
    fullName: z.string().min(2, "Enter your full name."),
    email: z.string().min(1, "Email is required.").email("Enter a valid email address."),
    age: z.coerce
      .number()
      .int("Age must be a whole number.")
      .min(8, "Learners must be at least 8.")
      .max(120, "Enter a valid age."),
    password: z
      .string()
      .min(8, "Use at least 8 characters.")
      .regex(/[A-Z]/, "Add an uppercase letter.")
      .regex(/[a-z]/, "Add a lowercase letter.")
      .regex(/\d/, "Add a number."),
    confirmPassword: z.string().min(1, "Confirm your password."),
    termsAccepted: z.boolean().refine(Boolean, "Accept the terms to continue."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type SignupFormValues = z.infer<typeof signupSchema>;

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Signup — EvolvED" },
      { name: "description", content: "Create your EvolvED adaptive learning profile." },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const { signup, loading } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    setError,
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      email: "",
      age: 16,
      password: "",
      confirmPassword: "",
      termsAccepted: false,
    },
  });

  const password = watch("password");
  const strength = useMemo(() => getPasswordStrength(password), [password]);

  async function onSubmit(values: SignupFormValues) {
    try {
      await signup({
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        age: values.age,
      });
      await navigate({ to: ROUTES.PROFILE_SETUP, replace: true });
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Signup failed. Please try again.",
      });
    }
  }

  return (
    <AuthLayout
      eyebrow="Begin intelligently"
      title="Create a learner profile EvolvED can grow around."
      subtitle="The first step is simple: a profile that lets EvolvED remember, adapt, and teach with continuity."
    >
      <div>
        <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">New profile</div>
        <h2 className="mt-3 font-display text-3xl leading-tight">Sign up</h2>
        <p className="mt-2 text-sm text-muted-foreground">Build your adaptive learning space.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
        <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message}>
          <Input
            id="fullName"
            autoComplete="name"
            className="h-12 rounded-xl bg-background/70 px-4"
            {...register("fullName")}
          />
        </Field>

        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            className="h-12 rounded-xl bg-background/70 px-4"
            {...register("email")}
          />
        </Field>

        <Field label="Age" htmlFor="age" error={errors.age?.message}>
          <Input
            id="age"
            type="number"
            inputMode="numeric"
            min={8}
            max={120}
            className="h-12 rounded-xl bg-background/70 px-4"
            {...register("age")}
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
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
          <PasswordStrength password={password} strength={strength} />
        </Field>

        <Field
          label="Confirm password"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
        >
          <Input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className="h-12 rounded-xl bg-background/70 px-4"
            {...register("confirmPassword")}
          />
        </Field>

        <label className="flex items-start gap-3 rounded-xl border border-border bg-background/45 p-3 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-border accent-plum"
            {...register("termsAccepted")}
          />
          <span>
            I agree to EvolvED using my learner profile to personalize lessons and progress
            insights.
          </span>
        </label>
        {errors.termsAccepted?.message && (
          <p className="-mt-2 text-sm text-destructive">{errors.termsAccepted.message}</p>
        )}

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
          {loading ? <Loader2 className="animate-spin" /> : <UserPlus />}
          Create profile
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
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

function getPasswordStrength(password: string) {
  const checks = [
    passwordRules.min(password),
    passwordRules.upper(password),
    passwordRules.lower(password),
    passwordRules.number(password),
  ];
  return checks.filter(Boolean).length;
}

function PasswordStrength({ password, strength }: { password: string; strength: number }) {
  const label = ["Start typing", "Fragile", "Improving", "Strong", "Excellent"][strength];
  const requirements = [
    ["8+ characters", passwordRules.min(password)],
    ["Uppercase", passwordRules.upper(password)],
    ["Lowercase", passwordRules.lower(password)],
    ["Number", passwordRules.number(password)],
  ] as const;

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              index < strength ? "bg-plum" : "bg-muted"
            }`}
          />
        ))}
        <span className="ml-2 w-20 text-right text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        {requirements.map(([text, met]) => (
          <div key={text} className={`flex items-center gap-1.5 ${met ? "text-plum" : ""}`}>
            <CheckCircle2 className="size-3.5" />
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}
