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
  const isLive = d.stage === "live";
  const weighted = quotaCredit * (num(d.confidence) / 100);
  return { effRate, totalAnnual, monthly, mr, quotaCredit, isLive, weighted, contribution: isLive ? quotaCredit : weighted };
}
function repTotals(rep, q) {
  const carried = num(rep.carryTotal);
  const loans = (rep.loans || []).reduce((s, l) => s + num(l.feeAmount) * LOAN_SHARE, 0);
  let live = 0, pipeline = 0;
  (rep.deals || []).forEach((d) => { const c = calcDeal(d, q); if (c.isLive) live += c.contribution; else pipeline += c.contribution; });
  const banked = carried + loans + live, total = banked + pipeline, quota = num(rep.quota);
  return { carried, loans, live, pipeline, banked, total, quota,
    attainment: quota ? total / quota : 0, bankedAtt: quota ? banked / quota : 0, gap: quota - total };
}

function currentQuarter() {
  const now = new Date(), y = now.getFullYear(), qi = Math.floor(now.getMonth() / 3);
  const s = new Date(y, qi * 3, 1), e = new Date(y, qi * 3 + 3, 0), iso = (d) => d.toISOString().slice(0, 10);
  return { label: `Q${qi + 1} ${y}`, start: iso(s), end: iso(e) };
}
const mkRep = (code, name, quota) => ({ id: uid(), code, name, team: "Field", quota, carryTotal: "", deals: [], loans: [] });
function seedData() {
  return { quarter: currentQuarter(), reps: [
    mkRep("084093", "Whitaker, Della", 62000), mkRep("085168", "Agadzhanyan, David", 62000),
    mkRep("085422", "Wadhams, Ryan", 66000), mkRep("088515", "Woods, Tacen", 33000),
    mkRep("089562", "Wichman, Zachariah", 16500), mkRep("089968", "Heathcott, Aubrey", 16500),
    mkRep("090964", "Lemus, Wilmer", 5166.67), mkRep("090987", "Millet, Joey", 5166.67),
  ] };
}
const blankDeal = (q) => ({ id: uid(), name: "", stage: "signed", model: "flat",
  gpv: "", avgTxn: "", flatRatePct: "", flatFixedFee: "", costToSquare: "", costMargin: "",
  saasPerMonth: "", numLocations: "", monthsActive: 12, goLive: q.start, confidence: 75 });

