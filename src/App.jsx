import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";

/* =========================================================================
   Proper Cheeky Closers — Q3 Forecast
   Tabbed: a Master (management) view + one tab per rep. One shared dataset.

   Each rep's number stacks three layers toward their Q3 goal:
     BANKED   = Q2 carry-in (already closed) + live deals + loans (75%)
     PIPELINE = signed deals, confidence-weighted, until marked live
     GOAL     = the Q3 quota

   Negotiation mode: "Model a deal" opens a scratchpad. Punch in terms, watch
   attainment move live, then Sign it (adds to pipeline) or Clear (gone).
   Nothing in the scratchpad touches the rep's real numbers until signed.

   No double counting: a signed deal that goes live is the SAME row with its
   stage flipped to Live — moves pipeline -> banked, never re-typed.
   ========================================================================= */

const LOAN_SHARE = 0.75;
const STORE_KEY = "pcc-forecast-v3";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const money = (v) => (v < 0 ? "-" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");
const pct = (v, dp = 1) => `${(v * 100).toFixed(dp)}%`;
const uid = () => Math.random().toString(36).slice(2, 9);

function monthsRemaining(goLive, qStart, qEnd) {
  if (!goLive || !qStart || !qEnd) return 0;
  const L = new Date(goLive + "T00:00:00"), S = new Date(qStart + "T00:00:00"), E = new Date(qEnd + "T00:00:00");
  if (isNaN(L) || isNaN(S) || isNaN(E)) return 0;
  const eff = L < S ? S : L; if (eff >= E) return 0;
  let m = (E.getFullYear() - eff.getFullYear()) * 12 + (E.getMonth() - eff.getMonth());
  let d = E.getDate() - eff.getDate(); if (d < 0) { m -= 1; d += 30; }
  return Math.max(0, Math.round((m + d / 30) * 100) / 100);
}
function calcDeal(d, q) {
  const gpv = num(d.gpv); let effRate;
  if (d.model === "costplus") effRate = (num(d.costToSquare) + num(d.costMargin)) / 100;
  else { const a = num(d.avgTxn); effRate = num(d.flatRatePct) / 100 + (a > 0 ? num(d.flatFixedFee) / a : 0); }
  const gpvRev = gpv * effRate;
  const saasRev = num(d.saasPerMonth) * num(d.numLocations) * num(d.monthsActive || 12);
  const totalAnnual = gpvRev + saasRev, monthly = totalAnnual / 12;
  const mr = monthsRemaining(d.goLive, q.start, q.end), quotaCredit = monthly * mr;
  return { effRate, totalAnnual, monthly, mr, quotaCredit, contribution: quotaCredit };
}
function nextQuarterRollin(rep, q) {
  const nq = nextQuarter(q.end);
  const q4s = new Date(nq.start + "T00:00:00"), q4e = new Date(nq.end + "T23:59:59");
  const dayMs = 86400000;
  const overlapDays = (goLive) => {
    if (!goLive) return 0;
    const s = new Date(goLive + "T00:00:00"); if (isNaN(s)) return 0;
    const e = new Date(s); e.setDate(e.getDate() + 90);
    const oS = s > q4s ? s : q4s, oE = e < q4e ? e : q4e;
    return Math.max(0, Math.round((oE - oS) / dayMs));
  };
  let live = 0, signed = 0;
  (rep.deals || []).forEach((d) => {
    const c = calcDeal(d, q);
    const daily = c.totalAnnual / 365;
    const roll = daily * overlapDays(d.goLive);
    if (d.activated) live += roll; else signed += roll;
  });
  return { nq, live, signed, total: live + signed };
}

function repTotals(rep, q) {
  const carried = num(rep.carryTotal);
  const loans = (rep.loans || []).reduce((s, l) => s + num(l.revenue), 0);
  const today = isoDate(new Date());
  let dealPipeline = 0, overdue = 0;
  (rep.deals || []).filter((d) => !d.activated).forEach((d) => {
    const c = calcDeal(d, q).contribution;
    if (d.goLive && d.goLive < today) overdue += c; else dealPipeline += c;
  });
  const banked = carried;
  const pipeline = dealPipeline + overdue + loans;
  const total = banked + pipeline, quota = num(rep.quota);
  return { carried, loans, live: 0, pipeline, overdue, banked, total, quota,
    attainment: quota ? total / quota : 0, bankedAtt: quota ? banked / quota : 0, gap: quota - total };
}

function currentQuarter() {
  const now = new Date(), y = now.getFullYear(), qi = Math.floor(now.getMonth() / 3);
  const s = new Date(y, qi * 3, 1), e = new Date(y, qi * 3 + 3, 0), iso = (d) => d.toISOString().slice(0, 10);
  return { label: `Q${qi + 1} ${y}`, start: iso(s), end: iso(e) };
}
const mkRep = (code, name, quota) => ({ id: uid(), code, name, team: "Field", quota, carryTotal: "", deals: [], loans: [], prospects: [] });
const slug = (s) => (s || "q").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function nextQuarter(afterEndIso) {
  const e = new Date((afterEndIso || currentQuarter().end) + "T00:00:00");
  const ns = new Date(e.getFullYear(), e.getMonth() + 1, 1);
  const qi = Math.floor(ns.getMonth() / 3);
  const start = new Date(ns.getFullYear(), qi * 3, 1);
  const end = new Date(ns.getFullYear(), qi * 3 + 3, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { label: `Q${qi + 1} ${start.getFullYear()}`, start: iso(start), end: iso(end) };
}
function seedRoster() {
  return [
    mkRep("085168", "Agadzhanyan, David", 62000),
    mkRep("085422", "Wadhams, Ryan", 66000), mkRep("088515", "Woods, Tacen", 33000),
    mkRep("089562", "Wichman, Zachariah", 16500), mkRep("089968", "Heathcott, Aubrey", 16500),
    mkRep("090964", "Lemus, Wilmer", 5166.67), mkRep("090987", "Millet, Joey", 5166.67),
  ];
}
function seedData() {
  const cq = currentQuarter();
  const id = slug(cq.label);
  return { activeId: id, quarters: [{ id, label: cq.label, start: cq.start, end: cq.end, archived: false, reps: seedRoster() }] };
}
function migrate(d) {
  if (!d) return seedData();
  if (Array.isArray(d.quarters)) return d;
  const qq = d.quarter || currentQuarter();
  const id = slug(qq.label);
  return { activeId: id, quarters: [{ id, label: qq.label, start: qq.start, end: qq.end, archived: false, reps: d.reps || seedRoster() }] };
}
const blankDeal = (q) => ({ id: uid(), name: "", stage: "signed", model: "flat",
  gpv: "", avgTxn: "", flatRatePct: "", flatFixedFee: "", costToSquare: "", costMargin: "",
  saasPerMonth: "", numLocations: "", monthsActive: 12, goLive: q.start, confidence: 100 });

/* ========================================================================= */
export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("master");
  const [viewId, setViewId] = useState(null);
  const [status, setStatus] = useState("Loading…");

  const dirty = useRef(false);
  const lastSaved = useRef("");
  const load = useCallback(async (initial) => {
    try {
      const res = await fetch("/api/data");
      const j = await res.json();
      if (j && j.value) { lastSaved.current = j.value; if (!dirty.current) { const m = migrate(JSON.parse(j.value)); setData(m); setViewId((v) => v || m.activeId); if (initial) setStatus("Saved"); } return true; }
    } catch (e) {}
    return false;
  }, []);
  useEffect(() => { (async () => { const ok = await load(true); if (!ok) { const s = seedData(); setData(s); setViewId(s.activeId); setStatus("Ready"); } })(); }, [load]);
  const save = useCallback(async (next) => {
    setStatus("Saving…");
    try {
      const body = JSON.stringify(next);
      const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: body }) });
      if (!res.ok) throw new Error("save failed");
      lastSaved.current = body; dirty.current = false; setStatus("Saved");
    } catch (e) { setStatus("Save failed — retrying…"); }
  }, []);
  useEffect(() => { if (!data) return; dirty.current = JSON.stringify(data) !== lastSaved.current; const t = setTimeout(() => { if (dirty.current) save(data); }, 700); return () => clearTimeout(t); }, [data, save]);
  useEffect(() => { const id = setInterval(() => { const el = document.activeElement; const editing = el && ["INPUT","TEXTAREA","SELECT"].includes(el.tagName); if (!dirty.current && !editing) load(false); }, 20000); return () => clearInterval(id); }, [load]);

  const activeQ = data ? (data.quarters.find((x) => x.id === data.activeId) || data.quarters[0]) : null;
  const vId = viewId || data?.activeId;
  const viewedQ = data ? (data.quarters.find((x) => x.id === vId) || activeQ) : null;
  const readOnly = !!(data && viewedQ && viewedQ.id !== data.activeId);
  const q = viewedQ ? { label: viewedQ.label, start: viewedQ.start, end: viewedQ.end } : null;
  const reps = viewedQ ? viewedQ.reps : [];
  const activeRep = reps.find((r) => r.id === tab);

  const update = (fn) => {
    if (readOnly) return;
    setData((p) => { const n = JSON.parse(JSON.stringify(p)); const cq = n.quarters.find((x) => x.id === n.activeId); fn(n, cq); return n; });
  };

  const team = useMemo(() => {
    if (!data || !viewedQ) return null;
    const rows = reps.map((r) => ({ rep: r, t: repTotals(r, q) }));
    const sum = (k) => rows.reduce((s, x) => s + x.t[k], 0);
    const quota = sum("quota"), banked = sum("banked"), pipeline = sum("pipeline"), total = banked + pipeline;
    const MONTH_TARGET = 4000000;
    const teamTarget = MONTH_TARGET * reps.length;
    const months = quarterMonths(q.start, q.end);
    const todayIsoM = isoDate(new Date());
    const monthData = months.map((m) => {
      const key = m.getFullYear() * 12 + m.getMonth();
      let prospect = 0, signed = 0, live = 0, overdue = 0;
      const dealList = [];
      reps.forEach((r) => {
        const first = (r.name || "").split(",")[0];
        (r.deals || []).forEach((d) => { if (monthKey(d.goLive) === key) { const g = num(d.gpv); let kind; if (d.activated) { live += g; kind = "active"; } else if (d.goLive < todayIsoM) { overdue += g; kind = "overdue"; } else { signed += g; kind = "signed"; } dealList.push({ name: d.name || "Untitled", rep: first, gpv: g, goLive: d.goLive, kind }); } });
        (r.prospects || []).forEach((p) => { if (monthKey(p.goLive) === key) { const g = num(p.gpv); let kind; if (p.goLive && p.goLive < todayIsoM) { overdue += g; kind = "overdue"; } else { prospect += g; kind = "prospect"; } dealList.push({ name: p.name || "Prospect", rep: first, gpv: g, goLive: p.goLive, kind }); } });
      });
      dealList.sort((a, b) => (a.goLive || "9999-12-31").localeCompare(b.goLive || "9999-12-31"));
      return { m, prospect, signed, live, overdue, deals: dealList };
    });
    // unified upcoming list: every not-yet-live deal (signed) + prospect, with overdue flag
    const todayIso = isoDate(new Date());
    const upcoming = [];
    reps.forEach((r) => {
      (r.deals || []).forEach((d) => { if (!d.activated && num(d.gpv) > 0) upcoming.push({ name: d.name || "Untitled", rep: r.name, repFirst: (r.name || "").split(",")[0], gpv: num(d.gpv), goLive: d.goLive, kind: "signed", overdue: !!(d.goLive && d.goLive < todayIso) }); });
      (r.prospects || []).forEach((p) => { if (num(p.gpv) > 0) upcoming.push({ name: p.name || "Prospect", rep: r.name, repFirst: (r.name || "").split(",")[0], gpv: num(p.gpv), goLive: p.goLive, kind: "prospect", overdue: !!(p.goLive && p.goLive < todayIso) }); });
    });
    upcoming.sort((a, b) => (a.goLive || "9999") < (b.goLive || "9999") ? -1 : 1);
    const overdueCount = upcoming.filter((u) => u.overdue).length;
    const overdueGpv = upcoming.filter((u) => u.overdue).reduce((s, u) => s + u.gpv, 0);
    // mark which quarter-months contain an overdue deal (for the red bar marker)
    const overdueMonths = {};
    upcoming.forEach((u) => { if (u.overdue) { const k = monthKey(u.goLive); if (k != null) overdueMonths[k] = true; } });
    const movers = [...upcoming].sort((a, b) => b.gpv - a.gpv);
    let nextLive = 0, nextSigned = 0, nextQuotaSum = 0;
    reps.forEach((r) => { const rr = nextQuarterRollin(r, q); nextLive += rr.live; nextSigned += rr.signed; nextQuotaSum += num(r.nextQuota); });
    const nqLabel = nextQuarter(q.end).label;
    return { rows, quota, banked, pipeline, total, attainment: quota ? total / quota : 0, gap: quota - total,
      teamTarget, monthData, movers: movers.slice(0, 6), repCount: reps.length,
      upcoming, overdueCount, overdueGpv, overdueMonths, todayIso,
      nextLive, nextSigned, nextTotal: nextLive + nextSigned, nextQuotaSum, nqLabel };
  }, [data, viewId]);

  const editQuarter = (nq) => update((d, cq) => { cq.label = nq.label; cq.start = nq.start; cq.end = nq.end; });

  const closeQuarter = () => {
    const nq = nextQuarter(activeQ.end);
    if (!window.confirm(`Close ${activeQ.label} and start ${nq.label}?\n\n${activeQ.label} becomes read-only (still viewable in the dropdown). Everyone starts fresh at $0 for ${nq.label} — goals carry over so you can adjust them.`)) return;
    setData((p) => {
      const n = JSON.parse(JSON.stringify(p));
      const cur = n.quarters.find((x) => x.id === n.activeId); if (cur) cur.archived = true;
      const newId = slug(nq.label) + "-" + Math.random().toString(36).slice(2, 5);
      const base = cur ? cur.reps : seedRoster();
      const freshReps = base.map((r) => ({ id: uid(), code: r.code, name: r.name, team: r.team, quota: r.quota, carryTotal: "", deals: [], loans: [], prospects: [] }));
      n.quarters.push({ id: newId, label: nq.label, start: nq.start, end: nq.end, archived: false, reps: freshReps });
      n.activeId = newId;
      return n;
    });
    setViewId(null); setTab("master");
  };

  const resetCurrent = () => {
    const ans = window.prompt(`This wipes ${activeQ.label} back to the starting roster at $0 — it cannot be undone (archived quarters are not touched).\n\nType RESET to confirm.`);
    if (ans && ans.trim().toUpperCase() === "RESET") {
      setData((p) => { const n = JSON.parse(JSON.stringify(p)); const cq = n.quarters.find((x) => x.id === n.activeId); if (cq) cq.reps = seedRoster(); return n; });
      setViewId(null); setTab("master");
    }
  };

  const exportCsv = () => {
    let out = "Code,Rep,Goal,Banked,Pipeline,Total forecast,Attainment,Gap\n";
    team.rows.forEach(({ rep, t }) => { out += `${rep.code||""},"${rep.name}",${Math.round(t.quota)},${Math.round(t.banked)},${Math.round(t.pipeline)},${Math.round(t.total)},${(t.attainment*100).toFixed(1)}%,${Math.round(t.gap)}\n`; });
    out += `,TEAM,${Math.round(team.quota)},${Math.round(team.banked)},${Math.round(team.pipeline)},${Math.round(team.total)},${(team.attainment*100).toFixed(1)}%,${Math.round(team.gap)}\n`;
    const url = URL.createObjectURL(new Blob([out], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `pcc-forecast-${q.label.replace(/\s/g,"-")}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (!data) return (<div className="pcc"><Style /><div className="loading">Loading forecast…</div></div>);

  return (
    <div className="pcc">
      <Style />
      <div className="topbar">
        <div className="tb-left">
          <div className="brand-mark">PCC</div>
          <div><div className="brand-name">Field Team Forecast</div><div className="brand-sub">Proper Cheeky Closers</div></div>
        </div>
        <QuarterSwitcher quarters={data.quarters} activeId={data.activeId} viewId={vId} readOnly={readOnly}
          onView={(id) => { setViewId(id); setTab("master"); }} onEdit={editQuarter} onClose={closeQuarter} />
        <div className="tb-right"><button className="ghost" onClick={exportCsv}>Export CSV</button><span className="save-pill">{readOnly ? "read-only" : status}</span></div>
      </div>

      {readOnly && <div className="ro-banner">Viewing <b>{q.label}</b> — archived &amp; read-only. Switch to your current quarter in the dropdown to make changes.</div>}

      <div className="tabs">
        <button className={`tab master ${tab === "master" ? "on" : ""}`} onClick={() => setTab("master")}>
          <span className="tab-ico">▦</span> Master
        </button>
        <div className="tab-div" />
        {reps.map((r) => {
          const t = repTotals(r, q);
          return (
            <button key={r.id} className={`tab ${tab === r.id ? "on" : ""}`} onClick={() => setTab(r.id)}>
              {r.name.split(",")[0]}
              <span className={`tab-att ${t.attainment >= 1 ? "good" : t.attainment >= 0.7 ? "" : "low"}`}>{pct(t.attainment, 0)}</span>
            </button>
          );
        })}
        {!readOnly && <button className="tab add" onClick={() => { const r = mkRep("", "New rep", 0); update((d, cq) => cq.reps.push(r)); setTab(r.id); }}>+</button>}
      </div>

      <div className="body">
        {tab === "master" || !activeRep ? (
          <TeamView team={team} onPick={setTab} readOnly={readOnly} onReset={resetCurrent} onCloseQuarter={closeQuarter} />
        ) : (
          <RepView rep={activeRep} q={q} readOnly={readOnly}
            up={(fn) => update((d, cq) => fn(cq.reps.find((r) => r.id === activeRep.id)))}
            onDelRep={() => { if (window.confirm(`Remove ${activeRep.name}?`)) { update((d, cq) => (cq.reps = cq.reps.filter((r) => r.id !== activeRep.id))); setTab("master"); } }} />
        )}
      </div>
      <div className="foot-note">One shared team sheet — everyone with this link edits the same data. Reps work their own tab; you see all of it in Master.</div>
    </div>
  );
}

/* ---------- activation window (manager view) ---------- */
function ActivationWindow({ upcoming, todayIso }) {
  const [range, setRange] = useState("month");
  const today = new Date(todayIso + "T00:00:00");
  const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // window end (inclusive) for each range
  let end = null;
  if (range === "week") end = iso(addDays(7));
  else if (range === "nextweek") end = iso(addDays(14));
  else if (range === "month") end = iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const startOfNextWeek = iso(addDays(7));

  const inRange = (u) => {
    if (!u.goLive) return false;
    if (u.overdue) return false; // overdue handled separately
    if (range === "all") return u.goLive >= todayIso;
    if (range === "nextweek") return u.goLive >= startOfNextWeek && u.goLive <= end;
    return u.goLive >= todayIso && u.goLive <= end;
  };
  const list = upcoming.filter(inRange);
  const overdue = upcoming.filter((u) => u.overdue);
  const tabs = [["week", "This week"], ["nextweek", "Next week"], ["month", "This month"], ["all", "All upcoming"]];
  const totalGpv = list.reduce((s, u) => s + u.gpv, 0);

  return (
    <div className="aw">
      <div className="aw-head">
        <div className="pg-sub-head">Deals set to activate</div>
        <div className="aw-tabs">
          {tabs.map(([k, lbl]) => (
            <button key={k} className={`aw-tab ${range === k ? "on" : ""}`} onClick={() => setRange(k)}>{lbl}</button>
          ))}
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="aw-overdue">
          <div className="aw-overdue-label">Overdue — go-live date has passed, needs a new date</div>
          {overdue.map((u, i) => (
            <div className="aw-row overdue" key={"o" + i}>
              <span className="aw-name">{u.name} <span className={`aw-kind ${u.kind}`}>{u.kind}</span></span>
              <span className="aw-rep">{u.repFirst}</span>
              <span className="aw-date">{usDate(u.goLive)}</span>
              <span className="aw-gpv mono">{money(u.gpv)}</span>
            </div>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <div className="aw-empty">Nothing dated to go live in this window.</div>
      ) : (
        <>
          {list.map((u, i) => (
            <div className="aw-row" key={i}>
              <span className="aw-name">{u.name} <span className={`aw-kind ${u.kind}`}>{u.kind}</span></span>
              <span className="aw-rep">{u.repFirst}</span>
              <span className="aw-date">{usDate(u.goLive)}</span>
              <span className="aw-gpv mono">{money(u.gpv)}</span>
            </div>
          ))}
          <div className="aw-total">{list.length} deal{list.length > 1 ? "s" : ""} · {money(totalGpv)} GPV lined up</div>
        </>
      )}
    </div>
  );
}

/* ---------- month cell (3-tier go-live bar) ---------- */
function MonthCell({ label, prospect, signed, live, target, overdue = 0, onClick, selected }) {
  const total = prospect + signed + live + overdue;
  let used = 0;
  const lw = Math.min((live / target) * 100, 100); used += lw;
  const ow = Math.min((overdue / target) * 100, Math.max(0, 100 - used)); used += ow;
  const sw = Math.min((signed / target) * 100, Math.max(0, 100 - used)); used += sw;
  const pw = Math.min((prospect / target) * 100, Math.max(0, 100 - used));
  const liveHit = live >= target;
  const totalHit = total >= target;
  return (
    <div className={`month-cell ${onClick ? "clickable" : ""} ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="month-top">
        <span className="month-name">{label}{onClick && <span className="month-caret">{selected ? " ▾" : " ▸"}</span>}</span>
        <span className={`month-gpv mono ${liveHit ? "good" : "warn"}`}>{money(total)} <span className="month-pct">({target > 0 ? pct(total / target, 0) : "0%"} to goal)</span></span>
      </div>
      <div className="month-bar">
        <div className="month-fill live" style={{ left: 0, width: `${lw}%` }} />
        <div className="month-fill overdue" style={{ left: `${lw}%`, width: `${ow}%` }} />
        <div className="month-fill signed" style={{ left: `${lw + ow}%`, width: `${sw}%` }} />
        <div className="month-fill prospect" style={{ left: `${lw + ow + sw}%`, width: `${pw}%` }} />
        <div className="month-goal" />
        {overdue > 0 && <span className="month-overdue-flag" title="A deal here has a past go-live date">!</span>}
      </div>
      <div className="month-note">
        <span className="good">{money(live)} active</span> · <span className="warn">{money(signed)} signed</span> · <span className="muted">{money(prospect)} prospect</span>
        {overdue > 0 && <> · <span className="danger">{money(overdue)} at risk</span></>}
        {" — "}<span className={liveHit ? "good" : ""}>{liveHit ? "target locked" : totalHit ? "on track" : `${money(Math.max(0, target - total))} short`}</span>
      </div>
    </div>
  );
}

/* ---------- bar ---------- */
function Bar({ banked, pipeline, overdue = 0, scenario = 0, quota, slim }) {
  const q = quota || 1;
  const amber = Math.max(0, pipeline - overdue);
  const b = Math.min((banked / q) * 100, 100);
  const p = Math.min((amber / q) * 100, Math.max(0, 100 - b));
  const o = Math.min((overdue / q) * 100, Math.max(0, 100 - b - p));
  const s = Math.min((scenario / q) * 100, Math.max(0, 100 - b - p - o));
  return (
    <div className={`bar ${slim ? "slim" : ""}`}>
      <div className="bar-track">
        <div className="seg banked" style={{ width: `${b}%` }} />
        <div className="seg pipeline" style={{ left: `${b}%`, width: `${p}%` }} />
        {overdue > 0 && <div className="seg overdue" style={{ left: `${b + p}%`, width: `${o}%` }} />}
        {scenario > 0 && <div className="seg scenario" style={{ left: `${b + p + o}%`, width: `${s}%` }} />}
        <div className="goal" />
      </div>
    </div>
  );
}

/* ---------- quarter switcher ---------- */
function QuarterSwitcher({ quarters, activeId, viewId, onView, onEdit, onClose, readOnly }) {
  const [open, setOpen] = useState(false);
  const active = quarters.find((x) => x.id === activeId) || quarters[0];
  const viewed = quarters.find((x) => x.id === viewId) || active;
  const year = new Date((viewed.start || "") + "T00:00:00").getFullYear() || new Date().getFullYear();
  const presets = [["Q1", `${year}-01-01`, `${year}-03-31`], ["Q2", `${year}-04-01`, `${year}-06-30`],
    ["Q3", `${year}-07-01`, `${year}-09-30`], ["Q4", `${year}-10-01`, `${year}-12-31`]];
  const sorted = [...quarters].sort((a, b) => (a.start < b.start ? 1 : -1));
  return (
    <div className="qc">
      <button className="qc-btn" onClick={() => setOpen((o) => !o)}>
        <span className={`qc-dot ${readOnly ? "ro" : ""}`} /> {viewed.label}
        <span className="qc-range">{viewed.start} → {viewed.end}</span>
        {readOnly && <span className="qc-robadge">archived</span>}
        <span className="qc-caret">▾</span>
      </button>
      {open && (
        <div className="qc-pop" onMouseLeave={() => setOpen(false)}>
          <div className="qc-section-label">Quarters</div>
          <div className="qc-list">
            {sorted.map((qq) => (
              <button key={qq.id} className={`qc-qrow ${qq.id === viewed.id ? "on" : ""}`} onClick={() => { onView(qq.id); setOpen(false); }}>
                <span>{qq.label}</span>
                <span className={`qc-qrow-meta ${qq.id === activeId ? "current" : ""}`}>{qq.id === activeId ? "current" : "archived"}</span>
              </button>
            ))}
          </div>
          {!readOnly && (
            <>
              <div className="qc-section-label">Current quarter dates</div>
              <input className="qc-title" value={active.label} onChange={(e) => onEdit({ label: e.target.value, start: active.start, end: active.end })} />
              <div className="qc-dates">
                <label>Start<input type="date" value={active.start} onChange={(e) => onEdit({ label: active.label, start: e.target.value, end: active.end })} /></label>
                <label>End<input type="date" value={active.end} onChange={(e) => onEdit({ label: active.label, start: active.start, end: e.target.value })} /></label>
              </div>
              <div className="qc-presets">{presets.map(([l, s, e]) => (
                <button key={l} className={`chip ${active.start === s && active.end === e ? "on" : ""}`} onClick={() => onEdit({ label: `${l} ${year}`, start: s, end: e })}>{l}</button>))}</div>
              <button className="qc-close-btn" onClick={() => { setOpen(false); onClose(); }}>Close quarter &amp; start next →</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- master ---------- */
function TeamView({ team, onPick, onReset, readOnly, onCloseQuarter }) {
  const [openMonth, setOpenMonth] = useState(null);
  const [openNextQ, setOpenNextQ] = useState(false);
  return (
    <div className="view">
      <h1 className="view-title">Master view</h1>
      <p className="view-lede">Every rep's Q3 progress in one place. Green is banked, amber is weighted pipeline. Click a rep to open their tab.</p>
      <div className="kpi-row">
        <Kpi label="Team Q3 goal" value={money(team.quota)} />
        <Kpi label="Banked" value={money(team.banked)} tone="good" hint="closed + live + loans" />
        <Kpi label="Pipeline" value={money(team.pipeline)} tone="warn" hint="signed, weighted" />
        <Kpi label="Total forecast" value={money(team.total)} tone="accent" />
        <Kpi label="Attainment" value={pct(team.attainment)} tone={team.attainment >= 1 ? "good" : ""} />
      </div>
      <div className="tablecard">
        <div className="row head">
          <div className="c-rep">Rep</div><div className="c-num">Q3 goal</div><div className="c-num">Banked</div>
          <div className="c-num">Pipeline</div><div className="c-num">Forecast</div><div className="c-num">Att.</div><div className="c-bar">Progress to goal</div>
        </div>
        {[...team.rows].sort((a, b) => b.t.attainment - a.t.attainment).map(({ rep, t }) => (
          <div className="row" key={rep.id} onClick={() => onPick(rep.id)}>
            <div className="c-rep"><span className="r-name">{rep.name}</span>{rep.code && <span className="r-code">{rep.code}</span>}</div>
            <div className="c-num mono">{money(t.quota)}</div><div className="c-num mono good">{money(t.banked)}</div>
            <div className="c-num mono warn">{money(t.pipeline)}</div><div className="c-num mono strong">{money(t.total)}</div>
            <div className={`c-num mono ${t.attainment >= 1 ? "good" : ""}`}>{pct(t.attainment, 0)}</div>
            <div className="c-bar"><Bar banked={t.banked} pipeline={t.pipeline} overdue={t.overdue} quota={t.quota} /></div>
          </div>
        ))}
        <div className="row total">
          <div className="c-rep">Total</div><div className="c-num mono">{money(team.quota)}</div><div className="c-num mono good">{money(team.banked)}</div>
          <div className="c-num mono warn">{money(team.pipeline)}</div><div className="c-num mono strong">{money(team.total)}</div>
          <div className="c-num mono">{pct(team.attainment, 0)}</div><div className="c-bar"><Bar banked={team.banked} pipeline={team.pipeline} quota={team.quota} /></div>
        </div>
      </div>
      <div className="team-golive">
        <div className="tg-head">
          <div>
            <h2>Team go-live — {money(4000000)}/rep per month</h2>
            <p className="section-sub">Everyone's deals and prospects, by go-live month. Green = live (locked), solid amber = signed, hatched = prospect. Team line is {money(4000000)} × {team.repCount} reps = {money(team.teamTarget)}/month.</p>
          </div>
        </div>
        {team.overdueCount > 0 && (
          <div className="overdue-badge">⚠ {team.overdueCount} deal{team.overdueCount > 1 ? "s" : ""} past their go-live date ({money(team.overdueGpv)} GPV) — dates need updating</div>
        )}
        <div className="month-strip team">
          {team.monthData.map((md, i) => (
            <MonthCell key={i} label={`${MONTHS_SHORT[md.m.getMonth()]} ${md.m.getFullYear()}`} prospect={md.prospect} signed={md.signed} live={md.live} target={team.teamTarget} overdue={md.overdue}
              onClick={() => setOpenMonth(openMonth === i ? null : i)} selected={openMonth === i} />
          ))}
        </div>

        {openMonth != null && team.monthData[openMonth] && (() => {
          const md = team.monthData[openMonth];
          const groups = [["active", "Active — live", "good"], ["signed", "Signed", "warn"], ["prospect", "Prospect", "muted"], ["overdue", "Overdue — past go-live", "danger"]];
          const totalGpv = md.live + md.signed + md.prospect + md.overdue;
          return (
            <div className="month-detail">
              <div className="md-head"><span><b>{MONTHS_SHORT[md.m.getMonth()]} {md.m.getFullYear()}</b> — {money(totalGpv)} GPV · {md.deals.length} deal{md.deals.length !== 1 ? "s" : ""}</span><button className="md-close" onClick={() => setOpenMonth(null)}>Close ×</button></div>
              {md.deals.length === 0 ? <div className="md-empty">No deals dated to this month yet.</div> : groups.map(([k, lbl, cls]) => {
                const items = md.deals.filter((d) => d.kind === k);
                if (!items.length) return null;
                const sub = items.reduce((s, d) => s + d.gpv, 0);
                return (
                  <div className="md-group" key={k}>
                    <div className={`md-group-label ${cls}`}>{lbl} · {items.length} · {money(sub)} GPV</div>
                    {items.map((d, j) => (
                      <div className="md-row" key={j}>
                        <span className="md-name">{d.name}</span>
                        <span className="md-rep">{d.rep}</span>
                        <span className="md-date">{d.goLive ? usDate(d.goLive) : "no date"}</span>
                        <span className="md-gpv mono">{money(d.gpv)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })()}

        <ActivationWindow upcoming={team.upcoming} todayIso={team.todayIso} />

        {team.movers.length > 0 && (
          <div className="tg-movers">
            <div className="pg-sub-head">Biggest deals moving the needle</div>
            {team.movers.map((mv, i) => (
              <div className="mover-row" key={i}>
                <span className="mover-name">{mv.name} <span className="mover-rep">{mv.rep.split(",")[0]}</span></span>
                <span className={`mover-tag ${mv.kind}`}>{mv.kind === "signed" ? "Signed" : "Prospect"}</span>
                <span className="mover-date">{mv.goLive || "no date"}</span>
                <span className="mover-gpv mono">{money(mv.gpv)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section nextq team-nextq">
        <button className="nextq-toggle" onClick={() => setOpenNextQ((o) => !o)}>{openNextQ ? "▾" : "▸"} Team next quarter outlook — {team.nqLabel}</button>
        {openNextQ && (() => {
          const nt = team.nextTotal, nq = team.nextQuotaSum, att = nq ? nt / nq : 0;
          return (
            <div className="nextq-body">
              <p className="section-sub">Revenue already rolling into {team.nqLabel} across the whole team, from signed &amp; live deals' 90-day processing windows. Reps set their own {team.nqLabel} goals on their tabs. Estimate only.</p>
              <div className="nextq-rows">
                <div className="nextq-row"><span className="nextq-lbl"><i className="sw good" /> From signed &amp; live <em>already processing</em></span><b className="mono good">{money(team.nextLive)}</b></div>
                <div className="nextq-row"><span className="nextq-lbl"><i className="sw warn" /> From signed <em>not yet live</em></span><b className="mono warn">{money(team.nextSigned)}</b></div>
                <div className="nextq-row total"><span className="nextq-lbl">Total rolling into {team.nqLabel}</span><b className="mono">{money(nt)}</b></div>
              </div>
              <div className="nextq-att">{nq > 0 ? <>= <b className={att >= 1 ? "good" : "warn"}>{pct(att, 0)}</b> towards the team's combined <b>{money(nq)}</b> goal</> : <span className="muted">Reps haven't set {team.nqLabel} goals yet.</span>}</div>
            </div>
          );
        })()}
      </div>

      {!readOnly && (
        <div className="team-foot">
          <button className="ghost sm" onClick={onCloseQuarter}>Close quarter &amp; start next</button>
          <button className="ghost sm danger" onClick={onReset}>Reset this quarter</button>
          <span className="team-foot-note">“Close quarter” archives this one (still viewable) and opens the next fresh. “Reset” wipes only this quarter back to the roster at $0.</span>
        </div>
      )}
    </div>
  );
}

/* ---------- next quarter outlook ---------- */
function NextQuarter({ rep, q, up }) {
  const [open, setOpen] = useState(false);
  const { nq, live, signed, total } = nextQuarterRollin(rep, q);
  const quota = num(rep.nextQuota);
  const att = quota ? total / quota : 0;
  const gap = Math.max(0, quota - total);
  const gpvNeeded = quota > 0 ? (gap * 12) / (CATCHUP_RATE * 3) : 0;
  return (
    <div className="section nextq">
      <button className="nextq-toggle" onClick={() => setOpen((o) => !o)}>{open ? "▾" : "▸"} Next quarter outlook — {nq.label}</button>
      {open && (
        <div className="nextq-body">
          <p className="section-sub">A look ahead: revenue already rolling into {nq.label} from your signed &amp; live deals (each deal processes for 90 days from go-live — this is the slice landing in {nq.label}). An estimate to sense-check you're entering the quarter with enough.</p>
          <label className="nextq-goal">{nq.label} goal (quota)<span className="dollar"><i>$</i><input inputMode="decimal" value={rep.nextQuota || ""} placeholder="set your target" onChange={(e) => up((r) => (r.nextQuota = e.target.value))} /></span></label>
          <div className="nextq-rows">
            <div className="nextq-row"><span className="nextq-lbl"><i className="sw good" /> Revenue from signed &amp; live <em>expected profit, already processing</em></span><b className="mono good">{money(live)}</b></div>
            <div className="nextq-row"><span className="nextq-lbl"><i className="sw warn" /> Revenue from signed deals <em>not yet live</em></span><b className="mono warn">{money(signed)}</b></div>
            <div className="nextq-row total"><span className="nextq-lbl">Total rolling into {nq.label}</span><b className="mono">{money(total)}</b></div>
          </div>
          <div className="nextq-att">{quota > 0 ? <>= <b className={att >= 1 ? "good" : "warn"}>{pct(att, 0)}</b> towards your <b>{money(quota)}</b> goal</> : <span className="muted">Enter a goal above to see % to target.</span>}</div>
          <label className="nextq-manual">Your own estimate (what you reckon your deals bring)<span className="dollar"><i>$</i><input inputMode="decimal" value={rep.nextManual || ""} placeholder="optional gut-check" onChange={(e) => up((r) => (r.nextManual = e.target.value))} /></span></label>
          {quota > 0 && gap > 0 && <div className="nextq-gpv">To close the {money(gap)} gap: <b>{money(gpvNeeded)}</b> of GPV to build, live by {usDate(nq.start)}.</div>}
          {quota > 0 && gap <= 0 && <div className="nextq-gpv good">On rollover alone you're already at your {nq.label} goal — anything you build is upside.</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- rep ---------- */
function RepView({ rep, q, up, onDelRep, readOnly }) {
  const [scenario, setScenario] = useState(null);
  const [showActivated, setShowActivated] = useState(false);
  const t = repTotals(rep, q);
  const pendingDeals = (rep.deals || []).filter((d) => !d.activated);
  const activeDeals = (rep.deals || []).filter((d) => d.activated);
  const activeGpv = activeDeals.reduce((s, d) => s + num(d.gpv), 0);
  const scnDeal = scenario ? calcDeal(scenario, q).contribution : 0;
  const scnLoan = scenario && scenario.hasLoan ? num(scenario.loanRevenue) : 0;
  const scnContribution = scnDeal + scnLoan;
  const projTotal = t.total + scnContribution;
  const projAtt = t.quota ? projTotal / t.quota : 0;

  const addDeal = () => up((r) => r.deals.push(blankDeal(q)));
  const addLoan = () => up((r) => r.loans.push({ id: uid(), name: "", revenue: "" }));
  const addProspect = () => up((r) => { r.prospects = r.prospects || []; r.prospects.push({ id: uid(), name: "", gpv: "", goLive: q.end }); });
  const patchProspect = (id, p) => up((r) => Object.assign((r.prospects || []).find((x) => x.id === id), p));
  const delProspect = (id) => up((r) => { r.prospects = (r.prospects || []).filter((x) => x.id !== id); });
  const promoteProspect = (id) => up((r) => {
    const p = (r.prospects || []).find((x) => x.id === id); if (!p) return;
    r.deals.push({ ...blankDeal(q), name: p.name, gpv: p.gpv, goLive: p.goLive || q.end });
    r.prospects = r.prospects.filter((x) => x.id !== id);
  });
  const signScenario = () => {
    up((r) => {
      const { hasLoan, loanRevenue, ...deal } = scenario;
      const dealReal = num(deal.gpv) > 0 || num(deal.flatRatePct) > 0 || num(deal.costToSquare) > 0;
      if (dealReal) r.deals.push({ ...deal, id: uid(), stage: "signed" });
      if (hasLoan && num(loanRevenue) > 0) r.loans.push({ id: uid(), name: deal.name || "Loan", revenue: loanRevenue });
    });
    setScenario(null);
  };

  return (
    <div className="view">
      <div className="rep-head">
        <div className="rep-id">
          <input className="rep-name-in" value={rep.name} onChange={(e) => up((r) => (r.name = e.target.value))} />
          <div className="rep-meta">
            <label>Code <input className="mini-in" value={rep.code || ""} onChange={(e) => up((r) => (r.code = e.target.value))} /></label>
            <label>Q3 goal <span className="dollar"><i>$</i><input className="goal-in" inputMode="decimal" value={rep.quota} onChange={(e) => up((r) => (r.quota = e.target.value))} /></span></label>
          </div>
        </div>
        {!readOnly && (
          <button className={`model-cta ${scenario ? "active" : ""}`} onClick={() => setScenario(scenario ? null : { ...blankDeal(q), name: "Prospect", confidence: 100, hasLoan: false, loanRevenue: "" })}>
            {scenario ? "Close scratchpad" : "＋ Model a deal"}
          </button>
        )}
      </div>

      <div className="kpi-row five">
        <Kpi label="Total forecast" value={money(t.total)} tone="accent" />
        <Kpi label="Attainment" value={pct(t.attainment)} tone={t.attainment >= 1 ? "good" : ""} />
        <Kpi label="Banked now" value={money(t.banked)} tone="good" hint={`${pct(t.bankedAtt, 0)} of goal secured`} />
        <Kpi label="From loans" value={money(t.loans)} hint="loan revenue — inside pipeline" />
        <Kpi label={t.gap >= 0 ? "Still to find" : "Over goal by"} value={money(Math.abs(t.gap))} tone={t.gap <= 0 ? "good" : "warn"} />
      </div>

      <div className="herobar">
        <Bar banked={t.banked} pipeline={t.pipeline} overdue={t.overdue} scenario={scnContribution} quota={t.quota} />
        <div className="hero-legend">
          <span><i className="sw good" /> Banked {money(t.banked)}</span>
          <span><i className="sw warn" /> Pipeline {money(Math.max(0, t.pipeline - t.overdue))}{t.loans > 0 ? ` · incl. ${money(t.loans)} loans` : ""}</span>
          {t.overdue > 0 && <span><i className="sw atrisk" /> At risk {money(t.overdue)} <span className="muted">— past go-live</span></span>}
          {scenario && <span><i className="sw scn" /> If signed {money(scnContribution)}</span>}
          <span className="goal-lbl">Goal {money(t.quota)}</span>
        </div>
      </div>

      {/* scenario / negotiation scratchpad */}
      {scenario && (
        <div className="scratch">
          <div className="scratch-top">
            <div>
              <div className="scratch-eyebrow">Negotiation scratchpad</div>
              <input className="scratch-name" value={scenario.name} onChange={(e) => setScenario({ ...scenario, name: e.target.value })} />
            </div>
            <div className="scratch-impact">
              <div className="impact-att">
                <span className="mono now">{pct(t.attainment, 0)}</span>
                <span className="arrow">→</span>
                <span className="mono proj">{pct(projAtt, 0)}</span>
              </div>
              <div className="impact-delta">adds {money(scnContribution)}{scnLoan > 0 ? ` (deal ${money(scnDeal)} + loan ${money(scnLoan)})` : ""} · <b>+{Math.max(0, (projAtt - t.attainment) * 100).toFixed(0)} pts</b> toward goal</div>
            </div>
          </div>
          <ScenarioFields d={scenario} q={q} onPatch={(p) => setScenario({ ...scenario, ...p })} />
          <div className="scratch-loan">
            <button className={`loan-toggle ${scenario.hasLoan ? "on" : ""}`} onClick={() => setScenario({ ...scenario, hasLoan: !scenario.hasLoan })}>
              <span className="lt-box">{scenario.hasLoan ? "✓" : ""}</span> Attach a loan to this deal
            </button>
            {scenario.hasLoan && (
              <div className="scratch-loan-row">
                <label className="inline-field">Loan revenue amount (75% of fee)<span className="dollar"><i>$</i><input inputMode="decimal" value={scenario.loanRevenue} placeholder="0" onChange={(e) => setScenario({ ...scenario, loanRevenue: e.target.value })} /></span></label>
                <div className="loan-credit-readout">Adds to pipeline → <b className="mono warn">{money(scnLoan)}</b></div>
              </div>
            )}
          </div>
          <div className="scratch-actions">
            <span className="scratch-hint">Nothing here counts until you sign it. Adjust the terms — and the loan — and watch the number move.</span>
            <div>
              <button className="ghost sm" onClick={() => setScenario(null)}>Discard</button>
              <button className="primary" onClick={signScenario}>{scenario.hasLoan && num(scenario.loanRevenue) > 0 ? "Sign it — add deal + loan" : "Sign it — add to pipeline"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <div>
            <h2>Carrying into {q.label}</h2>
            <p className="section-sub">Revenue from already-closed accounts still processing this quarter. Pull the single estimate from Looker — it counts fully toward goal, no need to list each deal.</p>
          </div>
        </div>
        <div className="carry-total">
          <label className="carry-total-field">
            <span className="mini-label">Estimated {q.label} revenue from closed accounts</span>
            <div className="dollar big"><i>$</i>
              <input inputMode="decimal" placeholder="0" value={rep.carryTotal || ""} onChange={(e) => up((r) => (r.carryTotal = e.target.value))} />
            </div>
          </label>
          <div className="carry-total-readout">
            <span className="mini-label">Counts toward goal</span>
            <span className="mono good carry-total-val">{money(num(rep.carryTotal))}</span>
          </div>
        </div>
      </div>

      <Section title="Signed deals — pending" sub="Enter each deal once with its GPV and go-live date — it flows automatically into your GPV totals and the monthly $4M bars below. Tick it live when it activates and it drops off here into the rolling number up top." onAdd={readOnly ? null : addDeal} addLabel="+ Add deal">
        {pendingDeals.length === 0 && <Empty>No pending signed deals. Add what you've signed — it auto-fills your path-to-goal below.</Empty>}
        {pendingDeals.map((d) => (
          <DealCard key={d.id} d={d} q={q}
            onPatch={(p) => up((r) => Object.assign(r.deals.find((x) => x.id === d.id), p))}
            onDel={() => up((r) => (r.deals = r.deals.filter((x) => x.id !== d.id)))} />
        ))}
        {activeDeals.length > 0 && (
          <div className="activated-group">
            <button className="activated-toggle" onClick={() => setShowActivated((s) => !s)}>
              {showActivated ? "▾" : "▸"} Activated this quarter ({activeDeals.length}) · {money(activeGpv)} GPV live
            </button>
            {showActivated && activeDeals.map((d) => (
              <div className="activated-row" key={d.id}>
                <span className="activated-name">{d.name || "Untitled deal"}</span>
                <span className="activated-meta">{d.goLive || "no date"}</span>
                <span className="activated-gpv mono">{money(num(d.gpv))} GPV</span>
                {!readOnly && <button className="ghost sm" onClick={() => up((r) => { const x = r.deals.find((y) => y.id === d.id); if (x) x.activated = false; })}>Undo</button>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Loans" sub="Enter the loan revenue amount — that's 75% of the loan fee. Counts toward pipeline." onAdd={readOnly ? null : addLoan} addLabel="+ Add loan">
        {rep.loans.length === 0 && <Empty>No loans logged.</Empty>}
        {rep.loans.map((l) => (
          <div className="carry-row" key={l.id}>
            <input className="line-name" placeholder="Loan / client name" value={l.name} onChange={(e) => up((r) => (r.loans.find((x) => x.id === l.id).name = e.target.value))} />
            <label className="inline-field">Loan revenue (75% of fee)<span className="dollar"><i>$</i><input inputMode="decimal" value={l.revenue} onChange={(e) => up((r) => (r.loans.find((x) => x.id === l.id).revenue = e.target.value))} /></span></label>
            <div className="contrib warn mono">{money(num(l.revenue))}</div>
            <button className="x" onClick={() => up((r) => (r.loans = r.loans.filter((x) => x.id !== l.id)))}>×</button>
          </div>
        ))}
      </Section>

      <PathToGoal t={t} q={q} deals={rep.deals} repSurname={(rep.name || "").split(",")[0].trim()}
        prospects={rep.prospects || []} onAddProspect={readOnly ? null : addProspect} onPatchProspect={patchProspect} onDelProspect={delProspect} onPromoteProspect={readOnly ? null : promoteProspect} />

      <NextQuarter rep={rep} q={q} up={up} />

      {!readOnly && <div className="rep-foot"><button className="ghost sm danger" onClick={onDelRep}>Remove rep</button></div>}
    </div>
  );
}

/* ---------- deal card ---------- */
const CATCHUP_RATE = 0.022; // assumed average take rate for the path-to-goal maths
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = (d) => `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
const usDate = (iso) => { if (!iso) return ""; const p = String(iso).split("-"); return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : String(iso); };
function USDateInput({ value, onChange, className }) {
  const toUS = (iso) => { if (!iso) return ""; const p = String(iso).split("-"); return p.length === 3 ? `${p[1]}/${p[2]}/${p[0]}` : ""; };
  const [text, setText] = useState(toUS(value));
  const nativeRef = useRef(null);
  useEffect(() => { setText(toUS(value)); }, [value]);
  const commit = (t) => {
    const cleaned = (t || "").trim();
    if (cleaned === "") { onChange(""); return; }
    const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let mm = m[1].padStart(2, "0"), dd = m[2].padStart(2, "0"), yy = m[3];
      if (yy.length === 2) yy = "20" + yy;
      const mi = +mm, di = +dd;
      if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31) { onChange(`${yy}-${mm}-${dd}`); return; }
    }
    setText(toUS(value)); // invalid -> revert, never wipe stored date
  };
  const openPicker = () => { const el = nativeRef.current; if (!el) return; try { el.showPicker(); } catch (e) { el.focus(); el.click(); } };
  return (
    <span className={`usdate ${className || ""}`}>
      <input type="text" className="usdate-text" inputMode="numeric" placeholder="MM/DD/YYYY" value={text}
        onChange={(e) => setText(e.target.value)} onBlur={() => commit(text)}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(text); e.currentTarget.blur(); } }} />
      <button type="button" className="usdate-cal" onClick={openPicker} aria-label="Open calendar" title="Pick from calendar">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </button>
      <input ref={nativeRef} type="date" className="usdate-native" tabIndex={-1} aria-hidden="true"
        value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthKey = (isoStr) => { if (!isoStr) return null; const d = new Date(isoStr + "T00:00:00"); return isNaN(d) ? null : d.getFullYear() * 12 + d.getMonth(); };
function quarterMonths(qStart, qEnd) {
  const s = new Date(qStart + "T00:00:00"), e = new Date(qEnd + "T00:00:00");
  const out = []; let d = new Date(s.getFullYear(), s.getMonth(), 1);
  while (d <= e) { out.push(new Date(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  return out;
}

function PathToGoal({ t, q, deals, prospects, onAddProspect, onPatchProspect, onDelProspect, onPromoteProspect, repSurname }) {
  const [openMonth, setOpenMonth] = useState(null);
  if (t.quota <= 0) return null;
  const MONTH_TARGET = 4000000;
  const list = prospects || [];
  const allDeals = deals || [];
  const behind = t.gap > 0;
  const MONTH_TARGET_TXT = MONTH_TARGET;

  // total GPV in play across all this rep's deals (signed pipeline + activated), always shown
  const signedRolling = allDeals.reduce((s, d) => s + num(d.gpv), 0);
  // date-aware "GPV still to close, if live now" (net additional beyond what's signed)
  const qsD = new Date(q.start + "T00:00:00");
  const nowD = new Date();
  const nowPt = nowD < qsD ? qsD : nowD;
  const monthsNow = monthsRemaining(isoDate(nowPt), q.start, q.end);
  const gpvNow = behind && monthsNow > 0 ? (t.gap * 12) / (CATCHUP_RATE * monthsNow) : 0;
  const prospectGpv = list.reduce((s, p) => s + num(p.gpv), 0);
  const stillShort = Math.max(0, gpvNow - prospectGpv);
  const coveredByProspects = Math.min(prospectGpv, gpvNow);
  const coveredPct = gpvNow > 0 ? (coveredByProspects / gpvNow) * 100 : 0;

  // date-aware: revenue a GPV amount earns this quarter, given its go-live date
  const revFromGpv = (gpv, goLive) => num(gpv) * CATCHUP_RATE / 12 * monthsRemaining(goLive, q.start, q.end);

  const prospectRev = list.reduce((s, p) => s + revFromGpv(p.gpv, p.goLive), 0);
  const gapRemaining = t.gap - prospectRev;

  // monthly go-live cadence: prospect / signed / live, by go-live month
  const months = quarterMonths(q.start, q.end);
  const todayIso = isoDate(new Date());
  const monthData = months.map((m) => {
    const key = m.getFullYear() * 12 + m.getMonth();
    let prospect = 0, signed = 0, live = 0, overdue = 0;
    const dealList = [];
    allDeals.forEach((d) => { if (monthKey(d.goLive) === key) { const g = num(d.gpv); let kind; if (d.activated) { live += g; kind = "active"; } else if (d.goLive < todayIso) { overdue += g; kind = "overdue"; } else { signed += g; kind = "signed"; } dealList.push({ name: d.name || "Untitled", gpv: g, goLive: d.goLive, kind }); } });
    list.forEach((p) => { if (monthKey(p.goLive) === key) { const g = num(p.gpv); let kind; if (p.goLive && p.goLive < todayIso) { overdue += g; kind = "overdue"; } else { prospect += g; kind = "prospect"; } dealList.push({ name: p.name || "Prospect", gpv: g, goLive: p.goLive, kind }); } });
    dealList.sort((a, b) => (a.goLive || "9999-12-31").localeCompare(b.goLive || "9999-12-31"));
    return { m, prospect, signed, live, overdue, deals: dealList };
  });

  // date-aware GPV needed to close the gap (restored): if live now vs by each month start
  const gpvChecks = [];
  if (behind) {
    const qs = new Date(q.start + "T00:00:00"), qe = new Date(q.end + "T00:00:00");
    const now = new Date();
    const startPt = now < qs ? qs : now;
    const pts = [new Date(startPt)];
    let d2 = new Date(startPt.getFullYear(), startPt.getMonth() + 1, 1);
    while (d2 < qe) { pts.push(new Date(d2)); d2 = new Date(d2.getFullYear(), d2.getMonth() + 1, 1); }
    pts.forEach((dt, i) => {
      const mr = monthsRemaining(isoDate(dt), q.start, q.end);
      gpvChecks.push({ label: i === 0 ? "live now" : `by ${fmtDate(dt)}`, gpv: mr > 0.3 ? (t.gap * 12) / (CATCHUP_RATE * mr) : null });
    });
  }

  return (
    <div className={`section pathgoal ${behind ? "" : "ongoal"}`}>
      <h2>Path to goal</h2>
      {behind ? (
        <div className={`gapbar-card ${stillShort <= 0 ? "covered" : ""}`}>
          <div className="gapbar-top">
            <span className="gap-label">{stillShort > 0 ? "Still short to hit goal (if live now)" : "Prospects cover it — but nothing's signed yet"}</span>
            <span className={`gap-val mono ${stillShort > 0 ? "warn" : "good"}`}>{stillShort > 0 ? money(stillShort) : "✓ covered"}{stillShort > 0 && <span className="gap-unit">GPV</span>}</span>
          </div>
          <div className="gapbar-track" title="Hatched = prospects (not signed yet)">
            <div className="gapbar-prospect" style={{ width: `${coveredPct}%` }} />
          </div>
          <div className="gapbar-legend">
            <span>Gap to close, live now: <b>{money(gpvNow)}</b></span>
            <span className="muted"><i className="hatch-swatch" />prospects could cover <b>{money(coveredByProspects)}</b> — tentative, not signed</span>
          </div>
          {gpvChecks.length > 1 && (
            <div className="gapbar-dates">Wait and the gap grows (fewer processing days): {gpvChecks.slice(1).map((g, i) => (
              <span key={i}>{i > 0 ? " · " : ""}<b>{g.gpv != null ? money(g.gpv) : "too late"}</b> {g.label}</span>
            ))}</div>
          )}
        </div>
      ) : (
        <div className="pg-clear">On pace — {pct(t.attainment)} of goal, {money(-t.gap)} over. Keep {money(MONTH_TARGET)} of GPV going live each month.</div>
      )}

      <div className="pg-sub-head">Go-live plan — {money(MONTH_TARGET)}/mo &nbsp;<span className="pg-legend-inline"><i className="sw live" /> live &nbsp;<i className="sw signed" /> signed &nbsp;<i className="sw prospect" /> prospect &nbsp;<i className="sw atrisk" /> at risk</span></div>
      <div className="month-strip">
        {monthData.map((md, i) => (
          <MonthCell key={i} label={`${MONTHS_SHORT[md.m.getMonth()]} ${md.m.getFullYear()}`} prospect={md.prospect} signed={md.signed} live={md.live} target={MONTH_TARGET} overdue={md.overdue}
            onClick={() => setOpenMonth(openMonth === i ? null : i)} selected={openMonth === i} />
        ))}
      </div>

      {openMonth != null && monthData[openMonth] && (() => {
        const md = monthData[openMonth];
        const groups = [["active", "Active — live", "good"], ["signed", "Signed", "warn"], ["prospect", "Prospect", "muted"], ["overdue", "Overdue — past go-live", "danger"]];
        const totalGpv = md.live + md.signed + md.prospect + md.overdue;
        return (
          <div className="month-detail">
            <div className="md-head"><span><b>{MONTHS_SHORT[md.m.getMonth()]} {md.m.getFullYear()}</b> — {money(totalGpv)} GPV · {md.deals.length} deal{md.deals.length !== 1 ? "s" : ""}</span><button className="md-close" onClick={() => setOpenMonth(null)}>Close ×</button></div>
            {md.deals.length === 0 ? <div className="md-empty">No deals dated to this month yet.</div> : groups.map(([k, lbl, cls]) => {
              const items = md.deals.filter((d) => d.kind === k);
              if (!items.length) return null;
              const sub = items.reduce((s, d) => s + d.gpv, 0);
              return (
                <div className="md-group" key={k}>
                  <div className={`md-group-label ${cls}`}>{lbl} · {items.length} · {money(sub)} GPV</div>
                  {items.map((d, j) => (
                    <div className="md-row rep" key={j}>
                      <span className="md-name">{d.name}</span>
                      <span className="md-date">{d.goLive ? usDate(d.goLive) : "no date"}</span>
                      <span className="md-gpv mono">{money(d.gpv)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })()}
      <p className="pg-fineprint">Green = live (locked in) · solid amber = signed (won, coming) · hatched = prospect (chasing). Bucketed by go-live date.</p>

      <div className="pg-prospects">
        <div className="pg-prospects-head">
          <div className="pg-sub-head">Which deals will get you there? Add the prospects you're chasing — each one's GPV feeds the go-live month it's dated to (shown in the bars above).</div>
          {onAddProspect && <button className="ghost sm" onClick={onAddProspect}>+ Add prospect</button>}
        </div>
        {list.length === 0 && <div className="pg-prospects-empty">No prospects yet. Add each one's GPV and an expected go-live date — it drops into that month's go-live bar above.</div>}
        {list.map((p) => {
          const mk = monthKey(p.goLive);
          const monthLabel = mk != null ? `${MONTHS_SHORT[new Date(p.goLive + "T00:00:00").getMonth()]} ${new Date(p.goLive + "T00:00:00").getFullYear()}` : null;
          return (
            <div className="prospect-item" key={p.id}>
              <div className="prospect-row">
                <input className="line-name" placeholder="Prospect / opp name" value={p.name} onChange={(e) => onPatchProspect(p.id, { name: e.target.value })} />
                <label className="inline-field">GPV<span className="dollar"><i>$</i><input inputMode="decimal" value={p.gpv} onChange={(e) => onPatchProspect(p.id, { gpv: e.target.value })} /></span></label>
                <label className="inline-field">Est. go-live<USDateInput value={p.goLive || ""} onChange={(v) => onPatchProspect(p.id, { goLive: v })} /></label>
                <div className="prospect-added">{monthLabel ? <><span className="tick">✓</span> added to {monthLabel}</> : <span className="muted">add a date</span>}</div>
                {onPromoteProspect && <button className="promote-btn" onClick={() => onPromoteProspect(p.id)} title="Move to signed deals">→ Sign</button>}
                <button className="x" onClick={() => onDelProspect(p.id)} aria-label="Delete prospect">×</button>
              </div>
              <div className="prospect-notes">
                <label className="note-field"><span className="note-label">{repSurname ? `${repSurname}'s` : "Rep's"} next step</span><input value={p.repNextStep || ""} placeholder="what you're doing next…" onChange={(e) => onPatchProspect(p.id, { repNextStep: e.target.value })} /></label>
                <label className="note-field mgr"><span className="note-label">Gareth's next step</span><input value={p.mgrNextStep || ""} placeholder="manager note…" onChange={(e) => onPatchProspect(p.id, { mgrNextStep: e.target.value })} /></label>
              </div>
            </div>
          );
        })}
        {list.length > 0 && (
          <div className="pg-prospect-totals">
            <span>Prospects add <b className="mono">{money(prospectGpv)}</b> GPV</span>
            {behind && <span className={stillShort <= 0 ? "good strong" : "warn strong"}>{stillShort <= 0 ? `Enough — ${money(prospectGpv - gpvNow)} to spare` : `Still short ${money(stillShort)} GPV`}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function DealCard({ d, q, onPatch, onDel }) {
  const c = calcDeal(d, q), isFlat = d.model !== "costplus", activated = !!d.activated;
  const overdue = !activated && !!d.goLive && d.goLive < isoDate(new Date());
  return (
    <div className={`deal ${activated ? "islive" : overdue ? "isoverdue" : "issigned"}`}>
      {overdue && <div className="deal-overdue">⚠ Go-live date ({usDate(d.goLive)}) is in the past — update it below, or tick the deal live if it's activated.</div>}
      <div className="deal-header">
        <div className="deal-header-left">
          <span className={`status-pill ${activated ? "live" : overdue ? "overdue" : "signed"}`}>{activated ? "Activated" : overdue ? "Overdue" : "Signed"}</span>
          <input className="deal-name-in" placeholder="Untitled deal" value={d.name} onChange={(e) => onPatch({ name: e.target.value })} />
        </div>
        <div className="deal-header-right">
          <div className="deal-forecast">
            <span className="mini-label">{activated ? "GPV live" : "Forecast"}</span>
            <span className={`deal-forecast-val mono ${activated ? "good" : "warn"}`}>{activated ? money(num(d.gpv)) : money(c.contribution)}</span>
          </div>
          <button className="x" onClick={onDel} aria-label="Delete deal">×</button>
        </div>
      </div>
      <div className="deal-controls">
        <button className={`nowlive-btn ${activated ? "on" : ""}`} onClick={() => {
          if (activated) { if (window.confirm("Move this deal back to pipeline (not yet live)?")) onPatch({ activated: false }); }
          else { if (window.confirm(`Mark "${d.name || "this deal"}" activated? Its GPV moves to your live/actual total for its go-live month, and its revenue now comes from your closed-accounts total (not counted again here).`)) onPatch({ activated: true }); }
        }}>
          <span className={`nowlive-box ${activated ? "checked" : ""}`}>{activated ? "✓" : ""}</span> {activated ? "Activated — click to undo" : "Tick once activated"}
        </button>
        <div className="model-toggle">
          <button className={isFlat ? "on" : ""} onClick={() => onPatch({ model: "flat" })}>Flat/blended</button>
          <button className={!isFlat ? "on" : ""} onClick={() => onPatch({ model: "costplus" })}>Cost-plus</button>
        </div>
      </div>
      <DealFields d={d} isFlat={isFlat} live={false} onPatch={onPatch} />
      <div className="deal-calc">
        <Calc label="Eff. rate" v={pct(c.effRate, 3)} /><Calc label="Monthly" v={money(c.monthly)} />
        <Calc label="Months left" v={c.mr.toFixed(2)} /><Calc label={activated ? "Revenue" : "Quota credit"} v={activated ? "via closed-accts" : money(c.quotaCredit)} />
      </div>
    </div>
  );
}

/* shared field grids */
function DealFields({ d, isFlat, live, onPatch, overdue }) {
  return (
    <div className="fields">
      <Field label="Annual GPV" pre="$" v={d.gpv} on={(v) => onPatch({ gpv: v })} />
      {isFlat ? (<>
        <Field label="Flat rate" suf="%" v={d.flatRatePct} on={(v) => onPatch({ flatRatePct: v })} hint="3.85" />
        <Field label="Fixed fee / txn" pre="$" v={d.flatFixedFee} on={(v) => onPatch({ flatFixedFee: v })} />
        <Field label="Avg txn size" pre="$" v={d.avgTxn} on={(v) => onPatch({ avgTxn: v })} />
      </>) : (<>
        <Field label="Cost to Square" suf="%" v={d.costToSquare} on={(v) => onPatch({ costToSquare: v })} hint="2.31" />
        <Field label="Cost+ margin" suf="%" v={d.costMargin} on={(v) => onPatch({ costMargin: v })} hint="0.10" />
      </>)}
      <Field label="Monthly SaaS amount (per location)" pre="$" v={d.saasPerMonth} on={(v) => onPatch({ saasPerMonth: v })} />
      <Field label="# locations" v={d.numLocations} on={(v) => onPatch({ numLocations: v })} />
      <label className="fld"><span className={`mini-label ${overdue ? "danger-label" : ""}`}>Go-live date{overdue ? " — in the past" : ""}</span><USDateInput className={overdue ? "date-overdue" : ""} value={d.goLive} onChange={(v) => onPatch({ goLive: v })} /></label>
    </div>
  );
}
function ScenarioFields({ d, q, onPatch }) {
  const isFlat = d.model !== "costplus"; const c = calcDeal(d, q);
  return (
    <>
      <div className="scratch-modeltoggle">
        <div className="model-toggle">
          <button className={isFlat ? "on" : ""} onClick={() => onPatch({ model: "flat" })}>Flat/blended</button>
          <button className={!isFlat ? "on" : ""} onClick={() => onPatch({ model: "costplus" })}>Cost-plus</button>
        </div>
        <span className="scratch-rate">Eff. rate {pct(c.effRate, 3)} · monthly {money(c.monthly)} · {c.mr.toFixed(2)} mo left</span>
      </div>
      <DealFields d={d} isFlat={isFlat} live={false} onPatch={onPatch} />
    </>
  );
}

/* ---------- small ---------- */
function Section({ title, sub, onAdd, addLabel, children }) {
  return (<div className="section"><div className="section-head"><div><h2>{title}</h2><p className="section-sub">{sub}</p></div>
    {onAdd && <button className="primary" onClick={onAdd}>{addLabel}</button>}</div>{children}</div>);
}
const Empty = ({ children }) => <div className="empty">{children}</div>;
function Field({ label, v, on, pre, suf, hint, disabled }) {
  return (<label className="fld"><span className="mini-label">{label}</span>
    <div className={`in-wrap ${disabled ? "off" : ""}`}>{pre && <span className="affix pre">{pre}</span>}
      <input inputMode="decimal" value={disabled ? "—" : v} placeholder={hint || ""} disabled={disabled} onChange={(e) => on(e.target.value)} />
      {suf && <span className="affix suf">{suf}</span>}</div></label>);
}
const Calc = ({ label, v, strong, tone }) => (<div className={`calc ${strong ? "strong" : ""} ${tone || ""}`}><span className="mini-label">{label}</span><span className="mono">{v}</span></div>);
const Kpi = ({ label, value, tone, hint }) => (<div className={`kpi ${tone || ""}`}><div className="kpi-label">{label}</div><div className="kpi-value mono">{value}</div>{hint && <div className="kpi-hint">{hint}</div>}</div>);

/* ---------- styles ---------- */
function Style() {
  return (<style>{`
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
  .pcc{--ink:#1B1F27;--muted:#6B7480;--line:#E4E7EB;--line2:#EEF0F3;--bg:#FFFFFF;
    --accent:#2563A8;--accent-soft:#EAF1F8;--good:#157A54;--good-soft:#E8F3EE;
    --warn:#C07C1E;--warn-soft:#FBF1DF;--danger:#B03A2E;--sel:#F3F7FC;--scn:#7C4DBE;--scn-soft:#F1EBFA;
    font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;-webkit-font-smoothing:antialiased}
  .pcc *{box-sizing:border-box}
  .loading{padding:40px;color:var(--muted)}
  .topbar{display:flex;align-items:center;gap:20px;padding:15px 30px;border-bottom:1px solid var(--line);position:sticky;top:0;background:#fff;z-index:20}
  .tb-left{display:flex;align-items:center;gap:11px}
  .brand-mark{width:36px;height:36px;border-radius:9px;background:var(--accent);color:#fff;display:grid;place-items:center;font-family:'Space Grotesk';font-weight:700;font-size:13px;letter-spacing:.5px}
  .brand-name{font-family:'Space Grotesk';font-weight:600;font-size:15px}
  .brand-sub{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.13em}
  .tb-right{margin-left:auto;display:flex;align-items:center;gap:12px}
  .save-pill{font-size:11px;color:var(--muted);font-family:'JetBrains Mono'}
  .qc{position:relative;margin-left:8px}
  .qc-btn{display:flex;align-items:center;gap:9px;background:var(--accent-soft);border:1px solid #D5E3F1;color:var(--accent);border-radius:9px;padding:8px 13px;font-weight:600;font-size:13px;cursor:pointer;font-family:'Space Grotesk'}
  .qc-dot{width:8px;height:8px;border-radius:50%;background:var(--accent)}
  .qc-range{font-family:'JetBrains Mono';font-size:11px;color:#5A7EA6;font-weight:500}
  .qc-caret{font-size:9px}
  .qc-pop{position:absolute;top:44px;left:0;background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;box-shadow:0 12px 30px rgba(20,30,45,.14);z-index:30;width:260px}
  .qc-title{width:100%;border:none;border-bottom:1.5px solid var(--line);font-family:'Space Grotesk';font-weight:600;font-size:16px;padding:2px 0 6px;outline:none}
  .qc-title:focus{border-bottom-color:var(--accent)}
  .qc-dates{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:12px 0}
  .qc-dates label{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);display:flex;flex-direction:column;gap:4px}
  .qc-dates input{border:1px solid var(--line);border-radius:7px;padding:6px;font-family:'JetBrains Mono';font-size:11px}
  .qc-presets{display:flex;flex-wrap:wrap;gap:6px}
  .chip{background:#F4F6F8;border:1px solid var(--line);color:var(--muted);border-radius:7px;padding:5px 11px;font-size:11px;font-weight:600;cursor:pointer;font-family:'JetBrains Mono'}
  .chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
  /* tabs */
  .tabs{display:flex;align-items:center;gap:4px;padding:0 22px;border-bottom:1px solid var(--line);background:#FAFBFC;overflow-x:auto;position:sticky;top:67px;z-index:15}
  .tab{border:none;background:transparent;padding:14px 15px;font-size:13.5px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2.5px solid transparent;white-space:nowrap;display:flex;align-items:center;gap:8px;font-family:'Inter';margin-bottom:-1px}
  .tab:hover{color:var(--ink)}
  .tab.on{color:var(--accent);border-bottom-color:var(--accent)}
  .tab.master{color:var(--ink)} .tab.master.on{color:var(--accent)}
  .tab-ico{font-size:13px}
  .tab-att{font-family:'JetBrains Mono';font-size:11px;font-weight:600;background:#EDEFF2;color:var(--muted);border-radius:20px;padding:1px 7px}
  .tab-att.good{background:var(--good-soft);color:var(--good)} .tab-att.low{background:#FBEBEA;color:var(--danger)}
  .tab-div{width:1px;height:20px;background:var(--line);margin:0 6px}
  .tab.add{color:var(--muted);font-size:17px;padding:10px 14px}
  .body{padding:26px 30px 44px;max-width:1200px;margin:0 auto}
  .view-title{font-family:'Space Grotesk';font-weight:700;font-size:26px;margin:0 0 6px;letter-spacing:-.02em}
  .view-lede{color:var(--muted);font-size:13.5px;margin:0 0 22px;max-width:640px;line-height:1.5}
  /* kpi */
  .kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:18px}
  .kpi-row.four{grid-template-columns:repeat(4,1fr)}
  .kpi{border:1px solid var(--line);border-radius:13px;padding:16px 18px;background:#fff}
  .kpi.accent{background:var(--accent);border-color:var(--accent)}
  .kpi.accent .kpi-label,.kpi.accent .kpi-value,.kpi.accent .kpi-hint{color:#fff}
  .kpi.good{background:var(--good-soft);border-color:#C7E4D6} .kpi.good .kpi-value{color:var(--good)}
  .kpi.warn{background:var(--warn-soft);border-color:#EEDBBB} .kpi.warn .kpi-value{color:var(--warn)}
  .kpi-label{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-bottom:7px}
  .kpi-value{font-size:24px;font-weight:600}
  .kpi-hint{font-size:11px;color:var(--muted);margin-top:4px}
  .mono{font-family:'JetBrains Mono'} .good{color:var(--good)} .warn{color:var(--warn)} .strong{font-weight:600}
  /* table */
  .tablecard{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff}
  .row{display:grid;grid-template-columns:1.7fr .95fr .95fr .95fr .95fr .6fr 1.7fr;gap:14px;align-items:center;padding:15px 20px;border-bottom:1px solid var(--line2);cursor:pointer}
  .row:last-child{border-bottom:none}
  .row.head{background:#F7F8FA;cursor:default;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;padding:12px 20px}
  .row:not(.head):not(.total):hover{background:var(--sel)}
  .row.total{background:#F7F8FA;cursor:default;font-weight:600;border-top:1px solid var(--line)}
  .c-num{text-align:right} .c-num.mono{font-size:13px}
  .r-name{font-weight:600;font-family:'Space Grotesk';font-size:14px;display:block}
  .r-code{font-size:11px;color:var(--muted);font-family:'JetBrains Mono'}
  /* bar */
  .bar-track{position:relative;height:18px;background:#EDF0F3;border-radius:5px;overflow:hidden}
  .bar.slim .bar-track{height:7px}
  .seg{position:absolute;top:0;bottom:0;transition:width .2s,left .2s}
  .seg.banked{left:0;background:var(--good)}
  .seg.pipeline{background:var(--warn);opacity:.85}
  .seg.scenario{background:repeating-linear-gradient(45deg,var(--scn),var(--scn) 5px,#9B72D4 5px,#9B72D4 10px)}
  .goal{position:absolute;top:-2px;bottom:-2px;left:calc(100% - 2px);width:2px;background:var(--ink)}
  /* rep head */
  .rep-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:20px}
  .rep-name-in{font-family:'Space Grotesk';font-weight:700;font-size:28px;border:none;border-bottom:2px solid transparent;outline:none;padding:0;color:var(--ink);width:100%;letter-spacing:-.02em}
  .rep-name-in:focus{border-bottom-color:var(--accent)}
  .rep-meta{display:flex;gap:22px;margin-top:10px}
  .rep-meta label{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);display:flex;align-items:center;gap:8px}
  .mini-in{border:1px solid var(--line);border-radius:7px;padding:6px 9px;font-family:'JetBrains Mono';font-size:12px;width:90px;color:var(--ink)}
  .dollar{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:7px;overflow:hidden}
  .dollar i{padding:0 8px;color:var(--muted);font-style:normal;font-family:'JetBrains Mono';font-size:12px;border-right:1px solid var(--line)}
  .goal-in{border:none;outline:none;padding:7px 9px;width:112px;font-family:'JetBrains Mono';font-size:14px;font-weight:600;text-align:right}
  .model-cta{background:var(--scn);color:#fff;border:none;border-radius:10px;padding:12px 20px;font-weight:600;font-size:14px;cursor:pointer;white-space:nowrap;font-family:'Space Grotesk';box-shadow:0 2px 8px rgba(124,77,190,.28)}
  .model-cta:hover{background:#6C40AC}
  .model-cta.active{background:#fff;color:var(--scn);border:1px solid var(--scn);box-shadow:none}
  /* hero bar */
  .herobar{border:1px solid var(--line);border-radius:13px;padding:18px 20px 15px;margin-bottom:26px;background:#fff}
  .hero-legend{display:flex;gap:22px;margin-top:14px;font-size:12px;color:var(--muted);align-items:center;flex-wrap:wrap}
  .hero-legend .sw,.legend-row .sw{width:11px;height:11px;border-radius:3px;display:inline-block;margin-right:6px;vertical-align:-1px}
  .seg.overdue{background:var(--danger)}
  .hero-legend .muted{color:var(--muted)}
  .sw.good{background:var(--good)} .sw.warn{background:var(--warn)} .sw.scn{background:var(--scn)}
  .goal-lbl{margin-left:auto;font-family:'JetBrains Mono';color:var(--ink);font-weight:600}
  /* scratchpad */
  .scratch{border:1.5px solid var(--scn);background:var(--scn-soft);border-radius:15px;padding:20px;margin-bottom:30px}
  .scratch-top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap;margin-bottom:16px}
  .scratch-eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--scn);font-weight:600;margin-bottom:5px}
  .scratch-name{border:none;background:transparent;border-bottom:1.5px solid #D3C2EC;font-family:'Space Grotesk';font-weight:700;font-size:22px;outline:none;padding:2px 0;color:var(--ink);min-width:220px}
  .scratch-name:focus{border-bottom-color:var(--scn)}
  .scratch-impact{text-align:right}
  .impact-att{display:flex;align-items:center;gap:12px;justify-content:flex-end}
  .impact-att .now{font-size:22px;color:var(--muted)} .impact-att .arrow{color:var(--scn)} .impact-att .proj{font-size:30px;font-weight:600;color:var(--scn)}
  .impact-delta{font-size:12.5px;color:#5B4A78;margin-top:4px} .impact-delta b{color:var(--scn)}
  .scratch-modeltoggle{display:flex;align-items:center;gap:16px;margin-bottom:14px}
  .scratch-rate{font-size:12px;color:#6B5A88;font-family:'JetBrains Mono'}
  .scratch .fields{background:#fff;border-radius:11px;padding:14px;border:1px solid #E4D9F4}
  .scratch-loan{margin-top:14px;background:#fff;border:1px solid #E4D9F4;border-radius:11px;padding:14px 16px}
  .loan-toggle{display:flex;align-items:center;gap:10px;background:none;border:none;font-size:13.5px;font-weight:600;color:var(--scn);cursor:pointer;font-family:'Inter';padding:0}
  .lt-box{width:19px;height:19px;border-radius:5px;border:1.5px solid var(--scn);display:grid;place-items:center;font-size:12px;color:#fff;background:#fff;line-height:1}
  .loan-toggle.on .lt-box{background:var(--scn)}
  .scratch-loan-row{display:flex;align-items:flex-end;gap:22px;margin-top:14px;flex-wrap:wrap}
  .scratch-loan-row .inline-field .dollar input{width:130px}
  .loan-credit-readout{font-size:13px;color:#5B4A78;padding-bottom:7px}
  .scratch-actions{display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:14px;flex-wrap:wrap}
  .scratch-hint{font-size:12px;color:#6B5A88;max-width:420px}
  .scratch-actions>div{display:flex;gap:10px}
  /* sections */
  .section{margin-bottom:34px}
  .section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px}
  h2{font-family:'Space Grotesk';font-weight:600;font-size:18px;margin:0}
  .section-sub{font-size:12.5px;color:var(--muted);margin:4px 0 0;max-width:660px;line-height:1.5}
  .primary{background:var(--accent);color:#fff;border:none;border-radius:9px;padding:10px 16px;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap;font-family:'Inter'}
  .primary:hover{background:#1F5595}
  .empty{border:1px dashed var(--line);border-radius:12px;padding:22px;text-align:center;color:var(--muted);font-size:13px}
  .carry-row{display:grid;grid-template-columns:1fr auto auto auto;gap:18px;align-items:end;border:1px solid var(--line);border-radius:12px;padding:15px 17px;margin-bottom:10px;background:#fff}
  .line-name{border:none;border-bottom:1.5px solid var(--line);font-family:'Space Grotesk';font-weight:600;font-size:15px;padding:5px 0;outline:none;background:transparent;color:var(--ink)}
  .line-name.big{flex:1} .line-name:focus{border-bottom-color:var(--accent)}
  .inline-field{display:flex;flex-direction:column;gap:5px;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  .inline-field .dollar input{border:none;outline:none;padding:7px 9px;width:120px;font-family:'JetBrains Mono';font-size:13px;text-align:right}
  .contrib{min-width:110px;text-align:right;font-size:16px;font-weight:600;display:flex;flex-direction:column;align-items:flex-end}
  .contrib-sub{font-size:10px;color:var(--muted);letter-spacing:.05em}
  .x{width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--muted);font-size:18px;line-height:1;cursor:pointer}
  .x:hover{border-color:var(--danger);color:var(--danger)}
  /* deal */
  .deal{border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px;background:#fff}
  .deal.islive{border-color:#C7E4D6;background:#FCFEFD}
  .deal-top{display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
  .stage-toggle,.model-toggle{display:flex;background:#EEF0F3;border-radius:8px;padding:2px}
  .stage-toggle button,.model-toggle button{border:none;background:transparent;padding:7px 14px;border-radius:6px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;font-family:'Inter'}
  .stage-toggle button.on{background:#fff;color:var(--accent);box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .stage-toggle button.on.live{color:var(--good)}
  .model-toggle button.on{background:#fff;color:var(--accent);box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .fields{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}
  .fld{display:flex;flex-direction:column;gap:5px}
  .mini-label{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
  .in-wrap{display:flex;align-items:center;border:1px solid var(--line);border-radius:8px;background:#FBFCFD;overflow:hidden}
  .in-wrap.off{background:#F1F2F4;opacity:.7}
  .in-wrap:focus-within{border-color:var(--accent);background:#fff}
  .in-wrap input{border:none;outline:none;background:transparent;padding:9px 10px;width:100%;font-family:'JetBrains Mono';font-size:13px;color:var(--ink)}
  .affix{color:var(--muted);font-family:'JetBrains Mono';font-size:12px;padding:0 8px}
  .affix.pre{border-right:1px solid var(--line)} .affix.suf{border-left:1px solid var(--line)}
  .fld input[type=date]{border:1px solid var(--line);border-radius:8px;padding:9px;font-family:'JetBrains Mono';font-size:12px;background:#FBFCFD;color:var(--ink)}
  .deal-calc{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:16px;padding-top:15px;border-top:1px solid var(--line2)}
  .calc{display:flex;flex-direction:column;gap:3px}
  .calc .mono{font-size:14px;font-weight:600} .calc.strong .mono{font-size:16px}
  .calc.good .mono{color:var(--good)} .calc.warn .mono{color:var(--warn)}
  .calc.good .mini-label{color:var(--good)} .calc.warn .mini-label{color:var(--warn)}
  .live-note{margin-top:13px;font-size:12px;color:var(--good);background:var(--good-soft);border-radius:8px;padding:8px 12px;display:inline-block}
  .rep-foot{display:flex;justify-content:flex-end;margin-top:10px}
  .ghost{background:#fff;border:1px solid var(--line);color:var(--muted);border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:'Inter'}
  .ghost:hover{border-color:var(--accent);color:var(--accent)}
  .ghost.sm{padding:8px 13px;font-size:12px}
  .ghost.danger:hover{border-color:var(--danger);color:var(--danger)}
  .foot-note{padding:0 30px 30px;font-size:11.5px;color:var(--muted);max-width:1200px;margin:0 auto}
  @media(max-width:1000px){
    .kpi-row,.kpi-row.four{grid-template-columns:repeat(2,1fr)}
    .fields{grid-template-columns:repeat(2,1fr)}
    .deal-calc{grid-template-columns:repeat(3,1fr)}
    .row{grid-template-columns:1.4fr 1fr 1fr;gap:8px}
    .row .c-num:nth-child(4),.row .c-num:nth-child(5),.row .c-bar{display:none}
    .row.head .c-num:nth-child(4),.row.head .c-num:nth-child(5),.row.head .c-bar{display:none}
    .body{padding:18px 16px 40px} .rep-head{flex-direction:column} .model-cta{width:100%}
    .scratch-impact{text-align:left}
  }

  /* deal card v2 — header strip + status stripe */
  .deal{position:relative;overflow:hidden}
  .deal.issigned{border-left:4px solid var(--warn)}
  .deal.islive{border-left:4px solid var(--good)}
  .deal-header{display:flex;justify-content:space-between;align-items:center;gap:14px;margin:-2px 0 14px}
  .deal-header-left{display:flex;align-items:center;gap:11px;flex:1;min-width:0}
  .deal-header-right{display:flex;align-items:center;gap:16px}
  .status-pill{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;padding:3px 9px;border-radius:20px;white-space:nowrap}
  .status-pill.signed{background:var(--warn-soft);color:var(--warn)}
  .status-pill.live{background:var(--good-soft);color:var(--good)}
  .deal-name-in{border:none;border-bottom:1.5px solid transparent;font-family:'Space Grotesk';font-weight:600;font-size:17px;padding:3px 0;outline:none;background:transparent;color:var(--ink);width:100%;min-width:0}
  .deal-name-in:focus{border-bottom-color:var(--accent)}
  .deal-forecast{display:flex;flex-direction:column;align-items:flex-end;gap:1px}
  .deal-forecast-val{font-size:19px;font-weight:600}
  .deal-controls{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
  /* path to goal */
  .pathgoal{background:#F7F9FC;border:1px solid var(--line);border-radius:14px;padding:20px 22px}
  .pathgoal h2{margin-bottom:6px}
  .pathgoal.ongoal{background:var(--good-soft);border-color:#C7E4D6}
  .pg-clear{font-size:14px;color:var(--good);font-weight:500;margin-top:4px}
  .pg-headline{display:flex;flex-direction:column;gap:3px;margin:6px 0 16px;padding:14px 16px;background:#fff;border:1px solid var(--line);border-radius:11px}
  .pg-headline-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
  .pg-headline-val{font-size:30px;font-weight:600;color:var(--accent);display:flex;align-items:baseline;gap:8px}
  .pg-unit{font-size:13px;color:var(--muted);font-weight:600;letter-spacing:.04em}
  .pg-rows{display:flex;flex-direction:column;gap:8px}
  .pg-row{display:flex;justify-content:space-between;align-items:center;gap:14px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 15px}
  .pg-row.asap{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}
  .pg-row.late{opacity:.65}
  .pg-when{display:flex;flex-direction:column;gap:2px}
  .pg-when-lead{font-weight:600;font-family:'Space Grotesk';font-size:14px}
  .pg-when-sub{font-size:11.5px;color:var(--muted)}
  .pg-need{font-size:17px;font-weight:600;color:var(--ink);display:flex;align-items:baseline;gap:6px}
  .pg-toolate{font-size:12.5px;color:var(--muted);font-weight:500}

  /* carrying-in single total */
  .carry-total{display:flex;align-items:flex-end;gap:24px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;flex-wrap:wrap}
  .carry-total-field{display:flex;flex-direction:column;gap:6px;flex:1;min-width:260px}
  .dollar.big{border-radius:9px}
  .dollar.big i{padding:0 11px;font-size:14px}
  .dollar.big input{border:none;outline:none;padding:11px 12px;width:100%;font-family:'JetBrains Mono';font-size:17px;font-weight:600;color:var(--ink);background:transparent}
  .carry-total-readout{display:flex;flex-direction:column;gap:3px;text-align:right;padding-bottom:6px}
  .carry-total-val{font-size:20px;font-weight:600}

  .team-foot{display:flex;align-items:center;gap:14px;margin-top:16px;flex-wrap:wrap}
  .team-foot-note{font-size:11.5px;color:var(--muted)}

  .kpi-row.five{grid-template-columns:repeat(5,1fr)}
  @media(max-width:1000px){ .kpi-row.five{grid-template-columns:repeat(2,1fr)} }
  .contrib.warn{color:var(--warn)}

  .nowlive-btn{display:inline-flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:7px 13px;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer;font-family:'Inter'}
  .nowlive-btn:hover{border-color:var(--good);color:var(--good)}
  .nowlive-btn.on{border-color:#C7E4D6;background:var(--good-soft);color:var(--good)}
  .nowlive-box{width:17px;height:17px;border-radius:5px;border:1.5px solid var(--muted);display:grid;place-items:center;font-size:11px;line-height:1}
  .nowlive-btn:hover .nowlive-box{border-color:var(--good)}
  .nowlive-box.checked{background:var(--good);border-color:var(--good);color:#fff}

  .pg-gpv{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:6px 0 16px}
  .pg-gpv-item{display:flex;flex-direction:column;gap:3px;background:#fff;border:1px solid var(--line);border-radius:11px;padding:14px 16px}
  .pg-gpv-item.good{background:var(--good-soft);border-color:#C7E4D6}
  .pg-gpv-item.warn{background:var(--warn-soft);border-color:#EEDBBB}
  .pg-gpv-val{font-size:22px;font-weight:600}
  .pg-gpv-item.good .pg-gpv-val{color:var(--good)} .pg-gpv-item.warn .pg-gpv-val{color:var(--warn)}
  .pg-gpv-note{font-size:11px;color:var(--muted)}
  .pg-sub-head{font-size:12.5px;font-weight:600;color:var(--ink);margin:6px 0 10px}
  @media(max-width:1000px){ .pg-gpv{grid-template-columns:1fr} }

  .pg-prospects{margin:4px 0 14px;padding:14px 16px;background:#fff;border:1px solid var(--line);border-radius:12px}
  .pg-prospects-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:10px}
  .pg-prospects-empty{font-size:12.5px;color:var(--muted);padding:6px 0}
  .prospect-row{display:grid;grid-template-columns:1fr auto auto auto auto auto;gap:12px;align-items:end;padding:10px 0;border-top:1px solid var(--line2)}
  .prospect-added{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--good);font-weight:600;min-width:120px;justify-content:flex-end}
  .prospect-added .tick{display:inline-grid;place-items:center;width:17px;height:17px;border-radius:50%;background:var(--good);color:#fff;font-size:11px}
  .prospect-added .muted{color:var(--muted);font-weight:500}
  .prospect-date{border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-family:'JetBrains Mono';font-size:12px;background:#FBFCFD;color:var(--ink)}
  .pg-prospect-totals{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:12px;padding-top:12px;border-top:1.5px solid var(--line);font-size:13.5px;flex-wrap:wrap}
  .pg-prospect-totals .strong{font-weight:600}

  .month-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:6px 0 4px}
  .month-cell{background:#fff;border:1px solid var(--line);border-radius:11px;padding:13px 14px}
  .month-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
  .month-name{font-size:12px;font-weight:600;font-family:'Space Grotesk';color:var(--ink)}
  .month-gpv{font-size:15px;font-weight:600}
  .month-bar{position:relative;height:12px;background:#EDF0F3;border-radius:5px;overflow:hidden}
  .month-fill{position:absolute;top:0;bottom:0;left:0;background:var(--warn);transition:width .25s}
  .month-fill.live{background:var(--good)}
  .month-fill.signed{background:var(--warn)}
  .month-fill.prospect{background:repeating-linear-gradient(45deg,#E9B865,#E9B865 4px,#F6DDAE 4px,#F6DDAE 8px)}
  .month-goal{position:absolute;top:-2px;bottom:-2px;left:calc(100% - 2px);width:2px;background:var(--ink)}
  .month-note{font-size:11px;color:var(--muted);margin-top:6px}
  .pg-fineprint{font-size:11px;color:var(--muted);margin:8px 0 14px}
  @media(max-width:1000px){ .month-strip{grid-template-columns:1fr} }

  .pg-legend-inline{font-size:11px;font-weight:500;color:var(--muted)}
  .pg-legend-inline .sw{width:10px;height:10px;border-radius:3px;display:inline-block;vertical-align:-1px;margin-right:3px}
  .pg-gpvneed{background:#fff;border:1px solid var(--line);border-radius:11px;padding:13px 15px;margin:2px 0 16px}
  .pg-gpvneed-label{font-size:12px;font-weight:600;color:var(--ink)}
  .pg-gpvneed-row{display:flex;flex-wrap:wrap;gap:10px;margin:9px 0}
  .pg-gpvneed-item{display:flex;flex-direction:column;gap:2px;background:#F7F9FC;border:1px solid var(--line);border-radius:8px;padding:7px 12px;min-width:96px}
  .pg-gpvneed-item.now{border-color:var(--accent);background:var(--accent-soft)}
  .pg-gpvneed-when{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .pg-gpvneed-val{font-size:15px;font-weight:600}
  .pg-gpvneed-note{font-size:11px;color:var(--muted)}

  .team-golive{margin-top:26px;padding-top:22px;border-top:1px solid var(--line)}
  .tg-head{margin-bottom:14px}
  .month-strip.team{margin-bottom:18px}
  .tg-movers{background:#F7F9FC;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .mover-row{display:grid;grid-template-columns:1fr auto auto auto;gap:14px;align-items:center;padding:9px 0;border-top:1px solid var(--line2)}
  .mover-row:first-of-type{border-top:none}
  .mover-name{font-weight:600;font-family:'Space Grotesk';font-size:14px}
  .mover-rep{font-weight:500;font-size:12px;color:var(--muted);font-family:'Inter'}
  .mover-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 8px;border-radius:20px}
  .mover-tag.signed{background:var(--warn-soft);color:var(--warn)}
  .mover-tag.prospect{background:var(--accent-soft);color:var(--accent)}
  .mover-date{font-family:'JetBrains Mono';font-size:12px;color:var(--muted)}
  .mover-gpv{font-size:15px;font-weight:600;text-align:right;min-width:90px}

  .ro-banner{background:#FBF1DF;border-bottom:1px solid #EEDBBB;color:#7A5410;font-size:13px;padding:10px 26px;text-align:center}
  .qc-dot.ro{background:var(--warn)}
  .qc-robadge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:var(--warn-soft);color:var(--warn);border-radius:20px;padding:1px 7px}
  .qc-section-label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:2px 0 7px}
  .qc-list{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
  .qc-qrow{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#F7F8FA;border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-size:13px;font-weight:600;font-family:'Space Grotesk';color:var(--ink);cursor:pointer}
  .qc-qrow.on{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
  .qc-qrow-meta{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-family:'Inter'}
  .qc-qrow-meta.current{color:var(--good)}
  .qc-close-btn{width:100%;margin-top:12px;background:var(--ink);color:#fff;border:none;border-radius:9px;padding:10px;font-weight:600;font-size:12.5px;cursor:pointer;font-family:'Inter'}
  .qc-close-btn:hover{background:#000}

  .activated-group{margin-top:6px;border-top:1px dashed var(--line);padding-top:10px}
  .activated-toggle{background:none;border:none;color:var(--good);font-weight:600;font-size:12.5px;cursor:pointer;font-family:'Inter';padding:4px 0}
  .activated-row{display:grid;grid-template-columns:1fr auto auto auto;gap:12px;align-items:center;padding:8px 0;border-top:1px solid var(--line2);font-size:13px}
  .activated-name{font-weight:600;font-family:'Space Grotesk'}
  .activated-meta{font-family:'JetBrains Mono';font-size:12px;color:var(--muted)}
  .activated-gpv{font-weight:600;color:var(--good)}
  .promote-btn{background:var(--good-soft);border:1px solid #C7E4D6;color:var(--good);border-radius:8px;padding:7px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter';white-space:nowrap}
  .promote-btn:hover{background:var(--good);color:#fff}

  .sw.live{background:var(--good)} .sw.signed{background:var(--warn)}
  .sw.prospect{background:repeating-linear-gradient(45deg,#E9B865,#E9B865 3px,#F6DDAE 3px,#F6DDAE 6px)}
  .month-note .muted{color:var(--muted)}

  .overdue-badge{background:#FBECEA;border:1px solid #E7C3BE;color:var(--danger);border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;margin-bottom:14px}
  .month-fill.overdue{background:var(--danger)}
  .month-note .danger{color:var(--danger);font-weight:600}
  .month-overdue-flag{position:absolute;top:-7px;right:-6px;width:16px;height:16px;border-radius:50%;background:var(--danger);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;line-height:1}
  .aw{margin-top:22px}
  .aw-head{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px}
  .aw-tabs{display:flex;background:#EEF0F3;border-radius:9px;padding:2px}
  .aw-tab{border:none;background:transparent;padding:7px 13px;border-radius:7px;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer;font-family:'Inter'}
  .aw-tab.on{background:#fff;color:var(--accent);box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .aw-row{display:grid;grid-template-columns:1fr auto auto auto;gap:14px;align-items:center;padding:10px 14px;border:1px solid var(--line);border-radius:10px;margin-bottom:7px;background:#fff}
  .aw-row.overdue{border-color:#E7C3BE;background:#FCF3F1}
  .aw-name{font-weight:600;font-family:'Space Grotesk';font-size:14px}
  .aw-kind{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:20px;margin-left:6px}
  .aw-kind.signed{background:var(--warn-soft);color:var(--warn)} .aw-kind.prospect{background:var(--accent-soft);color:var(--accent)}
  .aw-rep{font-size:12.5px;color:var(--muted);font-weight:600}
  .aw-date{font-family:'JetBrains Mono';font-size:12.5px;color:var(--ink)}
  .aw-row.overdue .aw-date{color:var(--danger);font-weight:600}
  .aw-gpv{font-weight:600;font-size:14px;text-align:right;min-width:90px}
  .aw-total{font-size:12.5px;color:var(--muted);margin-top:8px;font-weight:600}
  .aw-empty{font-size:13px;color:var(--muted);padding:12px 0}
  .aw-overdue{margin-bottom:12px}
  .aw-overdue-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--danger);font-weight:700;margin-bottom:7px}

  .deal.isoverdue{border-left:4px solid var(--danger);border-color:#E7C3BE;background:#FCF5F4}
  .deal-overdue{background:#FBECEA;border:1px solid #E7C3BE;color:var(--danger);border-radius:9px;padding:9px 12px;font-size:12.5px;font-weight:600;margin-bottom:12px}
  .status-pill.overdue{background:#FBECEA;color:var(--danger)}
  .danger-label{color:var(--danger)}
  input.date-overdue{border-color:var(--danger) !important;background:#FCF5F4}

  .gap-card{display:flex;justify-content:space-between;align-items:center;gap:18px;background:var(--warn-soft);border:1px solid #EEDBBB;border-radius:13px;padding:16px 20px;margin-bottom:18px;flex-wrap:wrap}
  .gap-card.covered{background:var(--good-soft);border-color:#C7E4D6}
  .gap-main{display:flex;flex-direction:column;gap:2px}
  .gap-label{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
  .gap-val{font-size:30px;font-weight:600}
  .gap-val.warn{color:var(--warn)} .gap-val.good{color:var(--good)}
  .gap-unit{font-size:13px;color:var(--muted);font-weight:600;margin-left:7px}
  .gap-breakdown{font-size:13px;color:var(--ink);text-align:right;max-width:360px;line-height:1.5}
  .sw.atrisk{background:var(--danger)}

  .gapbar-card{background:#fff;border:1px solid var(--line);border-radius:13px;padding:16px 20px;margin-bottom:18px}
  .gapbar-card.covered{background:var(--good-soft);border-color:#C7E4D6}
  .gapbar-top{display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:11px;flex-wrap:wrap}
  .gapbar-track{height:15px;background:#EDF0F3;border-radius:6px;overflow:hidden;position:relative}
  .gapbar-prospect{position:absolute;left:0;top:0;bottom:0;background:repeating-linear-gradient(45deg,#E4A94D,#E4A94D 5px,#F4D69B 5px,#F4D69B 10px);transition:width .25s}
  .gapbar-legend{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;font-size:12.5px;margin-top:9px;color:var(--ink)}
  .gapbar-legend .muted{color:var(--muted)}
  .hatch-swatch{display:inline-block;width:11px;height:11px;border-radius:3px;background:repeating-linear-gradient(45deg,#E4A94D,#E4A94D 3px,#F4D69B 3px,#F4D69B 6px);vertical-align:-1px;margin-right:5px}
  .gapbar-dates{font-size:11.5px;color:var(--muted);margin-top:11px;padding-top:10px;border-top:1px solid var(--line2)}

  .prospect-item{border-top:1px solid var(--line2)}
  .prospect-item .prospect-row{border-top:none}
  .prospect-notes{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 0 12px}
  .note-field{display:flex;flex-direction:column;gap:4px}
  .note-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
  .note-field input{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;font-family:'Inter';background:#FBFCFD;color:var(--ink)}
  .note-field.mgr input{background:var(--accent-soft);border-color:#CBD9EA}
  @media(max-width:800px){ .prospect-notes{grid-template-columns:1fr} }

  .month-cell.clickable{cursor:pointer;transition:border-color .15s,box-shadow .15s}
  .month-cell.clickable:hover{border-color:var(--accent)}
  .month-cell.selected{border-color:var(--accent);box-shadow:0 0 0 1.5px var(--accent)}
  .month-caret{color:var(--muted);font-size:11px}
  .month-pct{font-size:11px;font-weight:500;color:var(--muted)}
  .month-detail{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0 4px}
  .md-head{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:14px;margin-bottom:10px;flex-wrap:wrap}
  .md-close{background:none;border:1px solid var(--line);border-radius:7px;padding:5px 10px;font-size:12px;color:var(--muted);cursor:pointer;font-family:'Inter'}
  .md-empty{font-size:13px;color:var(--muted);padding:8px 0}
  .md-group{margin-top:10px}
  .md-group-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:5px}
  .md-group-label.good{color:var(--good)} .md-group-label.warn{color:var(--warn)} .md-group-label.muted{color:var(--muted)} .md-group-label.danger{color:var(--danger)}
  .md-row{display:grid;grid-template-columns:1fr auto auto auto;gap:12px;align-items:center;padding:7px 0;border-top:1px solid var(--line2);font-size:13px}
  .md-row.rep{grid-template-columns:1fr auto auto}
  .md-name{font-weight:600;font-family:'Space Grotesk'}
  .md-rep{font-size:12px;color:var(--muted);font-weight:600}
  .md-date{font-family:'JetBrains Mono';font-size:12px;color:var(--ink)}
  .md-gpv{font-weight:600;text-align:right;min-width:84px}
  .leaderboard{margin-top:26px;padding-top:22px;border-top:1px solid var(--line)}
  .leaderboard h2{font-size:15px;margin-bottom:14px}
  .lb-row{display:grid;grid-template-columns:26px 1fr 2fr auto;gap:14px;align-items:center;padding:9px 0;border-top:1px solid var(--line2);cursor:pointer}
  .lb-row:hover{background:#F7F9FC}
  .lb-rank{font-family:'JetBrains Mono';font-size:13px;color:var(--muted);text-align:center;font-weight:600}
  .lb-name{font-weight:600;font-family:'Space Grotesk';font-size:14px}
  .lb-full{color:var(--muted);font-weight:500;font-size:12.5px}
  .lb-track{height:9px;background:#EDF0F3;border-radius:5px;overflow:hidden}
  .lb-fill{display:block;height:100%;background:var(--warn);border-radius:5px}
  .lb-fill.good{background:var(--good)}
  .lb-pct{font-size:14px;font-weight:600;text-align:right;min-width:52px}
  .lb-pct.good{color:var(--good)} .lb-pct.low{color:var(--danger)}

  .usdate{position:relative;display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;background:#FBFCFD;padding-right:4px}
  .usdate-text{border:none;background:transparent;padding:8px 4px 8px 10px;font-family:'JetBrains Mono';font-size:12px;color:var(--ink);width:96px;outline:none}
  .usdate-cal{border:none;background:none;cursor:pointer;color:var(--muted);display:grid;place-items:center;padding:3px;border-radius:6px}
  .usdate-cal:hover{color:var(--accent);background:var(--accent-soft)}
  .usdate-native{position:absolute;right:6px;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;border:none;padding:0}
  .usdate.date-overdue{border-color:var(--danger);background:#FCF5F4}

  .nextq{margin-top:14px}
  .nextq-toggle{background:none;border:1px solid var(--line);border-radius:9px;padding:11px 15px;font-weight:600;font-size:13.5px;color:var(--ink);cursor:pointer;font-family:'Space Grotesk';width:100%;text-align:left}
  .nextq-toggle:hover{border-color:var(--accent);color:var(--accent)}
  .team-nextq{margin-top:22px}
  .nextq-body{border:1px solid var(--line);border-top:none;border-radius:0 0 12px 12px;padding:16px 18px;margin-top:-4px}
  .nextq-goal,.nextq-manual{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px;font-weight:600;padding:10px 0;border-bottom:1px solid var(--line2);flex-wrap:wrap}
  .nextq-rows{margin:12px 0}
  .nextq-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:9px 0;border-bottom:1px solid var(--line2);font-size:13.5px}
  .nextq-row.total{border-bottom:none;border-top:1.5px solid var(--line);margin-top:2px;font-weight:600}
  .nextq-lbl{display:flex;flex-direction:column;gap:1px}
  .nextq-lbl .sw{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:7px;vertical-align:-1px}
  .nextq-lbl em{font-style:normal;font-size:11px;color:var(--muted);font-weight:500}
  .nextq-att{font-size:14px;margin:8px 0 4px}
  .nextq-gpv{font-size:13px;color:var(--ink);margin-top:12px;padding-top:12px;border-top:1px solid var(--line2)}
  .nextq-gpv.good{color:var(--good)}
  `}</style>);
}
