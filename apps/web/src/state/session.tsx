import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";

export type MeUser = {
  id: string;
  email: string;
  displayName: string | null;
  roles: string[];
};

type SessionState = {
  user: MeUser | null;
  loading: boolean;
  refreshMe: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    const res = await apiFetch("/me");
    if (res.status === 401) {
      setUser(null);
      return;
    }
    if (!res.ok) {
      setUser(null);
      return;
    }
    setUser(await readJson<MeUser>(res));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/me");
        if (cancelled) return;
        if (res.ok) {
          setUser(await readJson<MeUser>(res));
        } else {
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }
    const meRes = await apiFetch("/me");
    if (!meRes.ok) {
      throw new Error(await readErrorMessage(meRes));
    }
    setUser(await readJson<MeUser>(meRes));
  }, []);

  const value = useMemo(
    () => ({ user, loading, refreshMe, login }),
    [user, loading, refreshMe, login],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
