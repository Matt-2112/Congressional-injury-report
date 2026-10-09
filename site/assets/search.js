// Member search: lazy-loads members.json on first focus, filters by name,
// state (code or full name), or seat (e.g. "D-CO"). A full state name lists
// that state's whole delegation. A 5-digit query is treated as a ZIP code and
// resolved to that district's House member(s) plus the state's two senators.
(function () {
  const input = document.getElementById("member-search");
  const results = document.getElementById("search-results");
  if (!input || !results) return;

  let members = null;
  let zips = null;
  let highlighted = -1;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
    CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
    IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
    ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
    MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
    NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
    ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
    UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
    WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia", PR: "Puerto Rico", GU: "Guam",
    VI: "Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
  };
  const STATE_BY_NAME = Object.fromEntries(
    Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));

  const seat = (m) =>
    m.chamber === "senate" ? `${m.party}-${m.state}` : `${m.party}-${m.state}${m.district ? "-" + m.district : ""}`;

  async function load() {
    if (members) return;
    const d = await fetch("/data/members.json").then((r) => r.json());
    members = d.members;
  }

  // The ZIP crosswalk is ~0.6 MB, so only fetch it when a ZIP is actually typed.
  async function loadZips() {
    if (zips) return;
    zips = await fetch("/data/zip-districts.json").then((r) => r.json());
  }

  function matches(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return members
      .filter((m) => {
        const hay = `${m.name} ${m.last} ${m.state} ${STATE_NAMES[m.state] ?? ""} ${seat(m)} ${m.chamber}`.toLowerCase();
        return q.split(/\s+/).every((part) => hay.includes(part));
      })
      .sort((a, b) => {
        const aStarts = a.last.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.last.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.last.localeCompare(b.last);
      })
      .slice(0, 8);
  }

  // A query that is exactly a state's name → its whole delegation, senators
  // first, then House members in district order.
  function stateDelegation(query) {
    const code = STATE_BY_NAME[query.trim().toLowerCase().replace(/\s+/g, " ")];
    if (!code) return null;
    const inState = members.filter((m) => m.state === code);
    const senate = inState.filter((m) => m.chamber === "senate").sort((a, b) => a.last.localeCompare(b.last));
    const house = inState.filter((m) => m.chamber === "house").sort((a, b) => (a.district ?? 0) - (b.district ?? 0));
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    return {
      list: [...senate, ...house],
      header: `${STATE_NAMES[code]} · ${plural(senate.length, "senator")}, ${plural(house.length, "representative")}`,
    };
  }

  // Returns members representing a ZIP: House member(s) for its district(s),
  // in district order, followed by the state's senators.
  function zipMembers(zip) {
    const entry = zips[zip];
    if (!entry) return [];
    const [state, ...districts] = entry;
    const inState = members.filter((m) => m.state === state);
    const house = districts
      .map((d) => inState.find((m) => m.chamber === "house" && m.district === d))
      .filter(Boolean);
    const senate = inState.filter((m) => m.chamber === "senate");
    return [...house, ...senate];
  }

  function render(list, header) {
    highlighted = -1;
    if (list.length === 0) {
      results.innerHTML = input.value.trim().length >= 2
        ? `<div class="search-empty">${esc(header) || "No members match."}</div>`
        : "";
      results.classList.toggle("open", input.value.trim().length >= 2);
      return;
    }
    results.innerHTML =
      (header ? `<div class="search-head">${esc(header)}</div>` : "") +
      list
        .map(
          (m, i) => `<a href="/member.html?m=${esc(m.bioguide)}" data-i="${i}">
          <span class="team-badge ${esc(m.party)}">${esc(seat(m))}</span>
          <span class="sr-name">${esc(m.name)}</span>
          <span class="sr-grade">${esc(m.session.grade)}</span>
        </a>`
        )
        .join("");
    results.classList.add("open");
  }

  async function update() {
    const q = input.value.trim();
    // All-digit query → ZIP lookup once it's a full 5 digits.
    if (/^\d+$/.test(q)) {
      if (q.length < 5) return render([], "Keep typing a 5-digit ZIP code…");
      await Promise.all([load(), loadZips()]);
      const list = zipMembers(q);
      if (window.track) window.track(list.length ? "search/zip" : "search/zip-miss");
      return render(
        list,
        list.length
          ? `Representatives for ${q} (${zips[q][0]})`
          : `No congressional district found for ZIP ${q}.`
      );
    }
    await load();
    const state = stateDelegation(q);
    if (state) {
      if (window.track) window.track("search/state");
      return render(state.list, state.header);
    }
    render(matches(q));
  }

  input.addEventListener("focus", load);
  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    const links = results.querySelectorAll("a");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (links.length === 0) return;
      highlighted = (highlighted + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
      links.forEach((a, i) => a.classList.toggle("hl", i === highlighted));
      links[highlighted].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && links.length > 0) {
      e.preventDefault();
      links[Math.max(highlighted, 0)].click();
    } else if (e.key === "Escape") {
      results.classList.remove("open");
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) results.classList.remove("open");
  });
})();
