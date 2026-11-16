/**
 * End-to-end walk-through of the five demonstration scenarios against a running CAPS
 * instance. SCIM calls play the role of the provisioning client; sign-in uses the
 * configured OpenID Provider (the local TEST IdP in development — not Fixiam).
 *
 *   CAPS_URL=http://localhost:3000 SCIM_TOKEN=... SHOTS=/tmp/shots node tests/e2e/demo-scenarios.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); // pre-installed in the dev container (or: npm i -D playwright)
import fs from "node:fs";

const CAPS = process.env.CAPS_URL ?? "http://localhost:3000";
const TOKEN = process.env.SCIM_TOKEN;
const SHOTS = process.env.SHOTS ?? "./test-results/shots";
fs.mkdirSync(SHOTS, { recursive: true });
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const results = [];
const check = (name, cond, info = "") => { results.push({ name, ok: !!cond, info }); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`); };

async function scim(method, path, body) {
  const r = await fetch(`${CAPS}/scim/v2${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/scim+json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const user = (login, given, family, dept, title) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"],
  userName: `${login}@demo.example`, externalId: `fx-${login}-${Date.now()}`, name: { givenName: given, familyName: family },
  displayName: `${given} ${family}`, emails: [{ value: `${login}@demo.example`, type: "work", primary: true }], title, active: true,
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": { department: dept },
});
async function groupId(name) {
  let r = await scim("GET", `/Groups?filter=${encodeURIComponent(`displayName eq "${name}"`)}&excludedAttributes=members`);
  if (r.body.totalResults) return r.body.Resources[0].id;
  r = await scim("POST", "/Groups", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: name });
  return r.body.id;
}
const member = (gid, op, uid) => scim("PATCH", `/Groups/${gid}`, { schemas: [PATCH], Operations: op === "add" ? [{ op: "add", path: "members", value: [{ value: uid }] }] : [{ op: "remove", path: `members[value eq "${uid}"]` }] });

async function login(page, loginName) {
  await page.goto(`${CAPS}/login`);
  await page.getByRole("link", { name: /Login with Fixiam/i }).click();
  await page.waitForURL(/localhost:4400|fixiam/);
  await page.fill('input[name="login"]', loginName);
  await page.fill('input[name="password"]', "any");
  await page.click('button[type="submit"]');
  // Consent screen (test IdP) — click "Continue" until we are redirected back to CAPS.
  for (let i = 0; i < 5 && !page.url().startsWith(CAPS); i++) {
    await page.waitForTimeout(700);
    if (page.url().startsWith(CAPS)) break;
    const btn = page.locator('button[type="submit"]');
    if (await btn.count()) await btn.first().click().catch(() => {});
  }
  await page.waitForURL(new RegExp(`^${CAPS}`), { timeout: 15000 });
  await page.waitForLoadState("load");
}

const browser = await chromium.launch();
const shot = async (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

try {
  // ------------------------------------------------ Preparation: an administrator provisioned by "Fixiam"
  const admins = await groupId("CAPS System Administrators");
  const officers = await groupId("CAPS Admission Officers");
  const managers = await groupId("CAPS Admission Managers");
  let adm = await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "kemi@demo.example"')}`);
  const admId = adm.body.totalResults ? adm.body.Resources[0].id : (await scim("POST", "/Users", user("kemi", "Kemi", "Adeola", "ICT Services", "Systems Administrator"))).body.id;
  await member(admins, "add", admId);

  // Clean up a previous run of this script (repeatability).
  const prev = await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "amina@demo.example"')}`);
  for (const r of prev.body.Resources ?? []) await scim("DELETE", `/Users/${r.id}`);

  // ------------------------------------------------ Scenario 1: automated provisioning
  const created = await scim("POST", "/Users", user("amina", "Amina", "Yusuf", "Admissions Processing", "Admission Officer"));
  check("S1 SCIM POST /Users creates the user", created.status === 201, `status ${created.status}`);
  const amina = created.body.id;
  const add = await member(officers, "add", amina);
  check("S1 Group membership synchronised (Admission Officers)", add.status === 200 && add.body.members.some((m) => m.value === amina));

  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  await login(admin, "kemi");
  await admin.goto(`${CAPS}/users`);
  check("S1 User appears in the CAPS User Directory", await admin.getByText("Amina Yusuf").first().isVisible());
  await shot(admin, "01-user-directory");

  // ------------------------------------------------ Scenario 2: SSO
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${CAPS}/login`);
  await shot(page, "02-login");
  await login(page, "amina");
  check("S2 SSO lands on the dashboard", page.url().startsWith(`${CAPS}/dashboard`), page.url());
  await shot(page, "03-dashboard-officer");

  // ------------------------------------------------ Scenario 3: centralised role management
  await page.goto(`${CAPS}/decisions`);
  check("S3 Officer cannot open Admission Decisions", page.url().includes("/access-denied"), page.url());
  await page.goto(`${CAPS}/reviews`);
  await page.locator("table a[href^='/applicants/']").first().click();
  await page.waitForURL(/\/applicants\//);
  const appUrl = page.url();
  const appId = appUrl.split("/").pop();
  const startBtn = page.getByRole("button", { name: "Start review" });
  if (await startBtn.count()) { await startBtn.click(); await page.waitForTimeout(800); }
  await page.selectOption("select", "recommend_admission");
  await page.fill("textarea", "Credentials verified. Meets cut-off. Recommend admission.");
  await page.getByRole("button", { name: "Submit review" }).click();
  await page.getByText("Review recorded").waitFor({ timeout: 5000 });
  check("S3 Officer can review an application", true);
  const denied = await page.evaluate(async (id) => (await fetch(`/api/applications/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approved" }) })).status, appId);
  check("S3 Officer approval is rejected by the backend (403)", denied === 403, `status ${denied}`);
  await page.getByRole("button", { name: "Approve admission" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByText("Access denied").first().waitFor({ timeout: 5000 });
  await shot(page, "04-officer-denied");

  await member(managers, "add", amina);
  await member(officers, "remove", amina);
  await page.goto(appUrl);
  await page.getByRole("button", { name: "Approve admission" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByText("Decision recorded").waitFor({ timeout: 5000 });
  check("S3 After role change in the IdP, the same session can approve", true);
  await page.waitForTimeout(500);
  await shot(page, "05-manager-approved");

  // ------------------------------------------------ Scenario 4: access revocation
  const deact = await scim("PATCH", `/Users/${amina}`, { schemas: [PATCH], Operations: [{ op: "replace", path: "active", value: false }] });
  check("S4 SCIM deactivation accepted", deact.status === 200 && deact.body.active === false);
  await page.goto(`${CAPS}/applicants`);
  check("S4 Existing session is invalidated on the next request", page.url().includes("/login?reason=account_inactive"), page.url());
  await shot(page, "06-revoked");
  const api = await page.evaluate(async (id) => (await fetch(`/api/applications/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "note", notes: "should fail" }) })).status, appId);
  check("S4 Protected API refuses the revoked user (401)", api === 401, `status ${api}`);
  // Fixiam (the IdP) may still hold an SSO session; CAPS must refuse the deactivated account anyway.
  await page.goto(`${CAPS}/api/auth/login`);
  if (!page.url().startsWith(CAPS)) await login(page, "amina").catch(() => {});
  await page.waitForURL(/\/login\?reason=/, { timeout: 15000 });
  check("S4 Deactivated user cannot sign in again", page.url().includes("reason=account_inactive"), page.url());
  await shot(page, "06b-signin-refused");

  // ------------------------------------------------ Scenario 5: audit trail
  await admin.goto(`${CAPS}/audit?q=Amina`);
  const txt = await admin.locator("main").innerText();
  for (const a of ["user.provisioned", "group.member_added", "role.granted", "authentication.login_succeeded", "access.denied", "admission.approved", "role.revoked", "user.deactivated", "session.revoked"]) {
    check(`S5 Audit contains ${a}`, txt.includes(a));
  }
  await shot(admin, "07-audit");
  for (const [path, name] of [["/dashboard", "08-dashboard-admin"], ["/groups", "09-groups"], ["/roles", "10-roles"], ["/scim-logs", "11-scim-logs"], ["/settings", "12-settings"], [`/users/${amina}`, "13-user-detail"], ["/applicants", "14-applicants"]]) {
    await admin.goto(`${CAPS}${path}`);
    await shot(admin, name);
  }
  // reactivate for repeatability
  await scim("PATCH", `/Users/${amina}`, { schemas: [PATCH], Operations: [{ op: "replace", path: "active", value: true }] });
  await scim("DELETE", `/Users/${amina}`);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}
