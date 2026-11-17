/**
 * Focused e2e for the provider-assured email-verification path (CAPS_OIDC_MATCH_STRATEGY=email
 * + CAPS_OIDC_ASSUME_EMAIL_VERIFIED_ISSUER). Uses the local TEST OpenID Provider (not Fixiam),
 * whose email_verified emission is controlled by DEV_IDP_EMAIL_VERIFIED (set when it is started).
 *
 *   CAPS_URL=... SCIM_TOKEN=... LOGIN=verra EXPECT=dashboard node tests/e2e/email-assurance.mjs
 *   EXPECT is "dashboard" (link succeeds) or a /login reason such as "email_unverified".
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const CAPS = process.env.CAPS_URL ?? "http://localhost:3000";
const TOKEN = process.env.SCIM_TOKEN;
const LOGIN = process.env.LOGIN ?? "verra";
const EXPECT = process.env.EXPECT ?? "dashboard";

async function scim(method, path, body) {
  const r = await fetch(`${CAPS}/scim/v2${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/scim+json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// Provision (or re-use) a SCIM user whose email is LOGIN@demo.example.
const email = `${LOGIN}@demo.example`;
const existing = await scim("GET", `/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`);
if (!existing.body.totalResults) {
  const r = await scim("POST", "/Users", {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: email, externalId: `ext-${LOGIN}-${Date.now()}`,
    name: { givenName: LOGIN, familyName: "Tester" }, displayName: `${LOGIN} Tester`,
    emails: [{ value: email, type: "work", primary: true }], active: true,
  });
  if (r.status !== 201) { console.error("FAIL provisioning", r.status, JSON.stringify(r.body)); process.exit(1); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await page.goto(`${CAPS}/login`);
  await page.getByRole("link", { name: /Login with Fixiam/i }).click();
  await page.waitForURL(/localhost:4400/);
  await page.fill('input[name="login"]', LOGIN);
  await page.fill('input[name="password"]', "any");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 6 && !page.url().startsWith(CAPS); i++) {
    await page.waitForTimeout(700);
    if (page.url().startsWith(CAPS)) break;
    const btn = page.locator('button[type="submit"]');
    if (await btn.count()) await btn.first().click().catch(() => {});
  }
  await page.waitForURL(new RegExp(`^${CAPS}`), { timeout: 15000 });
  await page.waitForLoadState("load");

  const url = page.url();
  const ok = EXPECT === "dashboard" ? url.startsWith(`${CAPS}/dashboard`) : url.includes(`/login?reason=${EXPECT}`);
  console.log(`${ok ? "PASS" : "FAIL"}  login(${LOGIN}) expected ${EXPECT} -> ${url}`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error("FAIL", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
