/**
 * Seeds FICTIONAL demonstration data:
 *   - institutions and programmes
 *   - applicants and admission applications (with sample review/decision history)
 *   - a handful of sample staff records (provisioning_source = 'sample', domain @sample.caps-demo.ng)
 *   - optionally, pre-existing CAPS groups (provisioning_source = 'caps_native') that Fixiam can
 *     discover and import through its "Manage Groups" workflow
 *
 * It never creates SCIM-provisioned users, never writes provisioning audit events, and never
 * modifies records whose provisioning_source is 'scim'.
 *
 * Usage:
 *   npm run db:seed                       # seed if empty
 *   npm run db:seed -- --reset            # delete and re-create sample admissions data
 *   npm run db:seed -- --no-native-groups # do not create pre-existing CAPS groups
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import * as s from "../src/lib/db/schema";

const args = new Set(process.argv.slice(2));
const RESET = args.has("--reset");
const NATIVE_GROUPS = !args.has("--no-native-groups");
const SAMPLE_DOMAIN = "sample.caps-demo.ng";
const SESSION = "2026/2027";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Set MIGRATION_DATABASE_URL or DATABASE_URL");
const client = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: s });

// Deterministic PRNG so every environment gets the same demo data.
let seed = 20262027;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const NOW = Date.now();
/** Keep fictional history in the past relative to when the seed runs. */
const past = (d: Date) => new Date(Math.min(d.getTime(), NOW - (1 + Math.floor(rand() * 96)) * 3600_000));
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

const INSTITUTIONS = [
  { code: "KFUT", name: "Kainji Federal University of Technology", type: "University", ownership: "Federal", state: "Niger" },
  { code: "ACU", name: "Atlantic Coast University", type: "University", ownership: "Private", state: "Lagos" },
  { code: "OVSU", name: "Ogun Valley State University", type: "University", ownership: "State", state: "Ogun" },
  { code: "NBU", name: "Niger Bend University", type: "University", ownership: "Federal", state: "Kogi" },
  { code: "EHUMS", name: "Enugu Hills University of Medical Sciences", type: "University", ownership: "State", state: "Enugu" },
  { code: "JPFP", name: "Jos Plateau Federal Polytechnic", type: "Polytechnic", ownership: "Federal", state: "Plateau" },
  { code: "CCP", name: "Calabar Coast Polytechnic", type: "Polytechnic", ownership: "State", state: "Cross River" },
  { code: "SRCOE", name: "Sokoto Rima College of Education", type: "College of Education", ownership: "Federal", state: "Sokoto" },
] as const;

const PROGRAMMES: Record<string, { name: string; faculty: string; cutoff: number }[]> = {
  University: [
    { name: "Medicine and Surgery", faculty: "Clinical Sciences", cutoff: 280 },
    { name: "Computer Science", faculty: "Physical Sciences", cutoff: 240 },
    { name: "Law", faculty: "Law", cutoff: 260 },
    { name: "Accounting", faculty: "Management Sciences", cutoff: 220 },
    { name: "Civil Engineering", faculty: "Engineering", cutoff: 230 },
    { name: "Economics", faculty: "Social Sciences", cutoff: 210 },
    { name: "Nursing Science", faculty: "Health Sciences", cutoff: 250 },
    { name: "Mass Communication", faculty: "Arts", cutoff: 200 },
  ],
  Polytechnic: [
    { name: "Computer Engineering Technology", faculty: "Engineering Technology", cutoff: 160 },
    { name: "Business Administration", faculty: "Business Studies", cutoff: 150 },
    { name: "Estate Management", faculty: "Environmental Studies", cutoff: 150 },
    { name: "Science Laboratory Technology", faculty: "Applied Sciences", cutoff: 160 },
  ],
  "College of Education": [
    { name: "Mathematics Education", faculty: "Sciences Education", cutoff: 140 },
    { name: "English Language Education", faculty: "Languages Education", cutoff: 140 },
    { name: "Primary Education Studies", faculty: "Education", cutoff: 130 },
  ],
};

const FIRST = ["Adaeze", "Ibrahim", "Oluwaseun", "Zainab", "Chukwuemeka", "Aisha", "Temitope", "Musa", "Ifeoma", "Yakubu",
  "Folake", "Abdullahi", "Chiamaka", "Babatunde", "Hadiza", "Obinna", "Funmilayo", "Sani", "Nneka", "Olumide", "Halima",
  "Kelechi", "Bukola", "Usman", "Ebere", "Damilola", "Maryam", "Ikenna", "Yetunde", "Aliyu", "Chidinma", "Segun", "Rukayya",
  "Emeka", "Titilayo", "Garba", "Amarachi", "Kunle", "Safiya", "Uche"] as const;
