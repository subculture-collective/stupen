/**
 * Screenshots of the main views for visual review.
 * Needs a production build and a running server (BASE, default http://127.0.0.1:5193),
 * and Chromium at CHROMIUM (default /usr/bin/chromium). Output: OUT (default ./captures).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.env.BASE ?? "http://127.0.0.1:5193";
const out = process.env.OUT ?? "captures";
mkdirSync(out, { recursive: true });
const views = (process.env.VIEWS ?? "").split(",").filter(Boolean);
const shots: { name: string; hash: string; width?: number; height?: number; scheme?: "dark" | "light"; act?: string }[] = [
  { name: "home", hash: "#/" },
  { name: "new-track", hash: "#/new", height: 1400 },
  { name: "learn-brief", hash: "#/t/rust/learn" },
  { name: "learn-code", hash: "#/t/rust/learn", act: "code" },
  { name: "learn-written", hash: "#/t/spanish-past-tenses/learn" },
  { name: "plan", hash: "#/t/rust/plan", height: 1300 },
  { name: "materials", hash: "#/t/rust/materials" },
  { name: "prompts", hash: "#/prompts", height: 1300 },
  { name: "settings", hash: "#/t/rust/settings", height: 1300 },
  { name: "learn-dark", hash: "#/t/rust/learn", scheme: "dark", act: "code" },
  { name: "phone-learn", hash: "#/t/rust/learn", width: 390, height: 844 },
  { name: "phone-coach", hash: "#/t/rust/learn", width: 390, height: 844, act: "coach" },
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
for (const s of shots) {
  if (views.length && !views.includes(s.name)) continue;
  const page = await browser.newPage({ viewport: { width: s.width ?? 1440, height: s.height ?? 900 }, colorScheme: s.scheme ?? "light", deviceScaleFactor: 1 });
  await page.goto(`${base}/${s.hash}`);
  await page.waitForTimeout(1500);
  if (s.act === "code") {
    await page.locator(".tabs button", { hasText: /\.(rs|py|ts|go|md)$/ }).first().click().catch(() => {});
    await page.waitForTimeout(800);
  }
  if (s.act === "coach") {
    await page.getByRole("tab", { name: "Coach" }).click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: join(out, `${s.name}.png`), fullPage: false });
  await page.close();
}
await browser.close();
console.log(`saved to ${out}`);
