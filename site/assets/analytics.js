// Privacy-friendly, cookieless analytics (GoatCounter). No cookies, no consent
// banner, respects Do Not Track. Auto-counts each page view; window.track(name)
// records an interaction event.
//
// SETUP: create a free site at https://www.goatcounter.com/ (pick a code), then
// replace YOURCODE below with it. Until then this is a dormant no-op.
(function () {
  var ENDPOINT = "https://YOURCODE.goatcounter.com/count";

  // Always define track() so callers are safe whether or not analytics is live.
  window.track = function () {};
  if (ENDPOINT.indexOf("YOURCODE") !== -1) return; // not configured yet

  window.goatcounter = { endpoint: ENDPOINT };
  window.track = function (name, extra) {
    if (!(window.goatcounter && window.goatcounter.count)) return;
    var o = { path: name, event: true };
    if (extra) for (var k in extra) o[k] = extra[k];
    window.goatcounter.count(o);
  };

  var s = document.createElement("script");
  s.async = true;
  s.src = "//gc.zgo.at/count.js";
  document.head.appendChild(s);
})();