const LAST = ["Okonkwo", "Adebayo", "Abubakar", "Eze", "Ogunleye", "Mohammed", "Nwosu", "Bello", "Afolabi", "Danjuma",
  "Okeke", "Lawal", "Olaniyan", "Ibrahim", "Uzor", "Adeyemi", "Suleiman", "Nnamdi", "Oyelaran", "Garba", "Chukwu", "Balogun",
  "Aminu", "Onyekachi", "Akinola", "Idris", "Ezeh", "Ojo", "Yusuf", "Obi"] as const;
const STATES = ["Lagos", "Kano", "Oyo", "Rivers", "Kaduna", "Enugu", "Anambra", "Ogun", "Plateau", "Kogi", "Niger",
  "Benue", "Delta", "Edo", "Sokoto", "Kwara", "Imo", "Abia", "Borno", "Ondo", "FCT"] as const;
const SUBJECTS = ["Physics", "Chemistry", "Biology", "Mathematics", "Economics", "Government", "Literature in English",
  "Commerce", "Geography", "Christian Religious Studies", "Islamic Studies", "Accounting"] as const;

const SAMPLE_STAFF = [
  { given: "Ngozi", family: "Eze", dept: "Admissions Processing", title: "Admission Officer", role: "Admission Officer", active: true },
  { given: "Tunde", family: "Bakare", dept: "Admissions Processing", title: "Senior Admission Officer", role: "Admission Officer", active: true },
  { given: "Hauwa", family: "Musa", dept: "Admissions Policy", title: "Admission Manager", role: "Admission Manager", active: true },
  { given: "Kayode", family: "Ilesanmi", dept: "ICT Services", title: "Systems Administrator", role: "System Administrator", active: true },
  { given: "Blessing", family: "Okafor", dept: "Admissions Processing", title: "Admission Officer", role: "Admission Officer", active: false },
] as const;

const REVIEW_NOTES = [
  "O'Level results verified against submitted certificates. Meets minimum subject requirements.",
  "UTME subject combination is appropriate for the chosen programme.",
  "Catchment area and state of origin criteria checked.",
  "Applicant meets the institutional cut-off mark. Recommend for admission.",
  "Awaiting confirmation of O'Level result from the examination body.",
  "Score is below departmental cut-off; consider for alternative programme.",
];

