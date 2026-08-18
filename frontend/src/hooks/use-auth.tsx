"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  api,
  apiRequest,
  errorMessage,
  onForcedSignOut,
  setAccessToken,
} from "@/lib/api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;

  phone?: string | null;
  avatarUrl?: string | null;

  role: {
    id: string;
    key: string;
    name: string;
    level: number;
  };

  permissions: string[];
  bankIds: string[] | null;
  unrestrictedBankAccess: boolean;
}

interface AuthContextValue {
  user: SessionUser | null;
  ready: boolean;

  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;

  updateUser: (next: Partial<SessionUser>) => void;

  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

const AUTH_STORAGE_KEY = "risenext-auth-user";

function persistAuthUser(user: SessionUser | null) {
  if (typeof window === "undefined") return;

  if (user) {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify(user),
    );
  } else {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [ready, setReady] = React.useState(false);

  /*
   * Restore cached user and refresh the server session.
   */
  React.useEffect(() => {
    let cancelled = false;

    if (typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(
          AUTH_STORAGE_KEY,
        );

        if (stored) {
          const parsed = JSON.parse(stored) as SessionUser;

          if (parsed?.id) {
            setUser(parsed);
          }
        }
      } catch {
        // Ignore invalid cached session data.
      }
    }

    (async () => {
      try {
        const body = await apiRequest<{
          accessToken: string;
          user: SessionUser;
        }>("/auth/refresh", {
          method: "POST",
          skipAuthRetry: true,
        });

        if (cancelled) return;

        setAccessToken(body.accessToken);
        setUser(body.user);
        persistAuthUser(body.user);
      } catch {
        if (!cancelled) {
          setUser(null);
          persistAuthUser(null);
          setAccessToken(null);
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Handle forced logout from API layer.
   */
  React.useEffect(
    () =>
      onForcedSignOut(() => {
        setUser(null);
        persistAuthUser(null);
        setAccessToken(null);

        router.replace("/login");
      }),
    [router],
  );

  /*
   * Login
   */
  const signIn = React.useCallback(
    async (email: string, password: string) => {
      const body = await apiRequest<{
        accessToken: string;
        user: SessionUser;
      }>("/auth/login", {
        method: "POST",
        body: {
          email,
          password,
        },
        skipAuthRetry: true,
      });

      setAccessToken(body.accessToken);
      setUser(body.user);
      persistAuthUser(body.user);
    },
    [],
  );

  /*
   * Logout
   */
  const signOut = React.useCallback(async () => {
    try {
      await api.action("/auth/logout");
    } catch {
      // Local logout should still happen.
    }

    setAccessToken(null);
    setUser(null);
    persistAuthUser(null);

    router.replace("/login");
  }, [router]);

  /*
   * Update logged-in user profile.
   */
  const updateUser = React.useCallback(
    (next: Partial<SessionUser>) => {
      setUser((current) => {
        if (!current) return null;

        const merged: SessionUser = {
          ...current,
          ...next,
        };

        persistAuthUser(merged);

        return merged;
      });
    },
    [],
  );

  /*
   * Permission checks.
   */
  const can = React.useCallback(
    (permission: string) =>
      user?.permissions?.includes(permission) ?? false,
    [user],
  );

  const canAny = React.useCallback(
    (...permissions: string[]) =>
      permissions.some(
        (permission) =>
          user?.permissions?.includes(permission) ?? false,
      ),
    [user],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      signIn,
      signOut,
      updateUser,
      can,
      canAny,
    }),
    [
      user,
      ready,
      signIn,
      signOut,
      updateUser,
      can,
      canAny,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = React.useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider",
    );
  }

  return context;
}

export { errorMessage };
