import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";

import { type AuthConfig, auth, BASE } from "./api.ts";

/** The signed-out page: an email link, GitHub, or a passkey. */
export function SignIn(props: { config: AuthConfig; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("error") ?? "");
  const passkeys = props.config.passkeys && browserSupportsWebAuthn();

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.email(email);
      setSent(email);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const passkey = async () => {
    setError("");
    try {
      const options = await auth.passkeyOptions();
      const response = await startAuthentication({ optionsJSON: options });
      await auth.passkeyVerify(response);
      props.onSignedIn();
    } catch (err) {
      const e = err as Error;
      if (e.name !== "NotAllowedError") setError(e.message);
    }
  };

  return (
    <main className="signin">
      <div className="signin-card">
        <p className="brand signin-brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M3 29V21H11V14H19V7H29V29Z" fill="currentColor" />
            <rect x="19" y="4" width="10" height="3" fill="#f5c400" />
          </svg>
          stupen
        </p>
        <h1>Sign in</h1>
        <p className="muted">A practice coach that helps exactly as much as you ask. {props.config.signup ? "New here? Signing in creates your account." : "Sign-up is closed; existing accounts only."}</p>
        {sent ? (
          <div className="notice" role="status">
            <p>
              <strong>Check your email.</strong> We sent a sign-in link to {sent}. It works once and expires in 15 minutes.
            </p>
            <p>
              <button type="button" className="link" onClick={() => setSent(undefined)}>
                Use a different address
              </button>
            </p>
          </div>
        ) : (
          <form onSubmit={sendLink} className="signin-form">
            <label className="block" htmlFor="signin-email">
              Email
            </label>
            <input id="signin-email" type="email" autoComplete="email webauthn" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="primary" disabled={busy || !email}>
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}
        {(props.config.github || passkeys) && <p className="signin-or small muted">or</p>}
        <div className="signin-alt">
          {props.config.github && (
            <a className="button" href={`${BASE}/auth/github`}>
              Continue with GitHub
            </a>
          )}
          {passkeys && (
            <button type="button" onClick={passkey}>
              Sign in with a passkey
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="small muted signin-fine">
          Stupen is a SUBCULT project. <a href="https://stupen.subcult.tv/">About</a> · <a href="https://stupen.subcult.tv/privacy/">Privacy</a> · <a href="https://stupen.subcult.tv/terms/">Terms</a>
        </p>
      </div>
    </main>
  );
}

/** Each emailed token is used once, even when React runs effects twice. */
const verifying = new Map<string, Promise<unknown>>();

/** Opened from the emailed link: #/verify/<token>. */
export function Verify(props: { token: string; onSignedIn: () => void }) {
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    if (!verifying.has(props.token)) verifying.set(props.token, auth.verify(props.token));
    verifying.get(props.token)!.then(
      () => {
        if (!live) return;
        location.replace(`${BASE}/#/`);
        props.onSignedIn();
      },
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.token]);
  return (
    <main className="signin">
      <div className="signin-card">
        <h1>Signing you in…</h1>
        {error && (
          <>
            <p className="error" role="alert">
              {error}
            </p>
            <a className="button primary" href="#/signin">
              Back to sign-in
            </a>
          </>
        )}
      </div>
    </main>
  );
}
