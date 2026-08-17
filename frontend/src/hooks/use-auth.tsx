"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { api, apiRequest, errorMessage, onForcedSignOut, setAccessToken } from "@/lib/api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
<<<<<<< HEAD
=======
  phone?: string | null;
  avatarUrl?: string | null;
>>>>>>> a52d548 (Initial commit)
  role: { id: string; key: string; name: string; level: number };
  permissions: string[];
  bankIds: string[] | null;
  unrestrictedBankAccess: boolean;
}

interface AuthContextValue {
  user: SessionUser | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
<<<<<<< HEAD
=======
  updateUser: (next: Partial<SessionUser>) => void;
>>>>>>> a52d548 (Initial commit)
  /** Permission checks mirror the server's; the server remains authoritative. */
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

<<<<<<< HEAD
=======
const AUTH_STORAGE_KEY = "risenext-auth-user";

function persistAuthUser(user: SessionUser | null) {
  if (typeof window === "undefined") return;
  if (user) {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    return;
  }
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

>>>>>>> a52d548 (Initial commit)
const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [ready, setReady] = React.useState(false);

  // On mount, try the refresh cookie. This is what makes a page reload keep
  // the session without ever putting a token in localStorage.
  React.useEffect(() => {
    let cancelled = false;
<<<<<<< HEAD
=======

    if (typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as SessionUser;
          if (parsed?.id) {
            setUser(parsed);
          }
        }
      } catch {
        // Ignore invalid cached session data and rely on the server.
      }
    }

>>>>>>> a52d548 (Initial commit)
    (async () => {
      try {
        const body = await apiRequest<{ accessToken: string; user: SessionUser }>(
          "/auth/refresh",
          { method: "POST", skipAuthRetry: true },
        );
        if (cancelled) return;
        setAccessToken(body.accessToken);
        setUser(body.user);
<<<<<<< HEAD
      } catch {
        if (!cancelled) setUser(null);
=======
        persistAuthUser(body.user);
      } catch {
        if (!cancelled) {
          setUser(null);
          persistAuthUser(null);
        }
>>>>>>> a52d548 (Initial commit)
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(
    () =>
      onForcedSignOut(() => {
        setUser(null);
<<<<<<< HEAD
=======
        persistAuthUser(null);
>>>>>>> a52d548 (Initial commit)
        router.replace("/login");
      }),
    [router],
  );

  const signIn = React.useCallback(async (email: string, password: string) => {
    const body = await apiRequest<{ accessToken: string; user: SessionUser }>("/auth/login", {
      method: "POST",
      body: { email, password },
      skipAuthRetry: true,
    });
    setAccessToken(body.accessToken);
    setUser(body.user);
<<<<<<< HEAD
=======
    persistAuthUser(body.user);
>>>>>>> a52d548 (Initial commit)
  }, []);

  const signOut = React.useCallback(async () => {
    try {
      await api.action("/auth/logout");
    } catch {
      /* signing out locally matters more than the server acknowledging it */
    }
    setAccessToken(null);
    setUser(null);
<<<<<<< HEAD
    router.replace("/login");
  }, [router]);

=======
    persistAuthUser(null);
    router.replace("/login");
  }, [router]);

  const updateUser = React.useCallback((next: Partial<SessionUser>) => {
    setUser((current) => {
      const merged = current ? { ...current, ...next } : null;
      persistAuthUser(merged);
      return merged;
    });
  }, []);

>>>>>>> a52d548 (Initial commit)
  const can = React.useCallback(
    (permission: string) => user?.permissions.includes(permission) ?? false,
    [user],
  );
  const canAny = React.useCallback(
    (...permissions: string[]) => permissions.some((p) => user?.permissions.includes(p)),
    [user],
  );

  const value = React.useMemo(
<<<<<<< HEAD
    () => ({ user, ready, signIn, signOut, can, canAny }),
    [user, ready, signIn, signOut, can, canAny],
=======
    () => ({ user, ready, signIn, signOut, updateUser, can, canAny }),
    [user, ready, signIn, signOut, updateUser, can, canAny],
>>>>>>> a52d548 (Initial commit)
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export { errorMessage };
