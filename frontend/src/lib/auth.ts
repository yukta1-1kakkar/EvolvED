import { apiRequest } from "@/lib/api/client";

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  age?: number;
  profileComplete?: boolean;
  learningTopic?: string;
  learningProject?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface SignupCredentials {
  fullName: string;
  email: string;
  password: string;
  age: number;
}

interface BackendAuthUser {
  id: string;
  full_name: string;
  email: string;
  age?: number | null;
  profile_complete: boolean;
  learning_topic?: string | null;
  learning_project?: string | null;
}

const AUTH_USER_KEY = "evolved.auth.user";
const AUTH_REMEMBER_KEY = "evolved.auth.remember";

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(AUTH_USER_KEY) ?? window.sessionStorage.getItem(AUTH_USER_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as AuthUser;
  } catch {
    clearStoredUser();
    return null;
  }
}

export function persistUser(user: AuthUser, rememberMe = true) {
  const storage = rememberMe ? window.localStorage : window.sessionStorage;
  const otherStorage = rememberMe ? window.sessionStorage : window.localStorage;
  storage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  otherStorage.removeItem(AUTH_USER_KEY);
  window.localStorage.setItem(AUTH_REMEMBER_KEY, String(rememberMe));
}

export function completeStoredProfile(user: AuthUser, learningTopic: string, learningProject: string): AuthUser {
  const updatedUser = { ...user, profileComplete: true, learningTopic, learningProject };
  persistUser(updatedUser, window.localStorage.getItem(AUTH_REMEMBER_KEY) !== "false");
  return updatedUser;
}

export function clearStoredUser() {
  window.localStorage.removeItem(AUTH_USER_KEY);
  window.sessionStorage.removeItem(AUTH_USER_KEY);
  window.localStorage.removeItem(AUTH_REMEMBER_KEY);
}

export async function mockLogin({ rememberMe, ...credentials }: LoginCredentials): Promise<AuthUser> {
  const response = await apiRequest<BackendAuthUser, Omit<LoginCredentials, "rememberMe">>("/auth/login", {
    method: "POST",
    body: credentials,
  });
  const user = fromBackend(response);
  persistUser(user, rememberMe ?? true);
  return user;
}

export async function mockSignup(credentials: SignupCredentials): Promise<AuthUser> {
  const response = await apiRequest<BackendAuthUser, { full_name: string; email: string; password: string; age: number }>("/auth/signup", {
    method: "POST",
    body: { full_name: credentials.fullName, email: credentials.email, password: credentials.password, age: credentials.age },
  });
  const user = fromBackend(response);
  persistUser(user, true);
  return user;
}

export async function mockForgotPassword(): Promise<void> {
  throw new Error("Password reset delivery has not been configured yet.");
}

function fromBackend(user: BackendAuthUser): AuthUser {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    age: user.age ?? undefined,
    profileComplete: user.profile_complete,
    learningTopic: user.learning_topic ?? undefined,
    learningProject: user.learning_project ?? undefined,
  };
}
