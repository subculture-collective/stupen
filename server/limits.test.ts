import assert from "node:assert/strict";
import { test } from "node:test";

import { checkRate } from "./limits.ts";

test("an account over a rate limit gets 429, others are unaffected", () => {
  for (let i = 0; i < 20; i++) checkRate("busy", "POST", "/api/tracks");
  assert.throws(() => checkRate("busy", "POST", "/api/tracks"), /20 new tracks per day/);
  checkRate("other", "POST", "/api/tracks");
  checkRate("busy", "GET", "/api/tracks");
});


test("practice runs and canonical checks spend the same account quota", () => {
  for (let i = 0; i < 75; i++) {
    checkRate("practice-quota", "POST", "/api/tracks/t/lessons/l/run");
    checkRate("practice-quota", "POST", "/api/tracks/t/lessons/l/check");
  }
  for (const action of ["run", "check"]) assert.throws(() => checkRate("practice-quota", "POST", `/api/tracks/t/lessons/l/${action}`), /150 checks per hour/);
});
