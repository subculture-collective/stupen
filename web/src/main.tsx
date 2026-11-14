import { StrictMode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { type AuthConfig, auth, SignInRequired } from "./api.ts";
import { App } from "./App.tsx";
import { SignIn, Verify } from "./SignIn.tsx";
import "./styles.css";

const useHash = () =>
  useSyncExternalStore(
    (cb) => {
      addEventListener("hashchange", cb);
      return () => removeEventListener("hashchange", cb);
    },
    () => location.hash,
  );

/** Shows sign-in until there is a session (accounts mode); otherwise the app. */
function Gate() {
  const h = useHash();
  const [config, setConfig] = useState<AuthConfig>();
  const [signedIn, setSignedIn] = useState<boolean>();
  const [error, setError] = useState<string>();

  const check = useCallback(async () => {
    try {
      const c = await auth.config();
      setConfig(c);
      if (c.mode !== "accounts") return setSignedIn(true);
      await auth.account();
      setSignedIn(true);
    } catch (e) {
      if (e instanceof SignInRequired) setSignedIn(false);
      else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void check();
    const out = () => setSignedIn(false);
    addEventListener("stupen:signin", out);
    return () => removeEventListener("stupen:signin", out);
  }, [check]);

  const verify = /^#\/verify\/([A-Za-z0-9_-]+)/.exec(h)?.[1];
  if (verify) return <Verify token={verify} onSignedIn={() => void check()} />;
  if (error) return <p className="loading">{error}</p>;
  if (!config || signedIn === undefined) return <p className="loading">Loading…</p>;
  if (!signedIn) return <SignIn config={config} onSignedIn={() => void check()} />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
);
