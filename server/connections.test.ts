import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { config } from "./config.ts";
import { deleteConnection, getConnection, listConnections, mayUseServerLogins, open, providerChoices, saveConnection, seal } from "./connections.ts";
import { database, useMemoryDatabase } from "./db.ts";

useMemoryDatabase();
process.env.SECRET_KEY_FILE = join(mkdtempSync(join(tmpdir(), "stupen-key-")), "secret.key");

test("keys are encrypted at rest and bound to their owner and id", () => {
  const sealed = seal("sk-test-1234", "u1:c1");
  assert.ok(!sealed.toString("latin1").includes("sk-test"));
  assert.equal(open(sealed, "u1:c1"), "sk-test-1234");
  assert.throws(() => open(sealed, "u2:c1"));
});

test("a connection stores its key encrypted and lists only a hint", () => {
  const c = saveConnection("alice", { kind: "anthropic", model: "claude-sonnet-5-5", key: "sk-ant-secret-abcd" });
  assert.equal(c.keyHint, "…abcd");
  assert.equal("key" in c, false);
  const raw = database().prepare("SELECT secret FROM connections WHERE id = ?").get(c.id) as any;
  assert.ok(!Buffer.from(raw.secret).toString("latin1").includes("sk-ant-secret"));
  assert.equal(getConnection("alice", c.id)?.key, "sk-ant-secret-abcd");
  assert.equal(getConnection("bob", c.id), undefined, "another user cannot use it");
  const renamed = saveConnection("alice", { id: c.id, model: "claude-opus-5-5" });
  assert.equal(renamed.model, "claude-opus-5-5");
  assert.equal(getConnection("alice", c.id)?.key, "sk-ant-secret-abcd", "the key survives an edit without a new key");
  deleteConnection("bob", c.id);
  assert.equal(listConnections("alice").length, 1, "another user cannot delete it");
  deleteConnection("alice", c.id);
  assert.equal(listConnections("alice").length, 0);
});

test("bad input is refused", () => {
  assert.throws(() => saveConnection("alice", { kind: "nope", model: "x", key: "k" }), /provider/);
  assert.throws(() => saveConnection("alice", { kind: "openai", model: "", key: "k" }), /model/);
  assert.throws(() => saveConnection("alice", { kind: "openai", model: "gpt", key: "" }), /key/);
  assert.throws(() => saveConnection("alice", { kind: "compatible", model: "m", key: "k", baseUrl: "http://example.com/v1" }), /https/);
  assert.throws(() => saveConnection("alice", { kind: "compatible", model: "m", key: "k", baseUrl: "https://user:pw@example.com/v1" }), /key field/);
});

test("server logins are for admins only in accounts mode", () => {
  assert.equal(mayUseServerLogins("anyone"), true, "proxy mode: the proxy already limits who signs in");
  config.authMode = "accounts";
  try {
    database().prepare("INSERT INTO accounts (id, email, created_at, is_admin) VALUES ('adm', 'a@x.org', 0, 1), ('usr', 'u@x.org', 0, 0)").run();
    assert.equal(mayUseServerLogins("adm"), true);
    assert.equal(mayUseServerLogins("usr"), false);
    assert.deepEqual(providerChoices("usr"), []);
    assert.ok(providerChoices("adm").some((c) => c.id === "claude"));
  } finally {
    config.authMode = "proxy";
  }
});
