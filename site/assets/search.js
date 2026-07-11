// Member search: lazy-loads members.json on first focus, filters by name,
// state, or seat (e.g. "D-CO"), and links to the member report card.
(function () {
  const input = document.getElementById("member-search");
  const results = document.getElementById("search-results");
  if (!input || !results) return;

  let members = null;
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

  function render(list) {
    highlighted = -1;
    if (list.length === 0) {
      results.innerHTML = input.value.trim().length >= 2
        ? `<div class="search-empty">No members match.</div>`
        : "";
      results.classList.toggle("open", input.value.trim().length >= 2);
      return;
    }
    results.innerHTML = list
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

  input.addEventListener("focus", load);
  input.addEventListener("input", async () => {
    await load();
    render(matches(input.value));
  });
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
