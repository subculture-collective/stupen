import { useCallback, useEffect, useState } from "react";

import { type AdminAccount, auth } from "./api.ts";

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const day = (t: number) => (t ? new Date(t).toLocaleDateString() : "never");

/** Admins: every account, with disable and delete. */
export function Admin() {
  const [rows, setRows] = useState<AdminAccount[]>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState("");
  const reload = useCallback(() => auth.adminAccounts().then(setRows, (e) => setError((e as Error).message)), []);
  useEffect(() => void reload(), [reload]);
  const act = async (f: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await f();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const shown = rows?.filter((r) => !filter || `${r.email} ${r.name} ${r.id}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <section className="account admin">
      <h1>Accounts</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {rows && (
        <p className="small muted">
          {rows.length} accounts · {rows.filter((r) => r.disabled).length} disabled · {mb(rows.reduce((n, r) => n + r.bytes, 0))} stored
        </p>
      )}
      <input aria-label="Filter accounts" placeholder="Filter by email or id" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 320 }} />
      {!shown ? (
        <p className="loading">Loading…</p>
      ) : (
        <div className="tablewrap card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Created</th>
                <th>Last seen</th>
                <th>Tracks</th>
                <th>Storage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={r.disabled ? "dim" : ""}>
                  <td>
                    <strong>{r.email ?? r.name ?? r.id}</strong> {r.isAdmin && <span className="pill">admin</span>} {r.disabled && <span className="pill pill-warn">disabled</span>}
                    <div className="small muted">{r.id}</div>
                  </td>
                  <td>{day(r.createdAt)}</td>
                  <td>{day(r.lastSeen)}</td>
                  <td>{r.tracks}</td>
                  <td>{mb(r.bytes)}</td>
                  <td>
                    {!r.isAdmin && (
                      <div className="row">
                        <button type="button" className="small-button" onClick={() => act(() => auth.adminSetDisabled(r.id, !r.disabled))}>
                          {r.disabled ? "Enable" : "Disable"}
                        </button>
                        <button
                          type="button"
                          className="small-button"
                          onClick={() => {
                            if (confirm(`Delete ${r.email ?? r.id} and all their data? This cannot be undone.`)) void act(() => auth.adminDelete(r.id));
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
