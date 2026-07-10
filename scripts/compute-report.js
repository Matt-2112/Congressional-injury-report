// Turns roll-call participation + extracted reasons into the injury report.
//
// Status precedence (forward-looking, like an NFL report):
//   OUT          announced leave of absence, or missed every vote on the most
//                recent vote day
//   DOUBTFUL     missed every vote on 3+ consecutive vote days with no
//                announced return — extended absence, no timetable
//   QUESTIONABLE missed at least half (but not all) of the most recent day's
//                votes
//   PROBABLE     voted on the most recent day, but sat out a full vote day
//                within the past 7 calendar days — recently back on the field
import { log, todayIso } from "./lib.js";

const DOUBTFUL_STREAK = 3;
const QUESTIONABLE_SHARE = 0.5;
const PROBABLE_LOOKBACK_DAYS = 7;

export function computeReport(members, votes, reasons = new Map()) {
  const report = {
    generatedAt: new Date().toISOString(),
    reportDate: todayIso(),
    chambers: {},
  };

  for (const chamber of ["senate", "house"]) {
    const { votes: chamberVotes, voteDays } = votes[chamber];
    const roster = members.filter((m) => m.chamber === chamber);
    const listed = [];

    for (const member of roster) {
      const entry = assess(member, chamberVotes, voteDays, reasons.get(member.bioguide));
      if (entry) listed.push(entry);
    }

    const order = { OUT: 0, DOUBTFUL: 1, QUESTIONABLE: 2, PROBABLE: 3 };
    listed.sort(
      (a, b) => order[a.status] - order[b.status] || a.last.localeCompare(b.last)
    );

    report.chambers[chamber] = {
      latestVoteDay: voteDays[0] ?? null,
      voteDaysCovered: voteDays,
      totalMembers: roster.length,
      activeCount: roster.length - listed.filter((e) => e.status === "OUT" || e.status === "DOUBTFUL").length,
      listed,
    };
    log(
      "report",
      `${chamber}: ${listed.length} listed (${listed.filter((e) => e.status === "OUT").length} out, ` +
        `${listed.filter((e) => e.status === "DOUBTFUL").length} doubtful) of ${roster.length}`
    );
  }

  return report;
}

function assess(member, votes, voteDays, reasonInfo) {
  // Per-day participation, newest day first.
  const days = voteDays.map((date) => {
    const dayVotes = votes.filter((v) => v.date === date);
    let total = 0;
    let missed = 0;
    for (const v of dayVotes) {
      if (v.notVoting.includes(member.bioguide)) {
        total++;
        missed++;
      } else if (v.voted.includes(member.bioguide)) {
        total++;
      }
      // absent from both lists → not yet sworn in / not eligible; don't count
    }
    return { date, total, missed };
  });

  const eligible = days.filter((d) => d.total > 0);
  if (eligible.length === 0) return null;

  const latest = eligible[0];
  let streak = 0;
  for (const d of eligible) {
    if (d.missed === d.total) streak++;
    else break;
  }
  const sinceDate = streak > 0 ? eligible[streak - 1].date : null;

  let status = null;
  let note = null;

  if (reasonInfo?.onLeave) {
    status = "OUT";
    note = "granted leave of absence";
  } else if (streak >= DOUBTFUL_STREAK) {
    status = "DOUBTFUL";
    note = `missed all votes on ${streak} straight vote days — no announced return`;
  } else if (streak >= 1) {
    status = "OUT";
    note = `missed all ${latest.total} vote${latest.total === 1 ? "" : "s"} on ${latest.date}`;
  } else if (latest.missed / latest.total >= QUESTIONABLE_SHARE) {
    status = "QUESTIONABLE";
    note = `missed ${latest.missed} of ${latest.total} votes on ${latest.date}`;
  } else {
    // Fully participated (or nearly) most recently — recently returned?
    const cutoff = new Date(latest.date);
    cutoff.setDate(cutoff.getDate() - PROBABLE_LOOKBACK_DAYS);
    const recentFullMiss = eligible.find(
      (d) => d.date !== latest.date && new Date(d.date) >= cutoff && d.missed === d.total
    );
    if (recentFullMiss) {
      status = "PROBABLE";
      note = `back on the floor after sitting out ${recentFullMiss.date}`;
    }
  }

  if (!status) return null;

  const last7cutoff = new Date(latest.date);
  last7cutoff.setDate(last7cutoff.getDate() - PROBABLE_LOOKBACK_DAYS);
  const last7 = eligible.filter((d) => new Date(d.date) >= last7cutoff);

  return {
    bioguide: member.bioguide,
    name: member.name,
    last: member.last,
    party: member.party,
    state: member.state,
    district: member.district,
    chamber: member.chamber,
    status,
    note,
    since: sinceDate,
    streakDays: streak,
    latestDay: { date: latest.date, missed: latest.missed, total: latest.total },
    last7: {
      missed: last7.reduce((n, d) => n + d.missed, 0),
      total: last7.reduce((n, d) => n + d.total, 0),
    },
    reason: reasonInfo?.reason ?? null,
    detail: reasonInfo?.detail ?? null,
    reasonSource: reasonInfo?.source ?? null,
  };
}
