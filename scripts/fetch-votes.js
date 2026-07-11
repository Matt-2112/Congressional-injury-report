// Roll-call participation from the two official no-key sources:
//   Senate — LIS XML (vote menu per session + one XML per vote)
//   House  — Clerk EVS XML (one XML per roll call, numbered per calendar year)
// Fetches the FULL current session (for report-card grades) plus, in early
// January, enough of the previous session to cover the status window.
// Per-vote XML is immutable and cached on disk, so only new rolls hit the
// network on repeat runs.
import { asArray, congressForYear, fetchCached, log, pMap, toIsoDate, xml } from "./lib.js";

export const VOTE_DAYS = 10; // status window: streaks + 7-day lookback

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export async function fetchVotes(members) {
  const [senate, house] = await Promise.all([fetchSenateVotes(members), fetchHouseVotes()]);
  return { senate, house };
}

// Distinct vote days, newest first — callers slice this for the status window.
function distinctDates(votes) {
  return [...new Set(votes.map((v) => v.date))].sort().reverse();
}

// ---------------------------------------------------------------- Senate ---

async function fetchSenateVotes(members) {
  const lisToBioguide = new Map(
    members.filter((m) => m.lis).map((m) => [m.lis, m.bioguide])
  );

  const year = new Date().getFullYear();
  let votesMeta = (await senateMenu(year)).votes;
  // Early January: this session may not yet cover the status window.
  if (distinctDates(votesMeta).length < VOTE_DAYS) {
    const prevDays = new Set();
    const prev = (await senateMenu(year - 1)).votes
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((v) => {
        prevDays.add(v.date);
        return prevDays.size <= VOTE_DAYS;
      });
    votesMeta = [...votesMeta, ...prev];
  }

  const votes = (
    await pMap(votesMeta, async (meta) => {
      const num5 = String(meta.number).padStart(5, "0");
      const url = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${meta.congress}${meta.session}/vote_${meta.congress}_${meta.session}_${num5}.xml`;
      const doc = xml.parse(
        await fetchCached(url, `senate/vote_${meta.congress}_${meta.session}_${num5}.xml`)
      );
      const record = doc.roll_call_vote;
      const voted = [];
      const notVoting = [];
      for (const m of asArray(record.members?.member)) {
        const bioguide = lisToBioguide.get(String(m.lis_member_id));
        if (!bioguide) continue; // resigned/deceased member still in old votes
        (String(m.vote_cast) === "Not Voting" ? notVoting : voted).push(bioguide);
      }
      const tally = record.count ?? {};
      return {
        id: `senate-${meta.congress}-${meta.session}-${meta.number}`,
        date: meta.date,
        question: [record.vote_title, record.question].filter(Boolean).join(" — ") || meta.question,
        legisNum: meta.issue || null,
        result: record.vote_result_text ?? record.vote_result ?? meta.result,
        yeas: Number(tally.yeas ?? meta.yeas ?? 0),
        nays: Number(tally.nays ?? meta.nays ?? 0),
        voted,
        notVoting,
      };
    })
  ).sort((a, b) => b.date.localeCompare(a.date));

  const voteDays = distinctDates(votes);
  log("votes", `senate: ${votes.length} votes across ${voteDays.length} vote days (latest ${voteDays[0] ?? "n/a"})`);
  return { votes, voteDays };
}

async function senateMenu(year) {
  const { congress, session } = congressForYear(year);
  const url = `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
  // The menu grows as votes happen; refresh hourly.
  const text = await fetchCached(url, `senate/vote_menu_${congress}_${session}.xml`, {
    maxAgeMs: 60 * 60 * 1000,
    allow404: true,
  });
  if (!text) return { votes: [] };
  const doc = xml.parse(text);
  const menuYear = Number(doc.vote_summary?.congress_year ?? year);
  const votes = asArray(doc.vote_summary?.votes?.vote).map((v) => {
    // vote_date is "24-Jun" — the year lives on the menu itself
    const [day, mon] = String(v.vote_date).split("-");
    const date = new Date(Date.UTC(menuYear, MONTHS[mon], Number(day))).toISOString().slice(0, 10);
    return {
      congress,
      session,
      number: Number(v.vote_number),
      date,
      issue: v.issue ? String(v.issue) : null,
      question: v.question ? String(v.question) : null,
      result: v.result ? String(v.result) : null,
      yeas: Number(v.vote_tally?.yeas ?? 0),
      nays: Number(v.vote_tally?.nays ?? 0),
    };
  });
  return { votes };
}

// ----------------------------------------------------------------- House ---

// The Clerk's site rate-limits datacenter IPs aggressively, so house fetches
// run at low concurrency and tolerate a few stragglers: a missing roll only
// nudges attendance percentages, but an aborted run publishes nothing.
const HOUSE_CONCURRENCY = 3;
const MAX_FAILED_ROLLS = 8;

async function fetchHouseVotes() {
  const year = new Date().getFullYear();
  const latest = await latestHouseRoll(year);
  let failed = 0;
  let votes = (
    await pMap(
      Array.from({ length: latest }, (_, i) => i + 1),
      async (roll) => {
        try {
          return await houseRoll(year, roll);
        } catch (err) {
          failed++;
          log("votes", `house roll ${roll}: ${err.message} — skipping`);
          if (failed > MAX_FAILED_ROLLS) throw err;
          return null;
        }
      },
      HOUSE_CONCURRENCY
    )
  ).filter(Boolean);
  if (failed > 0) log("votes", `house: skipped ${failed} unfetchable rolls`);

  // Early January: top up the status window from the previous year's tail.
  if (distinctDates(votes).length < VOTE_DAYS) {
    const prevLatest = await latestHouseRoll(year - 1);
    const seenDays = new Set(distinctDates(votes));
    for (let roll = prevLatest; roll >= 1 && seenDays.size <= VOTE_DAYS + VOTE_DAYS; roll--) {
      const vote = await houseRoll(year - 1, roll);
      if (!vote) continue;
      seenDays.add(vote.date);
      if (seenDays.size > VOTE_DAYS) break;
      votes.push(vote);
    }
  }

  votes.sort((a, b) => b.date.localeCompare(a.date));
  const voteDays = distinctDates(votes);
  log("votes", `house: ${votes.length} votes across ${voteDays.length} vote days (latest ${voteDays[0] ?? "n/a"})`);
  return { votes, voteDays };
}

// Doubling search for an upper bound, then binary search the frontier.
// exists() hits the network only for uncached rolls.
async function latestHouseRoll(year) {
  let lo = 0; // highest known to exist
  let hi = 1;
  while (await houseRollExists(year, hi)) {
    lo = hi;
    hi *= 2;
    if (hi > 4096) break;
  }
  if (lo === 0) return 0;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await houseRollExists(year, mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

async function houseRollExists(year, roll) {
  return (await houseRollText(year, roll)) !== null;
}

async function houseRollText(year, roll) {
  const num = String(roll).padStart(3, "0");
  return fetchCached(
    `https://clerk.house.gov/evs/${year}/roll${num}.xml`,
    `house/${year}/roll${num}.xml`,
    { allow404: true }
  );
}

async function houseRoll(year, roll) {
  const text = await houseRollText(year, roll);
  if (!text) return null;
  const meta = xml.parse(text)["rollcall-vote"];
  const voted = [];
  const notVoting = [];
  for (const rv of asArray(meta["vote-data"]?.["recorded-vote"])) {
    const bioguide = rv.legislator?.["@name-id"];
    if (!bioguide) continue;
    (String(rv.vote) === "Not Voting" ? notVoting : voted).push(bioguide);
  }
  const md = meta["vote-metadata"];
  const totals = md["vote-totals"]?.["totals-by-vote"] ?? {};
  return {
    id: `house-${year}-${roll}`,
    date: toIsoDate(md["action-date"]),
    question: String(md["vote-question"] ?? ""),
    legisNum: md["legis-num"] ? String(md["legis-num"]) : null,
    result: String(md["vote-result"] ?? ""),
    yeas: Number(totals["yea-total"] ?? 0),
    nays: Number(totals["nay-total"] ?? 0),
    voted,
    notVoting,
  };
}
