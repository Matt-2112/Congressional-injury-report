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

let reasons = new Map();
try {
  reasons = await extractReasons(candidates, record);
} catch (err) {
  log("reasons", `FAILED (continuing without reasons): ${err.message}`);
}

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
await writeJson(path.join(SITE_DATA_DIR, "agenda.json"), agenda);
await writeJson(path.join(DATA_DIR, "history", `${report.reportDate}.json`), report);
log("done", `report + agenda written for ${report.reportDate}`);
