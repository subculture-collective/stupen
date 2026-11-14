import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useCallback, useEffect, useState } from "react";

import { type AccountInfo, auth, BASE } from "./api.ts";

const when = (t: number) => (t ? new Date(t).toLocaleString() : "never");

function device(agent: string): string {
  const browser = /Firefox\//.test(agent) ? "Firefox" : /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(agent) ? "iOS" : /Android/.test(agent) ? "Android" : /Mac OS X/.test(agent) ? "macOS" : /Windows/.test(agent) ? "Windows" : /Linux/.test(agent) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Account settings: how you sign in, passkeys and signed-in devices. */
export function Account() {
  const [info, setInfo] = useState<AccountInfo>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [keyName, setKeyName] = useState("");

  const reload = useCallback(() => auth.account().then(setInfo, (e) => setError((e as Error).message)), []);
  useEffect(() => void reload(), [reload]);

  const act = async (f: () => Promise<unknown>, done?: string) => {
    setError(undefined);
    setNote(undefined);
    try {
      await f();
      if (done) setNote(done);
      await reload();
    } catch (e) {
      const err = e as Error;
      if (err.name !== "NotAllowedError") setError(err.message);
    }
  };

  const addPasskey = () =>
    act(async () => {
      const options = await auth.addPasskeyOptions();
      const response = await startRegistration({ optionsJSON: options });
      await auth.addPasskey(response, keyName.trim() || device(navigator.userAgent));
      setKeyName("");
    }, "Passkey added. You can sign in with it next time.");

  if (!info) return <p className="loading">{error ?? "Loading…"}</p>;
  const github = info.identities.find((i) => i.provider === "github");
  return (
    <section className="account">
      <h1>Account</h1>
      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <h2>Sign-in</h2>
        <p>
          Email: <strong>{info.email ?? "none"}</strong>
          {info.isAdmin && <span className="pill"> admin</span>}
        </p>
        <p>
          GitHub:{" "}
          {github ? (
            <strong>@{github.login}</strong>
          ) : info.github ? (
            <a href={`${BASE}/auth/github`}>Connect GitHub</a>
          ) : (
            <span className="muted">not available on this server</span>
          )}
        </p>
        <p className="muted small">Account created {when(info.createdAt)}.</p>
      </div>

      <div className="card">
        <h2>Passkeys</h2>
        <p className="muted small">A passkey signs you in with your device's fingerprint, face or PIN, without email.</p>
        {info.passkeys.length > 0 && (
          <ul className="plain-list">
            {info.passkeys.map((p) => (
              <li key={p.id} className="row wrap">
                <strong>{p.name}</strong>
                <span className="muted small">
                  added {when(p.createdAt)}, last used {when(p.lastUsed)}
                </span>
                <button type="button" className="small-button" onClick={() => act(() => auth.deletePasskey(p.id), "Passkey removed.")}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {browserSupportsWebAuthn() ? (
          <div className="row wrap">
            <input aria-label="Passkey name" placeholder={device(navigator.userAgent)} value={keyName} onChange={(e) => setKeyName(e.target.value)} style={{ maxWidth: 260 }} />
            <button type="button" className="primary" onClick={addPasskey}>
              Add a passkey
            </button>
          </div>
        ) : (
          <p className="muted small">This browser does not support passkeys.</p>
        )}
      </div>

      <div className="card">
        <h2>Signed-in devices</h2>
        <ul className="plain-list">
          {info.sessions.map((s) => (
            <li key={s.id}>
              <strong>{device(s.agent)}</strong> <span className="muted small">via {s.method}, last active {when(s.lastUsed)}</span> {s.current && <span className="pill">this device</span>}
            </li>
          ))}
        </ul>
        <div className="row wrap">
          {info.sessions.length > 1 && (
            <button type="button" onClick={() => act(() => auth.endOtherSessions(), "Signed out everywhere else.")}>
              Sign out other devices
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              await auth.logout().catch(() => {});
              location.replace(`${BASE}/#/`);
              location.reload();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </section>
  );
}
