// Roll-call participation from the two official no-key sources:
//   Senate — LIS XML (vote menu per session + one XML per vote)
//   House  — Clerk EVS XML (one XML per roll call, numbered per calendar year)
// Produces, per chamber, the last VOTE_DAYS distinct days that had roll-call
// votes, with who voted and who didn't on each vote.
import { asArray, congressForYear, fetchCached, log, toIsoDate, xml } from "./lib.js";

export const VOTE_DAYS = 10; // enough history for streaks + 7-day lookback

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export async function fetchVotes(members) {
  const [senate, house] = await Promise.all([fetchSenateVotes(members), fetchHouseVotes()]);
  return { senate, house };
}

// ---------------------------------------------------------------- Senate ---

async function fetchSenateVotes(members) {
  const lisToBioguide = new Map(
    members.filter((m) => m.lis).map((m) => [m.lis, m.bioguide])
  );

  const year = new Date().getFullYear();
  let menu = await senateMenu(year);
  let votesMeta = menu.votes;
  // Early January: this session may have no votes yet — pull last year's too.
  if (distinctDates(votesMeta).length < VOTE_DAYS) {
    const prev = await senateMenu(year - 1);
    votesMeta = [...votesMeta, ...prev.votes];
  }

  const days = distinctDates(votesMeta).slice(0, VOTE_DAYS);
  const wanted = votesMeta.filter((v) => days.includes(v.date));

  const votes = [];
  for (const meta of wanted) {
    const num5 = String(meta.number).padStart(5, "0");
    const url = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${meta.congress}${meta.session}/vote_${meta.congress}_${meta.session}_${num5}.xml`;
    const doc = xml.parse(await fetchCached(url, `senate/vote_${meta.congress}_${meta.session}_${num5}.xml`));
    const record = doc.roll_call_vote;
    const voted = [];
    const notVoting = [];
    for (const m of asArray(record.members?.member)) {
      const bioguide = lisToBioguide.get(String(m.lis_member_id));
      if (!bioguide) continue; // resigned/deceased member still in old votes
      (String(m.vote_cast) === "Not Voting" ? notVoting : voted).push(bioguide);
    }
    votes.push({
      id: `senate-${meta.congress}-${meta.session}-${meta.number}`,
      date: meta.date,
      question: [record.vote_title, record.question].filter(Boolean).join(" — ") || meta.question,
      legisNum: meta.issue || null,
      result: record.vote_result_text ?? record.vote_result ?? meta.result,
      voted,
      notVoting,
    });
  }

  log("votes", `senate: ${votes.length} votes across ${days.length} vote days (latest ${days[0] ?? "n/a"})`);
  return { votes, voteDays: days };
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
    };
  });
  return { votes };
}

// ----------------------------------------------------------------- House ---

async function fetchHouseVotes() {
  const year = new Date().getFullYear();
  let votes = await houseVotesForYear(year);
  if (distinctDates(votes).length < VOTE_DAYS) {
    votes = [...votes, ...(await houseVotesForYear(year - 1))];
  }

  const days = distinctDates(votes).slice(0, VOTE_DAYS);
  votes = votes.filter((v) => days.includes(v.date));
  log("votes", `house: ${votes.length} votes across ${days.length} vote days (latest ${days[0] ?? "n/a"})`);
  return { votes, voteDays: days };
}

// Walk roll numbers backward from the latest one until we have enough vote
// days. The latest roll is found by probing forward from the last known
// number (cached XMLs make re-runs cheap) or by doubling search on first run.
async function houseVotesForYear(year) {
  const latest = await latestHouseRoll(year);
  const votes = [];
  const seenDays = new Set();
  for (let roll = latest; roll >= 1 && votes.length < 200; roll--) {
    const vote = await houseRoll(year, roll);
    if (!vote) continue;
    seenDays.add(vote.date);
    if (seenDays.size > VOTE_DAYS) break;
    votes.push(vote);
  }
  return votes;
}

async function latestHouseRoll(year) {
  // Doubling search for an upper bound, then binary search the frontier.
  // exists() hits the network only for uncached rolls.
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
  return {
    id: `house-${year}-${roll}`,
    date: toIsoDate(md["action-date"]),
    question: String(md["vote-question"] ?? ""),
    legisNum: md["legis-num"] ? String(md["legis-num"]) : null,
    result: String(md["vote-result"] ?? ""),
    voted,
    notVoting,
  };
}

// ------------------------------------------------------------------ misc ---

function distinctDates(votes) {
  return [...new Set(votes.map((v) => v.date))].sort().reverse();
}