/* ========================================================================= */
export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("master");
  const [status, setStatus] = useState("Loading…");

  const dirty = useRef(false);
  const lastSaved = useRef("");

  const load = useCallback(async (initial) => {
    try {
      const res = await fetch("/api/data");
      const j = await res.json();
      if (j && j.value) {
        lastSaved.current = j.value;
        if (!dirty.current) { setData(JSON.parse(j.value)); if (initial) setStatus("Saved"); }
        return true;
      }
    } catch (e) {}
    return false;
  }, []);

  useEffect(() => { (async () => {
    const ok = await load(true);
    if (!ok) { setData(seedData()); setStatus("Ready"); }
  })(); }, [load]);

  const save = useCallback(async (next) => {
    setStatus("Saving…");
    try {
      const body = JSON.stringify(next);
      const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: body }) });
      if (!res.ok) throw new Error("save failed");
      lastSaved.current = body; dirty.current = false; setStatus("Saved");
    } catch (e) { setStatus("Save failed — retrying…"); }
  }, []);

  useEffect(() => {
    if (!data) return;
    dirty.current = JSON.stringify(data) !== lastSaved.current;
    const t = setTimeout(() => { if (dirty.current) save(data); }, 700);
    return () => clearTimeout(t);
  }, [data, save]);

  useEffect(() => {
    const id = setInterval(() => {
      const el = document.activeElement;
      const editing = el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if (!dirty.current && !editing) load(false);
    }, 20000);
    return () => clearInterval(id);
  }, [load]);

  const update = (fn) => setData((p) => { const n = JSON.parse(JSON.stringify(p)); fn(n); return n; });
  const q = data?.quarter, reps = data?.reps ?? [];
  const activeRep = reps.find((r) => r.id === tab);

  const team = useMemo(() => {
    if (!data) return null;
    const rows = reps.map((r) => ({ rep: r, t: repTotals(r, q) }));
    const sum = (k) => rows.reduce((s, x) => s + x.t[k], 0);
    const quota = sum("quota"), banked = sum("banked"), pipeline = sum("pipeline"), total = banked + pipeline;
    return { rows, quota, banked, pipeline, total, attainment: quota ? total / quota : 0, gap: quota - total };
  }, [data]);

  const exportCsv = () => {
    let out = "Code,Rep,Q3 goal,Banked,Pipeline,Total forecast,Attainment,Gap\n";
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
        <QuarterControl q={q} onChange={(nq) => update((d) => (d.quarter = nq))} />
        <div className="tb-right"><button className="ghost" onClick={exportCsv}>Export CSV</button><span className="save-pill">{status}</span></div>
      </div>

      {/* tabs */}
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
        <button className="tab add" onClick={() => { const r = mkRep("", "New rep", 0); update((d) => d.reps.push(r)); setTab(r.id); }}>+</button>
      </div>

      <div className="body">
        {tab === "master" || !activeRep ? (
          <TeamView team={team} onPick={setTab} onReset={() => {
            const ans = prompt("This wipes ALL data for the whole team back to the starting roster at $0 — it cannot be undone.\n\nType RESET to confirm.");
            if (ans && ans.trim().toUpperCase() === "RESET") { setData(seedData()); setTab("master"); }
          }} />
        ) : (
          <RepView rep={activeRep} q={q}
            up={(fn) => update((d) => fn(d.reps.find((r) => r.id === activeRep.id)))}
            onDelRep={() => { if (confirm(`Remove ${activeRep.name}?`)) { update((d) => (d.reps = d.reps.filter((r) => r.id !== activeRep.id))); setTab("master"); } }} />
        )}
      </div>
      <div className="foot-note">One shared team sheet — everyone with this link edits the same data. Reps work their own tab; you see all of it in Master.</div>
    </div>
  );
}

/* ---------- bar ---------- */
function Bar({ banked, pipeline, scenario = 0, quota, slim }) {
  const q = quota || 1;
  const b = Math.min((banked / q) * 100, 100);
  const p = Math.min((pipeline / q) * 100, Math.max(0, 100 - b));
  const s = Math.min((scenario / q) * 100, Math.max(0, 100 - b - p));
  return (
    <div className={`bar ${slim ? "slim" : ""}`}>
      <div className="bar-track">
        <div className="seg banked" style={{ width: `${b}%` }} />
        <div className="seg pipeline" style={{ left: `${b}%`, width: `${p}%` }} />
        {scenario > 0 && <div className="seg scenario" style={{ left: `${b + p}%`, width: `${s}%` }} />}
        <div className="goal" />
      </div>
    </div>
  );
}

/* ---------- quarter ---------- */
function QuarterControl({ q, onChange }) {
  const [open, setOpen] = useState(false);
  const year = new Date(q.start + "T00:00:00").getFullYear() || new Date().getFullYear();
  const presets = [["Q1", `${year}-01-01`, `${year}-03-31`], ["Q2", `${year}-04-01`, `${year}-06-30`],
    ["Q3", `${year}-07-01`, `${year}-09-30`], ["Q4", `${year}-10-01`, `${year}-12-31`],
    ["H1", `${year}-01-01`, `${year}-06-30`], ["H2", `${year}-07-01`, `${year}-12-31`]];
  return (
    <div className="qc">
      <button className="qc-btn" onClick={() => setOpen((o) => !o)}>
        <span className="qc-dot" /> {q.label}<span className="qc-range">{q.start} → {q.end}</span><span className="qc-caret">▾</span>
      </button>
      {open && (
        <div className="qc-pop" onMouseLeave={() => setOpen(false)}>
          <input className="qc-title" value={q.label} onChange={(e) => onChange({ ...q, label: e.target.value })} />
          <div className="qc-dates">
            <label>Start<input type="date" value={q.start} onChange={(e) => onChange({ ...q, start: e.target.value })} /></label>
            <label>End<input type="date" value={q.end} onChange={(e) => onChange({ ...q, end: e.target.value })} /></label>
          </div>
          <div className="qc-presets">{presets.map(([l, s, e]) => (
            <button key={l} className={`chip ${q.start === s && q.end === e ? "on" : ""}`} onClick={() => onChange({ label: `${l} ${year}`, start: s, end: e })}>{l}</button>))}</div>
        </div>
      )}
    </div>
  );
}

