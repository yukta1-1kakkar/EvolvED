import { createContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  clearStoredUser,
  getStoredUser,
  mockForgotPassword,
  mockLogin,
  mockSignup,
  type AuthUser,
  type LoginCredentials,
  type SignupCredentials,
} from "@/lib/auth";
import { createLearnerProfile } from "@/lib/api";

interface AuthContextValue {
  currentUser: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (credentials: LoginCredentials) => Promise<AuthUser>;
  signup: (credentials: SignupCredentials) => Promise<AuthUser>;
  forgotPassword: (email: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setCurrentUser(getStoredUser());
    setLoading(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      isAuthenticated: Boolean(currentUser),
      loading,
      login: async (credentials) => {
        setLoading(true);
        try {
          const user = await mockLogin(credentials);
          setCurrentUser(user);
          return user;
        } finally {
          setLoading(false);
        }
      },
      signup: async (credentials) => {
        setLoading(true);
        try {
          const user = await mockSignup(credentials);
          await createLearnerProfile({
            learner_id: user.id,
            age_group: getAgeGroup(credentials.age),
            education_level: null,
            learning_goal: null,
            pace_preference: null,
            preferred_modality: [],
            topic: null,
            topic_familiarity: null,
            accessibility: {},
          });
          setCurrentUser(user);
          return user;
        } finally {
          setLoading(false);
        }
      },
      forgotPassword: async (email) => {
        setLoading(true);
        try {
          await mockForgotPassword(email);
        } finally {
          setLoading(false);
        }
      },
      logout: () => {
        clearStoredUser();
        setCurrentUser(null);
      },
    }),
    [currentUser, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function getAgeGroup(age: number) {
  if (age < 13) return "child";
  if (age < 18) return "teen";
  return "adult";
}
