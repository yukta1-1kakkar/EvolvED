import { v4 as uuidv4 } from "uuid";
export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  age?: number;
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

const AUTH_USER_KEY = "evolved.auth.user";
const AUTH_REMEMBER_KEY = "evolved.auth.remember";

const wait = (ms = 850) => new Promise((resolve) => window.setTimeout(resolve, ms));

function createUser(email: string, fullName = "Maya Learner", age?: number): AuthUser {
  return {
    id: uuidv4(),
    fullName,
    email: email.toLowerCase(),
    age,
  };
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored =
    window.localStorage.getItem(AUTH_USER_KEY) ?? window.sessionStorage.getItem(AUTH_USER_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as AuthUser;
  } catch {
    window.localStorage.removeItem(AUTH_USER_KEY);
    window.sessionStorage.removeItem(AUTH_USER_KEY);
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

export function clearStoredUser() {
  window.localStorage.removeItem(AUTH_USER_KEY);
  window.sessionStorage.removeItem(AUTH_USER_KEY);
  window.localStorage.removeItem(AUTH_REMEMBER_KEY);
}

export async function mockLogin({
  email,
  password,
  rememberMe,
}: LoginCredentials): Promise<AuthUser> {
  await wait();

  if (password.toLowerCase().includes("error")) {
    throw new Error("We could not verify those credentials. Try a different password.");
  }

  const user = createUser(email);
  persistUser(user, rememberMe ?? true);
  return user;
}

export async function mockSignup({ fullName, email, age }: SignupCredentials): Promise<AuthUser> {
  await wait(950);

  if (email.toLowerCase().includes("taken")) {
    throw new Error("An EvolvED account already exists for this email.");
  }

  const user = createUser(email, fullName, age);
  persistUser(user, true);
  return user;
}

export async function mockForgotPassword(email: string): Promise<void> {
  await wait(800);

  if (email.toLowerCase().includes("fail")) {
    throw new Error("We could not send reset instructions right now. Please try again.");
  }
}
