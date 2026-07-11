// Season stats for every member: attendance over the current session's roll
// calls, a letter grade, and a rank within their chamber. Powers the search
// bar and the per-member report cards.
import { log } from "./lib.js";
import { tallyByMemberDay } from "./compute-report.js";

// Congressional attendance clusters near 100%, so the scale is tight at the
// top — like a real report card, an A means you actually showed up.
const GRADES = [
  [99, "A+"], [97, "A"], [95, "A-"],
  [93, "B+"], [90, "B"], [87, "B-"],
  [84, "C+"], [80, "C"], [75, "C-"],
  [65, "D"],
];

function gradeFor(pct) {
  for (const [min, grade] of GRADES) if (pct >= min) return grade;
  return "F";
}

export function computeMembers(members, votes, report) {
  const year = String(new Date().getFullYear());
  const out = [];

  for (const chamber of ["senate", "house"]) {
    const roster = members.filter((m) => m.chamber === chamber);
    // Grades cover the current session only (this calendar year's votes).
    const sessionVotes = votes[chamber].votes.filter((v) => v.date.startsWith(year));
    const sessionDays = [...new Set(sessionVotes.map((v) => v.date))];
    const tallies = tallyByMemberDay(roster, sessionVotes, sessionDays);
    const statusByBioguide = new Map(
      report.chambers[chamber].listed.map((e) => [e.bioguide, e])
    );

    const rows = roster.map((m) => {
      let eligible = 0;
      let missed = 0;
      for (const t of tallies.get(m.bioguide).values()) {
        eligible += t.total;
        missed += t.missed;
      }
      const pct = eligible > 0 ? ((eligible - missed) / eligible) * 100 : null;
      const listed = statusByBioguide.get(m.bioguide);
      return {
        bioguide: m.bioguide,
        name: m.name,
        last: m.last,
        chamber,
        party: m.party,
        state: m.state,
        district: m.district,
        title: m.title ?? null,
        session: {
          eligible,
          missed,
          attended: eligible - missed,
          pct: pct === null ? null : Math.round(pct * 10) / 10,
          // A grade needs a real sample; brand-new members get an incomplete.
          grade: pct === null || eligible < 10 ? "INC" : gradeFor(pct),
        },
        status: listed
          ? {
              status: listed.status,
              note: listed.note,
              reason: listed.reason,
              detail: listed.detail,
              since: listed.since,
              last7: listed.last7,
            }
          : null,
      };
    });

    // Rank by attendance within the chamber (1 = best; ties share a rank).
    const graded = rows.filter((r) => r.session.pct !== null);
    for (const r of graded) {
      r.session.rank = 1 + graded.filter((o) => o.session.pct > r.session.pct).length;
      r.session.of = graded.length;
    }
    out.push(...rows);

    const dist = {};
    for (const r of rows) dist[r.session.grade] = (dist[r.session.grade] ?? 0) + 1;
    log(
      "members",
      `${chamber}: graded ${rows.length} members over ${sessionVotes.length} session votes ` +
        `(${Object.entries(dist).sort().map(([g, n]) => `${g}:${n}`).join(" ")})`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    sessionYear: Number(year),
    members: out,
  };
}
