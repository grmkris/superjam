"use client";

// Login seam (pivot §1). With Dynamic's React SDK we no longer own the auth UI —
// `openLogin()` opens Dynamic's built-in auth-flow modal (email OTP + Google, per
// the dashboard config), which also auto-creates the embedded EVM wallet on first
// sign-in. Exposed app-wide via useLogin().openLogin(); the optional email arg is
// accepted for call-site compatibility but the modal collects it. LoginProvider
// must live INSIDE <DynamicContextProvider> (it reads setShowAuthFlow).
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { createContext, useCallback, useContext, type ReactNode } from "react";

interface LoginApi {
  /** Open Dynamic's auth-flow modal. (email arg accepted but unused — the modal
   *  prompts for it.) */
  openLogin: (email?: string) => void;
}

const LoginContext = createContext<LoginApi | null>(null);

export function useLogin(): LoginApi {
  const ctx = useContext(LoginContext);
  if (!ctx) throw new Error("useLogin must be used within <LoginProvider>");
  return ctx;
}

export function LoginProvider({ children }: { children: ReactNode }) {
  const { setShowAuthFlow } = useDynamicContext();
  const openLogin = useCallback(() => setShowAuthFlow(true), [setShowAuthFlow]);
  return (
    <LoginContext.Provider value={{ openLogin }}>
      {children}
    </LoginContext.Provider>
  );
}
