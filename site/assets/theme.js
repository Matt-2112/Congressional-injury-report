// Light/dark toggle. Loaded synchronously in <head> so a saved choice is
// applied before first paint (no flash). Light is the default; a reader's
// choice persists in localStorage.
(function () {
  const KEY = "theme";
  const root = document.documentElement;

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  if (saved === "dark") root.dataset.theme = "dark";

  const current = () => (root.dataset.theme === "dark" ? "dark" : "light");

  const SUN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/></svg>';
  const MOON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"/></svg>';

  // The button offers the *other* theme: a moon in light mode, a sun in dark.
  function paint(btn) {
    const dark = current() === "dark";
    btn.innerHTML = (dark ? SUN : MOON) + `<span>${dark ? "Light" : "Dark"}</span>`;
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    paint(btn);
    btn.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      if (next === "dark") root.dataset.theme = "dark";
      else delete root.dataset.theme;
      try { localStorage.setItem(KEY, next); } catch {}
      if (window.track) window.track("theme/" + next);
      paint(btn);
    });
  });
})();
