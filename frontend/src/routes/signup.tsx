import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, GraduationCap, Loader2, UserPlus, UserRoundPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { createLearnerProfile } from "@/lib/api";
import { joinClass } from "@/lib/api/classroom";
import type { AuthUser } from "@/lib/auth";
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
    age: z.coerce.number().optional(),
    password: z
      .string()
      .min(8, "Use at least 8 characters.")
      .regex(/[A-Z]/, "Add an uppercase letter.")
      .regex(/[a-z]/, "Add a lowercase letter.")
      .regex(/\d/, "Add a number."),
    confirmPassword: z.string().optional(),
    role: z.enum(["student", "class_student", "module_leader"]),
    moduleLeaderCode: z.string().optional(),
    termsAccepted: z.boolean(),
  })
  .superRefine((values, context) => {
    if (values.role !== "module_leader" && (!Number.isInteger(values.age) || values.age < 8 || values.age > 120)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["age"],
        message: "Enter a valid learner age from 8 to 120.",
      });
    }
    if (values.role !== "class_student" && !values.confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Confirm your password.",
      });
    }
    if (values.role !== "class_student" && values.password !== values.confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }
    if (values.role !== "class_student" && !values.termsAccepted) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["termsAccepted"],
        message: "Accept the terms to continue.",
      });
    }
    if (values.role === "module_leader" && !values.moduleLeaderCode?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["moduleLeaderCode"],
        message: "Enter the module leader access code.",
      });
    }
  })
;