/* ---------- master ---------- */
function TeamView({ team, onPick, onReset }) {
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
        {team.rows.map(({ rep, t }) => (
          <div className="row" key={rep.id} onClick={() => onPick(rep.id)}>
            <div className="c-rep"><span className="r-name">{rep.name}</span>{rep.code && <span className="r-code">{rep.code}</span>}</div>
            <div className="c-num mono">{money(t.quota)}</div><div className="c-num mono good">{money(t.banked)}</div>
            <div className="c-num mono warn">{money(t.pipeline)}</div><div className="c-num mono strong">{money(t.total)}</div>
            <div className={`c-num mono ${t.attainment >= 1 ? "good" : ""}`}>{pct(t.attainment, 0)}</div>
            <div className="c-bar"><Bar banked={t.banked} pipeline={t.pipeline} quota={t.quota} /></div>
          </div>
        ))}
        <div className="row total">
          <div className="c-rep">Total</div><div className="c-num mono">{money(team.quota)}</div><div className="c-num mono good">{money(team.banked)}</div>
          <div className="c-num mono warn">{money(team.pipeline)}</div><div className="c-num mono strong">{money(team.total)}</div>
          <div className="c-num mono">{pct(team.attainment, 0)}</div><div className="c-bar"><Bar banked={team.banked} pipeline={team.pipeline} quota={team.quota} /></div>
        </div>
      </div>
      <div className="team-foot">
        <button className="ghost sm danger" onClick={onReset}>Reset all data</button>
        <span className="team-foot-note">Clears every rep's deals, loans &amp; carry-in back to the starting roster at $0. Use to start a fresh quarter.</span>
      </div>
    </div>
  );
}

