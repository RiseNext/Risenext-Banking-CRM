"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { api, apiRequest, errorMessage, onForcedSignOut, setAccessToken } from "@/lib/api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
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
  /** Permission checks mirror the server's; the server remains authoritative. */
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [ready, setReady] = React.useState(false);

  // On mount, try the refresh cookie. This is what makes a page reload keep
  // the session without ever putting a token in localStorage.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await apiRequest<{ accessToken: string; user: SessionUser }>(
          "/auth/refresh",
          { method: "POST", skipAuthRetry: true },
        );
        if (cancelled) return;
        setAccessToken(body.accessToken);
        setUser(body.user);
      } catch {
        if (!cancelled) setUser(null);
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
  }, []);

  const signOut = React.useCallback(async () => {
    try {
      await api.action("/auth/logout");
    } catch {
      /* signing out locally matters more than the server acknowledging it */
    }
    setAccessToken(null);
    setUser(null);
    router.replace("/login");
  }, [router]);

  const can = React.useCallback(
    (permission: string) => user?.permissions.includes(permission) ?? false,
    [user],
  );
  const canAny = React.useCallback(
    (...permissions: string[]) => permissions.some((p) => user?.permissions.includes(p)),
    [user],
  );

  const value = React.useMemo(
    () => ({ user, ready, signIn, signOut, can, canAny }),
    [user, ready, signIn, signOut, can, canAny],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export { errorMessage };