type SignupFormValues = z.infer<typeof signupSchema>;

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Signup - EvolvED" },
      { name: "description", content: "Create your EvolvED adaptive learning profile." },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const { signup, completeProfile, loading } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [classCode, setClassCode] = useState("");
  const [classStudent, setClassStudent] = useState<AuthUser | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    setError,
    setValue,
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      email: "",
      age: undefined,
      password: "",
      confirmPassword: "",
      role: "student",
      moduleLeaderCode: "",
      termsAccepted: false,
    },
  });

  const password = watch("password");
  const role = watch("role");
  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const classJoin = useClassJoinMutation(classStudent, classCode, completeProfile, navigate);

  async function onSubmit(values: SignupFormValues) {
    try {
      const user = await signup({
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        age: values.role !== "module_leader" ? values.age : undefined,
        role: values.role === "module_leader" ? "module_leader" : "student",
        moduleLeaderCode: values.role === "module_leader" ? values.moduleLeaderCode?.trim() : undefined,
      });
      if (values.role === "class_student") {
        setClassStudent(user);
        return;
      }
      await navigate({ to: user.role === "module_leader" ? ROUTES.TEACHER : ROUTES.PROFILE_SETUP, replace: true });
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Signup failed. Please try again.",
      });
    }
  }

  if (classStudent) {
    return (
      <AuthLayout
        eyebrow="Join your classroom"
        title="Enter the class code from your module leader."
        subtitle="This connects your new student account to the correct classroom."
      >
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Class student</div>
          <h2 className="mt-3 font-display text-3xl leading-tight">Join a class</h2>
          <p className="mt-2 text-sm text-muted-foreground">Signed up as {classStudent.fullName}. Add the class code to continue.</p>
        </div>
        <form
          className="mt-7 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (classCode.trim()) classJoin.join();
          }}
        >
          <Field label="Class code" htmlFor="classCode" error={classJoin.error}>
            <Input
              id="classCode"
              value={classCode}
              onChange={(event) => setClassCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              className="h-12 rounded-xl bg-background/70 px-4 text-lg tracking-[0.2em]"
            />
          </Field>
          {classJoin.success && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="size-4" />
                Joined {classJoin.success}
              </div>
            </div>
          )}
          <Button type="submit" className="h-12 w-full rounded-xl" disabled={!classCode.trim() || classJoin.pending}>
            {classJoin.pending ? <Loader2 className="animate-spin" /> : <UserRoundPlus />}
            Join class and continue
          </Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Begin intelligently"
      title="Create a learner profile EvolvED can grow around."
      subtitle={signupSubtitle(role)}
    >
      <div>
        <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">New profile</div>
        <h2 className="mt-3 font-display text-3xl leading-tight">{signupTitle(role)}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{signupDetail(role)}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
        <input type="hidden" {...register("role")} />
        <div className="grid gap-2 rounded-2xl border border-border bg-background/45 p-1.5 sm:grid-cols-3">
          <RoleButton
            active={role === "student"}
            icon={GraduationCap}
            label="Individual student"
            detail="Full learner profile"
            onClick={() => {
              setValue("role", "student", { shouldValidate: true });
              setValue("moduleLeaderCode", "", { shouldValidate: true });
              setValue("termsAccepted", false, { shouldValidate: true });
            }}
          />
          <RoleButton
            active={role === "class_student"}
            icon={UserRoundPlus}
            label="Class student"
            detail="Join with class code"
            onClick={() => {
              setValue("role", "class_student", { shouldValidate: true });
              setValue("moduleLeaderCode", "", { shouldValidate: true });
              setValue("confirmPassword", "", { shouldValidate: true });
              setValue("termsAccepted", true, { shouldValidate: true });
            }}
          />
          <RoleButton
            active={role === "module_leader"}
            icon={Users}
            label="Module leader"
            detail="Classes, approvals, analytics"
            onClick={() => {
              setValue("role", "module_leader", { shouldValidate: true });
              setValue("age", undefined, { shouldValidate: true });
              setValue("termsAccepted", false, { shouldValidate: true });
            }}
          />
        </div>

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

        {role !== "module_leader" && (
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
        )}

        {role === "module_leader" && (
          <Field label="Module leader access code" htmlFor="moduleLeaderCode" error={errors.moduleLeaderCode?.message}>
            <Input
              id="moduleLeaderCode"
              type="password"
              autoComplete="off"
              className="h-12 rounded-xl bg-background/70 px-4"
              {...register("moduleLeaderCode")}
            />
          </Field>
        )}

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

        {role !== "class_student" && (
          <>
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
                {role === "module_leader"
                  ? "I agree to EvolvED using my account to manage classes, content approvals, and student analytics."
                  : "I agree to EvolvED using my learner profile to personalize lessons and progress insights."}
              </span>
            </label>
          </>
        )}
        {role !== "class_student" && errors.termsAccepted?.message && (
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
          {loading ? <Loader2 className="animate-spin" /> : role === "class_student" ? <ArrowRight /> : <UserPlus />}
          {submitLabel(role)}
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

function RoleButton({
  active,
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-3 text-left transition-colors ${
        active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"
      }`}
      aria-pressed={active}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4" />
        {label}
      </span>
      <span className={`mt-1 block text-xs leading-5 ${active ? "text-background/75" : "text-muted-foreground"}`}>{detail}</span>
    </button>
  );
}

function useClassJoinMutation(
  classStudent: AuthUser | null,
  classCode: string,
  completeProfile: (learningTopic: string, learningProject?: string, preferences?: { accountType?: "individual_student" | "class_student"; educationLevel?: string; pacePreference?: string; preferredModality?: string; topicFamiliarity?: string; learningAvailability?: string; accessibilitySupport?: boolean }) => void,
  navigate: ReturnType<typeof useNavigate>,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  return {
    pending,
    error,
    success,
    join: async () => {
      if (!classStudent || !classCode.trim()) return;
      setPending(true);
      setError("");
      setSuccess("");
      try {
        const joinedClass = await joinClass(classStudent.id, classCode.trim());
        await createLearnerProfile({
          learner_id: classStudent.id,
          age_group: getAgeGroup(classStudent.age),
          education_level: "Classroom learner",
          learning_goal: `Learn with ${joinedClass.name}.`,
          pace_preference: "balanced",
          preferred_modality: ["reading"],
          topic: "Classroom learning",
          topic_familiarity: "beginner",
          accessibility: {
            class_student: true,
            additional_support: false,
            dyslexia_support: false,
            chunked_explanations: false,
            readable_spacing: false,
            focus_mode_available: true,
          },
          learning_availability: "30_min",
          learning_project: joinedClass.name,
        });
        completeProfile("Classroom learning", joinedClass.name, {
          accountType: "class_student",
          educationLevel: "Classroom learner",
          pacePreference: "balanced",
          preferredModality: "reading",
          topicFamiliarity: "beginner",
          learningAvailability: "30_min",
          accessibilitySupport: false,
        });
        setSuccess(joinedClass.name);
        await navigate({ to: ROUTES.KNOWLEDGE, replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not join this class. Check the code and try again.");
      } finally {
        setPending(false);
      }
    },
  };
}

function signupSubtitle(role: SignupFormValues["role"]) {
  if (role === "module_leader") return "Create a module leader workspace for classes, approvals, and student analytics.";
  if (role === "class_student") return "Create a simple student account, then join a module leader's class with a code.";
  return "The first step is simple: a profile that lets EvolvED remember, adapt, and teach with continuity.";
}

function signupTitle(role: SignupFormValues["role"]) {
  if (role === "module_leader") return "Create a module leader account";
  if (role === "class_student") return "Create a class student account";
  return "Create an individual student account";
}

function signupDetail(role: SignupFormValues["role"]) {
  if (role === "module_leader") return "You will go straight to the teacher dashboard after signup.";
  if (role === "class_student") return "Use only your basic details now; the class code comes next.";
  return "Build your adaptive learning space.";
}

function submitLabel(role: SignupFormValues["role"]) {
  if (role === "module_leader") return "Create teacher workspace";
  if (role === "class_student") return "Next: enter class code";
  return "Create learner profile";
}

function getAgeGroup(age: number | undefined) {
  if (!age) return null;
  if (age < 13) return "child";
  if (age < 18) return "teen";
  return "adult";
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
