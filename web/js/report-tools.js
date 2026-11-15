/* Shared helpers for the downloadable report: CSV table, file download, share link, Web Share. */
window.ReportTools = (function () {
  "use strict";
  const PITCH_M2 = 105 * 68;   // one football pitch
  const PHASES = ["before", "peak", "after"];

  // a link others can open: the page itself when it is on the web, otherwise the project repository
  function shareUrl() {
    const here = location.href.split("#")[0];
    if (/^https?:/.test(here) && !/^(localhost|127\.|\[::1\])/.test(location.hostname))
      return here.replace(/(report|index)\.html.*$/, "globe.html").replace(/\?.*$/, "");
    return (window.SITE_CONFIG && window.SITE_CONFIG.github) || "";
  }

  function newly(c) { return c.flooded_persisting + c.flooded_receded; }
  function range(S, f) {
    const hi = f(S.total.classes_km2), lo = S.conservative ? f(S.conservative.total.classes_km2) : hi;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  }
  function fields(km2) { return Math.floor(km2 * 1e6 / PITCH_M2 / 1000) * 1000; }

  // one row per district and setting, plus totals; plain English headers so any tool can read it
  function csv(D) {
    const M = D.meta, S = D.stats;
    const head = ["setting", "water_threshold_db", "district", "mapped_km2",
      "water_" + M.dates.before + "_km2", "water_" + M.dates.peak + "_km2", "water_" + M.dates.after + "_km2",
      "newly_flooded_km2", "flooded_still_wet_km2", "flooded_drained_km2",
      "water_before_and_peak_km2", "possibly_flooded_vegetation_km2"];
    const rows = [head];
    const add = (setting, thr, block) => [...block.districts, block.total].forEach(d => {
      const c = d.classes_km2;
      rows.push([setting, thr, d.name, d.valid_km2, ...PHASES.map(p => d.water_km2[p]),
        +newly(c).toFixed(1), c.flooded_persisting, c.flooded_receded, c.permanent, c.flooded_vegetation]);
    });
    add("main", M.threshold_db, S);
    if (S.conservative) add("careful", M.conservative_threshold_db, S.conservative);
    const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    const body = rows.map(r => r.map(esc).join(",")).join("\r\n");
    const notes = ["", `# NISAR L2 GCOV track ${M.track} (${M.direction}); images ${PHASES.map(p => M.dates[p]).join(", ")}`,
      "# Provisional NISAR data; areas are estimates and have not been checked on the ground.",
      "# newly flooded = water at the peak that was dry before and darkened by >= " + M.change_drop_db + " dB"];
    return new Blob(["﻿" + body + "\r\n" + notes.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  }

  function download(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  // native share sheet when available (with files if the browser allows), else false
  async function nativeShare({ title, text, url, files }) {
    try {
      if (files && files.length && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({ title, text: url ? `${text} ${url}` : text, files });
        return true;
      }
      if (navigator.share) { await navigator.share(url ? { title, text, url } : { title, text }); return true; }
    } catch (e) {
      if (e && e.name === "AbortError") return true;     // the viewer closed the share sheet
    }
    return false;
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e) { /* ignore */ }
    ta.remove(); return ok;
  }
  function shareLinks(text, url) {
    const full = url ? `${text} ${url}` : text, enc = encodeURIComponent;
    return {
      whatsapp: `https://wa.me/?text=${enc(full)}`,
      x: `https://twitter.com/intent/tweet?text=${enc(text)}${url ? "&url=" + enc(url) : ""}`,
      email: `mailto:?subject=${enc(text.split(":")[0])}&body=${enc(full)}`,
    };
  }
  return { PITCH_M2, newly, range, fields, csv, download, nativeShare, copy, shareLinks, shareUrl };
})();
