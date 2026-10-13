// Provides authentication state and authentication-related actions to the React application.
// User state is kept purely in React memory and revalidated against the server via HttpOnly cookie.
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { AuthUser } from "@/lib/types";
import { getCurrentUserFn, logoutUserFn } from "@/lib/server-fns";

type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (user: AuthUser) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Clears in-memory auth state without revoking the server session (used on 401 expiry). */
  expireSession: () => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  login: () => {},
  logout: async () => {},
  refresh: async () => {},
  expireSession: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Validate the session on mount by checking the HttpOnly cookie with the server
  const checkAuth = useCallback(async () => {
    try {
      const currentUser = await getCurrentUserFn();
      setUser(currentUser);
    } catch (e) {
      console.error("Failed to authenticate session:", e);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  function login(userData: AuthUser) {
    setUser(userData);
  }

  function expireSession() {
    setUser(null);
  }

  async function logout() {
    setUser(null);
    try {
      await logoutUserFn();
    } catch (e) {
      console.error("Logout error:", e);
    }
  }

  async function refresh() {
    setIsLoading(true);
    await checkAuth();
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refresh, expireSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
