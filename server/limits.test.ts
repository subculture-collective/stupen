import assert from "node:assert/strict";
import { test } from "node:test";

import { checkRate } from "./limits.ts";

test("an account over a rate limit gets 429, others are unaffected", () => {
  for (let i = 0; i < 20; i++) checkRate("busy", "POST", "/api/tracks");
  assert.throws(() => checkRate("busy", "POST", "/api/tracks"), /20 new tracks per day/);
  checkRate("other", "POST", "/api/tracks");
  checkRate("busy", "GET", "/api/tracks");
});
