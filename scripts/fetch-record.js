// Congressional Record text from GPO govinfo (no API key needed).
// Each issue has a mods.xml listing granules; we pull the ones that explain
// absences ("LEAVE OF ABSENCE" grants, members' "PERSONAL EXPLANATION"s) and
// the Daily Digest sections that describe what's happening on the floor.
// The House GOP Cloakroom's leave-of-absence page is scraped as a bonus source.
import { fetchCached, fetchText, log, todayIso } from "./lib.js";

const LOOKBACK_DAYS = 14; // find the most recent issues within this window
const MAX_ISSUES = 3; // absence texts can lag the absence by a day or two

export async function fetchRecord() {
  const issues = await findRecentIssues();
  if (issues.length === 0) {
    log("record", "no Congressional Record issues found in lookback window");
    return { issues: [], absenceTexts: [], digestTexts: [], cloakroomText: null };
  }

  const absenceTexts = [];
  const digestTexts = [];

  for (const [i, issueDate] of issues.entries()) {
    const granules = await issueGranules(issueDate);
    for (const g of granules) {
      const isAbsence = /LEAVES? OF ABSENCE|PERSONAL EXPLANATION/i.test(g.title);
      const isDigest = i === 0 && /^Daily Digest/i.test(g.title);
      if (!isAbsence && !isDigest) continue;
      const text = await granuleText(issueDate, g.id);
      if (!text) continue;
      const entry = { issueDate, title: g.title, text };
      if (isAbsence) absenceTexts.push(entry);
      if (isDigest) digestTexts.push(entry);
    }
  }

  const cloakroomText = await cloakroom();
  log(
    "record",
    `${issues.length} issues (latest ${issues[0]}): ${absenceTexts.length} absence granules, ` +
      `${digestTexts.length} digest granules, cloakroom ${cloakroomText ? "ok" : "unavailable"}`
  );
  return { issues, absenceTexts, digestTexts, cloakroomText };
}

async function findRecentIssues() {
  const issues = [];
  const day = new Date(todayIso());
  for (let i = 0; i <= LOOKBACK_DAYS && issues.length < MAX_ISSUES; i++) {
    const date = new Date(day);
    date.setDate(date.getDate() - i);
    const iso = date.toISOString().slice(0, 10);
    // The Record has no issue on days Congress wasn't in session; govinfo
    // redirects to an error page for those, so validate the content.
    const text = await fetchCached(
      `https://www.govinfo.gov/metadata/pkg/CREC-${iso}/mods.xml`,
      `crec/${iso}/mods.xml`
    ).catch(() => null);
    if (text && text.includes("<mods")) issues.push(iso);
    else if (text) {
      // cached an error page — don't let it poison future runs
      const { unlink } = await import("node:fs/promises");
      const path = await import("node:path");
      const { CACHE_DIR } = await import("./lib.js");
      await unlink(path.join(CACHE_DIR, `crec/${iso}/mods.xml`)).catch(() => {});
    }
  }
  return issues;
}

async function issueGranules(issueDate) {
  const mods = await fetchCached(
    `https://www.govinfo.gov/metadata/pkg/CREC-${issueDate}/mods.xml`,
    `crec/${issueDate}/mods.xml`
  );
  // mods.xml is ~2MB; a targeted regex walk beats a full XML parse here.
  const granules = [];
  const re = /<relatedItem[^>]*ID="id-([^"]+)"([\s\S]*?)(?=<relatedItem|<\/mods>)/g;
  for (const m of mods.matchAll(re)) {
    const title = m[2].match(/<title>([^<]*)<\/title>/)?.[1];
    if (title) granules.push({ id: m[1], title });
  }
  return granules;
}

async function granuleText(issueDate, granuleId) {
  const html = await fetchCached(
    `https://www.govinfo.gov/content/pkg/CREC-${issueDate}/html/${granuleId}.htm`,
    `crec/${issueDate}/${granuleId}.htm`,
    { allow404: true }
  );
  if (!html) return null;
  return stripHtml(html).slice(0, 20000);
}

async function cloakroom() {
  try {
    const html = await fetchText("https://repcloakroom.house.gov/leave-of-absence/");
    const main = html.match(/<main[\s\S]*?<\/main>|<article[\s\S]*?<\/article>/i)?.[0] ?? html;
    return stripHtml(main).slice(0, 10000);
  } catch {
    return null; // nice-to-have source; never fail the run over it
  }
}

function stripHtml(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
