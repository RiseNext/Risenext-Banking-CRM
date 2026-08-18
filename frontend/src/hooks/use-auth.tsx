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

  /** Permission checks mirror the server's; the server remains authoritative. */
  can: (permission: string) => boolean;

  canAny: (...permissions: string[]) => boolean;
}

const AUTH_STORAGE_KEY = "risenext-auth-user";

/**
 * Persist the authenticated user locally.
 *
 * The access token is intentionally NOT stored in localStorage.
 * The refresh cookie remains responsible for restoring the session.
 */
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

  /**
   * Restore cached user immediately, then validate the session
   * using the refresh cookie.
   */
  React.useEffect(() => {
    let cancelled = false;

    // Restore cached user for faster UI rendering.
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
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }

    /**
     * Validate/restore the session from the refresh cookie.
     */
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
        if (cancelled) return;

        setAccessToken(null);
        setUser(null);
        persistAuthUser(null);
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

  /**
   * Listen for forced logout events, for example when
   * the API detects an invalid/expired session.
   */
  React.useEffect(() => {
    return onForcedSignOut(() => {
      setAccessToken(null);
      setUser(null);
      persistAuthUser(null);

      router.replace("/login");
    });
  }, [router]);

  /**
   * Sign in.
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

  /**
   * Sign out.
   */
  const signOut = React.useCallback(async () => {
    try {
      await api.action("/auth/logout");
    } catch {
      // Local logout should still happen even if the server
      // does not acknowledge the logout request.
    }

    setAccessToken(null);
    setUser(null);
    persistAuthUser(null);

    router.replace("/login");
  }, [router]);

  /**
   * Update the current user's locally stored profile.
   *
   * This updates the frontend session state.
   * The actual backend profile API should be called separately
   * if permanent server-side profile persistence is required.
   */
  const updateUser = React.useCallback(
    (next: Partial<SessionUser>) => {
      setUser((current) => {
        if (!current) {
          return null;
        }

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

  /**
   * Check a single permission.
   */
  const can = React.useCallback(
    (permission: string) => {
      return user?.permissions.includes(permission) ?? false;
    },
    [user],
  );

  /**
   * Check whether the user has at least one of the
   * supplied permissions.
   */
  const canAny = React.useCallback(
    (...permissions: string[]) => {
      if (!user) return false;

      return permissions.some((permission) =>
        user.permissions.includes(permission),
      );
    },
    [user],
  );

  /**
   * Context value.
   */
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

/**
 * Access authentication context.
 */
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
