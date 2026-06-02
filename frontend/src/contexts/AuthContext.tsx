import { createContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  clearStoredUser,
  completeStoredProfile,
  getStoredUser,
  mockForgotPassword,
  mockLogin,
  mockSignup,
  type AuthUser,
  type LoginCredentials,
  type ProfilePreferences,
  type SignupCredentials,
} from "@/lib/auth";

interface AuthContextValue {
  currentUser: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (credentials: LoginCredentials) => Promise<AuthUser>;
  signup: (credentials: SignupCredentials) => Promise<AuthUser>;
  completeProfile: (learningTopic: string, learningProject?: string, preferences?: ProfilePreferences) => void;
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
          setCurrentUser(user);
          return user;
        } finally {
          setLoading(false);
        }
      },
      completeProfile: (learningTopic, learningProject, preferences) => {
        if (currentUser) {
          setCurrentUser(completeStoredProfile(currentUser, learningTopic, learningProject, preferences));
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
