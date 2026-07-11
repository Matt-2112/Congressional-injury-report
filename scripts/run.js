// Daily pipeline entry point: node scripts/run.js
// Each stage degrades gracefully — a failed source produces a stale-but-valid
// site rather than a broken one.
import path from "node:path";
import { fetchRoster } from "./fetch-roster.js";
import { fetchVotes } from "./fetch-votes.js";
import { fetchRecord } from "./fetch-record.js";
import { extractReasons } from "./extract-reasons.js";
import { buildAgenda } from "./build-agenda.js";
import { computeReport } from "./compute-report.js";
import { computeMembers } from "./compute-members.js";
import { DATA_DIR, SITE_DATA_DIR, log, todayIso, writeJson } from "./lib.js";

// Load .env for local runs (GitHub Actions injects env directly)
try {
  const { readFileSync } = await import("node:fs");
  for (const line of readFileSync(path.join(DATA_DIR, "..", ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env — fine */
}

const members = await fetchRoster();
const votes = await fetchVotes(members);

// Record + reasons are enrichment; never let them sink the report.
let record = { issues: [], absenceTexts: [], digestTexts: [], cloakroomText: null };
try {
  record = await fetchRecord();
} catch (err) {
  log("record", `FAILED (continuing without reasons/agenda): ${err.message}`);
}

// First pass finds who's absent; those members are the extraction candidates.
const preliminary = computeReport(members, votes);
const candidates = [];
for (const chamber of Object.values(preliminary.chambers)) {
  for (const e of chamber.listed) {
    if (e.status !== "PROBABLE") {
      candidates.push(members.find((m) => m.bioguide === e.bioguide));
    }
  }
}

// Reasons persist across runs: the Congressional Record explains an absence
// once, near its start, but the member stays listed for days after the
// explanation scrolls out of the fetch window. The store is committed by CI.
const REASONS_STORE = path.join(DATA_DIR, "reasons-store.json");
let stored = {};
try {
  const { readFileSync } = await import("node:fs");
  stored = JSON.parse(readFileSync(REASONS_STORE, "utf8"));
} catch {
  /* first run */
}

let reasons = new Map();
// A stored reason applies only to the member's current absence spell.
for (const c of candidates) {
  const s = stored[c.bioguide];
  if (!s) continue;
  const entry = preliminary.chambers[c.chamber].listed.find((e) => e.bioguide === c.bioguide);
  const spellStart = entry?.since ?? new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const cutoff = new Date(spellStart);
  cutoff.setDate(cutoff.getDate() - 3); // explanations sometimes predate the streak
  if (new Date(s.date) >= cutoff) reasons.set(c.bioguide, s);
}

try {
  const fresh = await extractReasons(candidates, record);
  for (const [bioguide, info] of fresh) {
    const date = info.source?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? todayIso();
    reasons.set(bioguide, { ...info, date });
  }
} catch (err) {
  log("reasons", `FAILED (continuing with ${reasons.size} stored reasons): ${err.message}`);
}

// Persist only reasons for members still under consideration.
const keep = {};
for (const c of candidates) if (reasons.has(c.bioguide)) keep[c.bioguide] = reasons.get(c.bioguide);
await writeJson(REASONS_STORE, keep);
log("reasons", `using ${reasons.size} reasons (${Object.keys(keep).length} persisted)`);

const report = computeReport(members, votes, reasons);

let agenda;
try {
  agenda = await buildAgenda(record);
} catch (err) {
  log("agenda", `FAILED: ${err.message}`);
  agenda = {
    generatedAt: new Date().toISOString(),
    reportDate: todayIso(),
    recordIssueDate: record.issues[0] ?? null,
    available: false,
  };
}

const memberStats = computeMembers(members, votes, report);

// The site reads from site/data/; history is kept alongside for trends later.
await writeJson(path.join(SITE_DATA_DIR, "report.json"), report);
await writeJson(path.join(SITE_DATA_DIR, "members.json"), memberStats);

// Share cards are enrichment — never sink the report over a rendering issue.
try {
  const { generateOg } = await import("./generate-og.js");
  await generateOg(memberStats);
} catch (err) {
  log("og", `FAILED (continuing): ${err.message}`);
}
await writeJson(path.join(SITE_DATA_DIR, "agenda.json"), agenda);
await writeJson(path.join(DATA_DIR, "history", `${report.reportDate}.json`), report);
log("done", `report + agenda written for ${report.reportDate}`);