async function main() {
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(s.applicants);
  if (existing[0].n > 0 && !RESET) {
    console.log(`Sample data already present (${existing[0].n} applicants). Use --reset to recreate.`);
    await ensureNativeGroups();
    return;
  }

  await db.transaction(async (tx) => {
    if (RESET) {
      await tx.delete(s.admissionDecisions);
      await tx.delete(s.admissionReviews);
      await tx.delete(s.admissionApplications);
      await tx.delete(s.applicants);
      await tx.delete(s.programmes);
      await tx.delete(s.institutions);
      await tx.delete(s.users).where(eq(s.users.provisioningSource, "sample"));
      console.log("Removed existing sample admissions data and sample staff records.");
    }

    // Sample staff (fictional, clearly marked; cannot sign in)
    const staff = await tx
      .insert(s.users)
      .values(
        SAMPLE_STAFF.map((p) => ({
          userName: `${p.given}.${p.family}@${SAMPLE_DOMAIN}`.toLowerCase(),
          givenName: p.given,
          familyName: p.family,
          displayName: `${p.given} ${p.family}`,
          email: `${p.given}.${p.family}@${SAMPLE_DOMAIN}`.toLowerCase(),
          title: p.title,
          department: p.dept,
          active: p.active,
          provisioningSource: "sample" as const,
          sampleRoleLabel: p.role,
          deactivatedAt: p.active ? null : new Date("2026-09-30T10:00:00Z"),
        })),
      )
      .returning();
    const officers = staff.filter((u) => u.sampleRoleLabel === "Admission Officer" && u.active);
    const manager = staff.find((u) => u.sampleRoleLabel === "Admission Manager")!;

    // Institutions & programmes
    const insts = await tx.insert(s.institutions).values([...INSTITUTIONS]).returning();
    const progs = await tx
      .insert(s.programmes)
      .values(insts.flatMap((i) => PROGRAMMES[i.type].map((p) => ({ institutionId: i.id, name: p.name, faculty: p.faculty, cutoffMark: p.cutoff }))))
      .returning();

    // Applicants & applications
    const statusPlan: (typeof s.applicationStatus.enumValues)[number][] = [
      ...Array(42).fill("submitted"), ...Array(24).fill("under_review"), ...Array(14).fill("reviewed"),
      ...Array(8).fill("on_hold"), ...Array(22).fill("admitted"), ...Array(10).fill("rejected"),
    ];
    const usedEmails = new Set<string>();
    for (let n = 0; n < statusPlan.length; n++) {
      const status = statusPlan[(n * 37) % statusPlan.length];
      const first = pick(FIRST);
      const last = pick(LAST);
      const middle = rand() > 0.5 ? pick(FIRST) : null;
      let email = `${first}.${last}`.toLowerCase();
      while (usedEmails.has(email)) email = `${first}.${last}${int(10, 99)}`.toLowerCase();
      usedEmails.add(email);
      const prog = pick(progs);
      const inst = insts.find((i) => i.id === prog.institutionId)!;
      const utme = Math.min(360, Math.max(150, prog.cutoffMark + int(-40, 70)));
      const subjects = ["Use of English", ...[...SUBJECTS].sort(() => rand() - 0.5).slice(0, 3)];
      const split = subjects.map(() => 0);
      let left = utme;
      for (let k = 0; k < 4; k++) { split[k] = k === 3 ? left : Math.min(100, Math.max(30, Math.round(utme / 4 + int(-12, 12)))); left -= split[k]; }
      split[3] = Math.min(100, Math.max(20, split[3]));
      const submitted = past(new Date(Date.UTC(2026, 6 + int(0, 3), int(1, 28), int(7, 18), int(0, 59))));

      const [applicant] = await tx.insert(s.applicants).values({
        registrationNo: `DEMO26${String(104500 + n * 7).padStart(7, "0")}${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + ((n * 3) % 26))}`,
        firstName: first, middleName: middle, lastName: last,
        email: `${email}@${SAMPLE_DOMAIN}`,
        phone: `+234 80${int(1, 9)} 000 ${String(int(0, 9999)).padStart(4, "0")}`,
        gender: rand() > 0.5 ? "Female" : "Male",
        dateOfBirth: `${int(2006, 2009)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`,
        stateOfOrigin: pick(STATES),
        utmeScore: utme,
        utmeSubjects: subjects.map((subject, k) => ({ subject, score: split[k] })),
        oLevelSummary: `WASSCE ${int(2023, 2025)}: ${int(5, 9)} credits including English Language and Mathematics`,
      }).returning();

      const postUtme = ["submitted"].includes(status) ? null : int(45, 92);
      const aggregate = postUtme == null ? null : ((utme / 8 + postUtme / 2)).toFixed(2);
      const [app] = await tx.insert(s.admissionApplications).values({
        applicationNo: `CAPS/2026/${String(100231 + n * 13).padStart(6, "0")}`,
        applicantId: applicant.id, institutionId: inst.id, programmeId: prog.id,
        academicSession: SESSION, status, postUtmeScore: postUtme, aggregateScore: aggregate,
        submittedAt: submitted, updatedAt: past(new Date(submitted.getTime() + int(2, 30) * 86400000)),
      }).returning();

      if (status !== "submitted") {
        const officer = pick(officers);
        const reviewedAt = past(new Date(submitted.getTime() + int(3, 20) * 86400000));
        await tx.insert(s.admissionReviews).values({
          applicationId: app.id, reviewerId: officer.id, reviewerName: officer.displayName!,
          recommendation: status === "under_review" ? null : utme >= prog.cutoffMark ? "recommend_admission" : status === "on_hold" ? "requires_further_review" : "recommend_rejection",
          notes: pick(REVIEW_NOTES), isSample: true, createdAt: reviewedAt,
        });
        if (["admitted", "rejected", "on_hold"].includes(status)) {
          await tx.insert(s.admissionDecisions).values({
            applicationId: app.id,
            decision: status === "admitted" ? "approved" : status === "rejected" ? "rejected" : "on_hold",
            decidedById: manager.id, decidedByName: manager.displayName!,
            reason: status === "admitted" ? "Meets programme requirements and quota." : status === "rejected" ? "Does not meet departmental cut-off." : "Pending O'Level verification.",
            isSample: true, createdAt: past(new Date(reviewedAt.getTime() + int(1, 10) * 86400000)),
          });
        }
      }
    }
    console.log(`Seeded ${insts.length} institutions, ${progs.length} programmes, ${statusPlan.length} applicants, ${staff.length} sample staff.`);

    await tx.insert(s.auditLogs).values({
      category: "system", action: "system.sample_data_loaded", actorType: "system", actorLabel: "CAPS seed script",
      targetType: "dataset", targetLabel: "Fictional admissions sample data", isSample: true,
      details: { applicants: statusPlan.length, sampleStaff: staff.length, note: "Sample records are not SCIM provisioning events." },
    });
  });
  await ensureNativeGroups();
}

/** Pre-existing CAPS groups, so Fixiam's "Manage Groups" import workflow has something to discover. */
async function ensureNativeGroups() {
  if (!NATIVE_GROUPS) return;
  const names = [
    { name: "CAPS Admission Officers", desc: "Admission officers who review applications." },
    { name: "CAPS Admission Managers", desc: "Managers who approve, reject or hold admissions." },
    { name: "CAPS System Administrators", desc: "Administrators of the CAPS application." },
  ];
  for (const g of names) {
    const found = await db.select().from(s.groups).where(sql`lower(${s.groups.displayName}) = lower(${g.name}) and ${s.groups.deletedAt} is null`);
    if (found.length === 0) {
      await db.insert(s.groups).values({ displayName: g.name, description: g.desc, provisioningSource: "caps_native" });
      console.log(`Created pre-existing CAPS group: ${g.name}`);
    }
  }
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