/* ---------- rep ---------- */
function RepView({ rep, q, up, onDelRep }) {
  const [scenario, setScenario] = useState(null);
  const t = repTotals(rep, q);
  const scnDeal = scenario ? calcDeal(scenario, q).contribution : 0;
  const scnLoan = scenario && scenario.hasLoan ? num(scenario.loanFee) * LOAN_SHARE : 0;
  const scnContribution = scnDeal + scnLoan;
  const projTotal = t.total + scnContribution;
  const projAtt = t.quota ? projTotal / t.quota : 0;

  const addDeal = () => up((r) => r.deals.push(blankDeal(q)));
  const addLoan = () => up((r) => r.loans.push({ id: uid(), name: "", feeAmount: "" }));
  const signScenario = () => {
    up((r) => {
      const { hasLoan, loanFee, ...deal } = scenario;
      const dealReal = num(deal.gpv) > 0 || num(deal.flatRatePct) > 0 || num(deal.costToSquare) > 0;
      if (dealReal) r.deals.push({ ...deal, id: uid(), stage: "signed" });
      if (hasLoan && num(loanFee) > 0) r.loans.push({ id: uid(), name: deal.name || "Loan", feeAmount: loanFee });
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
        <button className={`model-cta ${scenario ? "active" : ""}`} onClick={() => setScenario(scenario ? null : { ...blankDeal(q), name: "Prospect", confidence: 100, hasLoan: false, loanFee: "" })}>
          {scenario ? "Close scratchpad" : "＋ Model a deal"}
        </button>
      </div>

      <div className="kpi-row four">
        <Kpi label="Total forecast" value={money(t.total)} tone="accent" />
        <Kpi label="Attainment" value={pct(t.attainment)} tone={t.attainment >= 1 ? "good" : ""} />
        <Kpi label="Banked now" value={money(t.banked)} tone="good" hint={`${pct(t.bankedAtt, 0)} of goal secured`} />
        <Kpi label={t.gap >= 0 ? "Still to find" : "Over goal by"} value={money(Math.abs(t.gap))} tone={t.gap <= 0 ? "good" : "warn"} />
      </div>

      <div className="herobar">
        <Bar banked={t.banked} pipeline={t.pipeline} scenario={scnContribution} quota={t.quota} />
        <div className="hero-legend">
          <span><i className="sw good" /> Banked {money(t.banked)}</span>
          <span><i className="sw warn" /> Pipeline {money(t.pipeline)}</span>
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
                <label className="inline-field">Loan fee amount<span className="dollar"><i>$</i><input inputMode="decimal" value={scenario.loanFee} placeholder="0" onChange={(e) => setScenario({ ...scenario, loanFee: e.target.value })} /></span></label>
                <div className="loan-credit-readout">You keep {pct(LOAN_SHARE, 0)} → <b className="mono good">{money(scnLoan)}</b> toward goal</div>
              </div>
            )}
          </div>
          <div className="scratch-actions">
            <span className="scratch-hint">Nothing here counts until you sign it. Adjust the terms — and the loan — and watch the number move.</span>
            <div>
              <button className="ghost sm" onClick={() => setScenario(null)}>Discard</button>
              <button className="primary" onClick={signScenario}>{scenario.hasLoan && num(scenario.loanFee) > 0 ? "Sign it — add deal + loan" : "Sign it — add to pipeline"}</button>
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

      <Section title="Signed deals" sub="New wins. Weighted by confidence while pending; flip to Live when it goes live and it banks automatically — no re-entry." onAdd={addDeal} addLabel="+ Add deal">
        {rep.deals.length === 0 && <Empty>No deals yet. Add what you've signed to see where you land.</Empty>}
        {rep.deals.map((d) => (
          <DealCard key={d.id} d={d} q={q}
            onPatch={(p) => up((r) => Object.assign(r.deals.find((x) => x.id === d.id), p))}
            onDel={() => up((r) => (r.deals = r.deals.filter((x) => x.id !== d.id)))} />
        ))}
      </Section>

      <Section title="Loans" sub={`You keep ${pct(LOAN_SHARE, 0)} of each loan fee, straight to your number.`} onAdd={addLoan} addLabel="+ Add loan">
        {rep.loans.length === 0 && <Empty>No loans logged.</Empty>}
        {rep.loans.map((l) => { const credit = num(l.feeAmount) * LOAN_SHARE; return (
          <div className="carry-row" key={l.id}>
            <input className="line-name" placeholder="Loan / client name" value={l.name} onChange={(e) => up((r) => (r.loans.find((x) => x.id === l.id).name = e.target.value))} />
            <label className="inline-field">Loan fee<span className="dollar"><i>$</i><input inputMode="decimal" value={l.feeAmount} onChange={(e) => up((r) => (r.loans.find((x) => x.id === l.id).feeAmount = e.target.value))} /></span></label>
            <div className="contrib good mono">{money(credit)}<span className="contrib-sub">75%</span></div>
            <button className="x" onClick={() => up((r) => (r.loans = r.loans.filter((x) => x.id !== l.id)))}>×</button>
          </div>); })}
      </Section>

      <PathToGoal t={t} q={q} />

      <div className="rep-foot"><button className="ghost sm danger" onClick={onDelRep}>Remove rep</button></div>
    </div>
  );
}

/* ---------- deal card ---------- */
const CATCHUP_RATE = 0.022; // assumed average take rate for the path-to-goal maths
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = (d) => `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function PathToGoal({ t, q }) {
  if (t.quota <= 0) return null;

  if (t.gap <= 0) {
    return (
      <div className="section pathgoal ongoal">
        <h2>Path to goal</h2>
        <div className="pg-clear">On pace — forecast is {pct(t.attainment)} of goal, {money(-t.gap)} over. Keep activating early to bank every day of processing.</div>
      </div>
    );
  }

  const qStart = new Date(q.start + "T00:00:00");
  const qEnd = new Date(q.end + "T00:00:00");
  const today = new Date();
  const start = today < qStart ? qStart : today;

  const dates = [];
  if (start < qEnd) {
    dates.push(new Date(start));
    let d = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    while (d < qEnd) { dates.push(new Date(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  }

  const rows = dates.map((dt, i) => {
    const m = monthsRemaining(isoDate(dt), q.start, q.end);
    const gpv = m > 0.3 ? (t.gap * 12) / (CATCHUP_RATE * m) : null;
    return { dt, m, gpv, asap: i === 0 };
  });
  const headline = rows.length ? rows[0].gpv : null;

  return (
    <div className="section pathgoal">
      <h2>Path to goal</h2>
      <p className="section-sub">
        You're {money(t.gap)} short of your {money(t.quota)} goal ({pct(t.attainment, 0)} there). Revenue builds per day once a deal goes live, so the sooner you activate, the less new business it takes. Figures assume a {pct(CATCHUP_RATE, 1)} average take rate.
      </p>

      {headline != null && (
        <div className="pg-headline">
          <span className="pg-headline-label">Activate now and you're on goal with about</span>
          <span className="pg-headline-val mono">{money(headline)}<span className="pg-unit">GPV</span></span>
        </div>
      )}

      <div className="pg-rows">
        {rows.map((r, i) => (
          <div className={`pg-row ${r.asap ? "asap" : ""} ${r.gpv == null ? "late" : ""}`} key={i}>
            <div className="pg-when">
              <span className="pg-when-lead">{r.asap ? "Get live now" : `Get live by ${fmtDate(r.dt)}`}</span>
              {r.m > 0 && <span className="pg-when-sub">{r.m.toFixed(1)} months of processing left this quarter</span>}
            </div>
            <div className="pg-need mono">
              {r.gpv != null ? <>{money(r.gpv)} <span className="pg-unit">GPV</span></> : <span className="pg-toolate">too late to close the gap this quarter</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DealCard({ d, q, onPatch, onDel }) {
  const c = calcDeal(d, q), isFlat = d.model !== "costplus", live = d.stage === "live";
  return (
    <div className={`deal ${live ? "islive" : "issigned"}`}>
      <div className="deal-header">
        <div className="deal-header-left">
          <span className={`status-pill ${live ? "live" : "signed"}`}>{live ? "Live" : "Signed"}</span>
          <input className="deal-name-in" placeholder="Untitled deal" value={d.name} onChange={(e) => onPatch({ name: e.target.value })} />
        </div>
        <div className="deal-header-right">
          <div className="deal-forecast">
            <span className="mini-label">{live ? "Banked" : "Forecast"}</span>
            <span className={`deal-forecast-val mono ${live ? "good" : "warn"}`}>{money(c.contribution)}</span>
          </div>
          <button className="x" onClick={onDel} aria-label="Delete deal">×</button>
        </div>
      </div>
      <div className="deal-controls">
        <div className="stage-toggle">
          <button className={!live ? "on" : ""} onClick={() => onPatch({ stage: "signed" })}>Signed</button>
          <button className={live ? "on live" : ""} onClick={() => onPatch({ stage: "live" })}>Live</button>
        </div>
        <div className="model-toggle">
          <button className={isFlat ? "on" : ""} onClick={() => onPatch({ model: "flat" })}>Flat/blended</button>
          <button className={!isFlat ? "on" : ""} onClick={() => onPatch({ model: "costplus" })}>Cost-plus</button>
        </div>
      </div>
      <DealFields d={d} isFlat={isFlat} live={live} onPatch={onPatch} />
      <div className="deal-calc">
        <Calc label="Eff. rate" v={pct(c.effRate, 3)} /><Calc label="Monthly" v={money(c.monthly)} />
        <Calc label="Months left" v={c.mr.toFixed(2)} /><Calc label="Quota credit" v={money(c.quotaCredit)} />
      </div>
      {live && <div className="live-note">Live — counts at 100%, banked toward goal.</div>}
    </div>
  );
}

/* shared field grids */
function DealFields({ d, isFlat, live, onPatch }) {
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
      <label className="fld"><span className="mini-label">Go-live date</span><input type="date" value={d.goLive} onChange={(e) => onPatch({ goLive: e.target.value })} /></label>
      <Field label="Confidence" suf="%" v={d.confidence} on={(v) => onPatch({ confidence: v })} disabled={live} />
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
    <button className="primary" onClick={onAdd}>{addLabel}</button></div>{children}</div>);
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
  `}</style>);
}
