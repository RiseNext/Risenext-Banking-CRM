"use client";

import * as React from "react";
import { api, errorMessage, type Paginated } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export interface ResourceState<T> {
  data: T[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  setData: React.Dispatch<React.SetStateAction<T[]>>;
}

type Query = Record<string, string | number | boolean | undefined | null>;

/**
 * Loads a collection from the API. Returns an empty array (never fixtures)
 * while loading or on error, so a failure can't be mistaken for real data.
 */
export function useResource<T>(path: string, query?: Query, enabled = true): ResourceState<T> {
  const { user } = useAuth();
  const [data, setData] = React.useState<T[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const queryKey = JSON.stringify(query ?? {});

  React.useEffect(() => {
    let disabled = false;
    if (!enabled || !user) {
      disabled = true;
      void Promise.resolve().then(() => {
        if (!disabled) return;
        setLoading(false);
      });
      return () => {
        disabled = false;
      };
    }
    const controller = new AbortController();
    let cancelled = false;

    // Kicked off in a microtask so the state updates happen in the async
    // continuation rather than synchronously inside the effect body.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    api
      .list<T>(path, JSON.parse(queryKey) as Query)
      .then((body: Paginated<T>) => {
        if (cancelled) return;
        setData(body.data ?? []);
        setTotal(body.meta?.total ?? body.data?.length ?? 0);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setError(errorMessage(err, "Could not load this list"));
        setData([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, queryKey, nonce, enabled, user]);

  const refresh = React.useCallback(() => setNonce((n) => n + 1), []);

  return { data, total, loading, error, refresh, setData };
}

/** Single record by id. */
export function useRecord<T>(path: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { user } = useAuth();
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(Boolean(path));
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let disabled = false;
    if (!path || !user) {
      disabled = true;
      void Promise.resolve().then(() => {
        if (!disabled) return;
        setLoading(false);
      });
      return () => {
        disabled = false;
      };
    }
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    api
      .get<T>(path)
      .then((body) => {
        if (!cancelled) setData(body.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errorMessage(err, "Could not load this record"));
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, nonce, user]);

  return { data, loading, error, refresh: React.useCallback(() => setNonce((n) => n + 1), []) };
}

/** Dashboard statistics. Zeroes on an empty database, never invented numbers. */
export function useStats<T extends Record<string, unknown>>(path: string) {
  const { user } = useAuth();
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    if (!user) {
      void Promise.resolve().then(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }
    api
      .get<T>(path)
      .then((body) => {
        if (!cancelled) setData(body.data);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, user]);

  const num = React.useCallback(
    (key: string): number => Number((data as Record<string, unknown> | null)?.[key] ?? 0),
    [data],
  );

  return { data, loading, num };
}
