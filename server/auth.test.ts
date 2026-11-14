import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { test } from "node:test";

import { sendSignInLink, sessionAccount, startSession, endSession, useSignInLink } from "./auth.ts";
import { config } from "./config.ts";
import { useMemoryDatabase } from "./db.ts";

useMemoryDatabase();

const fakeReq = (headers: Record<string, string> = {}, ip = "203.0.113.7") => ({ headers, socket: { remoteAddress: ip } }) as unknown as IncomingMessage;

async function linkFor(email: string, ip?: string): Promise<string> {
  const logged: string[] = [];
  const orig = console.log;
  console.log = (m: string) => logged.push(m);
  try {
    await sendSignInLink(email, fakeReq({}, ip));
  } finally {
    console.log = orig;
  }
  const m = /#\/verify\/([A-Za-z0-9_-]+)/.exec(logged.join("\n"));
  assert.ok(m, "a sign-in link is logged in development");
  return m[1]!;
}

const sessionCookie = (setCookie: string) => ({ cookie: setCookie.split(";")[0]! });

test("an email link signs in once, creates the account, and starts a session", async () => {
  const t = await linkFor("Learner@Example.org");
  const a = useSignInLink(t, fakeReq());
  assert.equal(a.email, "learner@example.org");
  assert.match(a.id, /^u[a-z0-9]{14}$/);
  assert.throws(() => useSignInLink(t, fakeReq()), /already used|expired/);

  const set = startSession(a.id, "email", fakeReq());
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  const signedIn = sessionAccount(fakeReq(sessionCookie(set)));
  assert.equal(signedIn?.id, a.id);

  endSession(fakeReq(sessionCookie(set)));
  assert.equal(sessionAccount(fakeReq(sessionCookie(set))), undefined);
});

test("signing in again with the same email reaches the same account", async () => {
  const a = useSignInLink(await linkFor("same@example.org"), fakeReq());
  const b = useSignInLink(await linkFor("SAME@example.org"), fakeReq());
  assert.equal(a.id, b.id);
});

test("legacy users keep their folder and admin follows ADMIN_EMAILS", async () => {
  config.legacyUsers.set("owner@example.org", "owner");
  config.adminEmails.add("owner@example.org");
  const a = useSignInLink(await linkFor("owner@example.org"), fakeReq());
  assert.equal(a.id, "owner");
  assert.equal(a.isAdmin, true);
  config.adminEmails.delete("owner@example.org");
  const set = startSession(a.id, "email", fakeReq());
  assert.equal(sessionAccount(fakeReq(sessionCookie(set)))?.isAdmin, false);
});

test("bad tokens, bad emails and floods are refused", async () => {
  assert.throws(() => useSignInLink("short", fakeReq()), /not valid/);
  await assert.rejects(sendSignInLink("not-an-email", fakeReq()), /valid email/);
  for (let i = 0; i < 5; i++) await linkFor("flood@example.org", "198.51.100.1");
  await assert.rejects(sendSignInLink("flood@example.org", fakeReq({}, "198.51.100.2")), /Too many/);
});

test("closed sign-up refuses new accounts but not admins", async () => {
  config.openSignup = false;
  try {
    const t = await linkFor("closed-admin@example.org").catch(() => "");
    assert.equal(t, "", "no link is sent to an unknown address");
    config.adminEmails.add("boss@example.org");
    const a = useSignInLink(await linkFor("boss@example.org"), fakeReq());
    assert.equal(a.isAdmin, true);
  } finally {
    config.openSignup = true;
  }
});
