// Member search: lazy-loads members.json on first focus, filters by name,
// state, or seat (e.g. "D-CO"). A 5-digit query is treated as a ZIP code and
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
        const hay = `${m.name} ${m.last} ${m.state} ${seat(m)} ${m.chamber}`.toLowerCase();
        return q.split(/\s+/).every((part) => hay.includes(part));
      })
      .sort((a, b) => {
        const aStarts = a.last.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.last.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.last.localeCompare(b.last);
      })
      .slice(0, 8);
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
      return render(
        list,
        list.length
          ? `Representatives for ${q} (${zips[q][0]})`
          : `No congressional district found for ZIP ${q}.`
      );
    }
    await load();
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
