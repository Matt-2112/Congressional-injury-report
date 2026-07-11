// Current-member roster from the unitedstates/congress-legislators project.
// No API key required; refreshed daily so mid-session swearing-ins appear.
import { fetchCached, log } from "./lib.js";

const ROSTER_URL =
  "https://unitedstates.github.io/congress-legislators/legislators-current.json";

// Delegates and the Resident Commissioner can't vote on the House floor, so
// they never appear in roll calls and are excluded from the report.
const NON_VOTING = new Set(["AS", "DC", "GU", "MP", "PR", "VI"]);

export async function fetchRoster() {
  const raw = JSON.parse(
    await fetchCached(ROSTER_URL, "legislators-current.json", {
      maxAgeMs: 20 * 60 * 60 * 1000,
    })
  );

  const members = [];
  for (const person of raw) {
    const term = person.terms[person.terms.length - 1];
    if (new Date(term.end) < new Date()) continue;
    if (term.type === "rep" && NON_VOTING.has(term.state)) continue;
    const roles = (person.leadership_roles ?? []).filter(
      (r) => !r.end || new Date(r.end) > new Date()
    );
    // Prefer the marquee title if someone holds several
    const title =
      roles.find((r) => /^Speaker of the House/i.test(r.title))?.title ??
      roles.find((r) => /Majority Leader|Minority Leader|President Pro Tempore/i.test(r.title))?.title ??
      null;
    members.push({
      title,
      bioguide: person.id.bioguide,
      lis: person.id.lis ?? null,
      name: person.name.official_full ?? `${person.name.first} ${person.name.last}`,
      last: person.name.last,
      chamber: term.type === "sen" ? "senate" : "house",
      party: (term.party ?? "I")[0],
      state: term.state,
      district: term.type === "rep" ? term.district : null,
    });
  }

  const senators = members.filter((m) => m.chamber === "senate").length;
  log("roster", `${members.length} voting members (${senators} senators, ${members.length - senators} representatives)`);
  return members;
}
