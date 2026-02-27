"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem("blog_token");
    if (stored) {
      setToken(stored);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!loading && !token && pathname !== "/login") {
      router.push("/login");
    }
  }, [loading, token, pathname, router]);

  function login(newToken) {
    localStorage.setItem("blog_token", newToken);
    setToken(newToken);
    router.push("/");
  }

  function logout() {
    localStorage.removeItem("blog_token");
    setToken(null);
    router.push("/login");
  }

  // Wrapper around fetch that auto-logouts on 401
  async function authFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      logout();
      throw new Error("Session expired, please log in again");
    }

    return res;
  }

  if (loading) {
    return null;
  }

  if (!token && pathname !== "/login") {
    return null;
  }

  return (
    <AuthContext.Provider value={{ token, login, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}
