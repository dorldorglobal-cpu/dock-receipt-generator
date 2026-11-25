import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Every car that hasn't sailed, grouped by location (warehouse / port terminal) → customer.
const STAGES = ["Not picked up", "On the way", "At location", "Problem / Hold"];
const STAGE_COLOR = {
  "Not picked up": "#b45309", "On the way": "#2563eb", "At location": "#16a34a", "Problem / Hold": "#dc2626",
};
const stageLabel = (r) => r.stage === "At location"
  ? (r.status === "Waiting to Sail" ? "At port — waiting to sail" : "In warehouse")
  : r.stage;

export default function Inventory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [loc, setLoc] = useState("");
  const [cust, setCust] = useState("");
  const [stage, setStage] = useState("");
  const [open, setOpen] = useState({});      // "loc|customer" → expanded
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch(`${API}/api/orders/inventory`).then(r => r.json())
      .then(d => { if (Array.isArray(d)) setRows(d); else setErr(d.error || "Couldn't load"); })
      .catch(e => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  const locations = useMemo(() => [...new Set(rows.map(r => r.location))].sort(), [rows]);
  const shown = useMemo(() => rows.filter(r =>
    (!loc || r.location === loc) &&
    (!stage || r.stage === stage) &&
    (!cust || r.customer.toLowerCase().includes(cust.toLowerCase()))), [rows, loc, cust, stage]);

  // location → customer → cars
  const groups = useMemo(() => {
    const g = {};
    for (const r of shown) ((g[r.location] ||= {})[r.customer] ||= []).push(r);
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b)).map(([l, byCust]) => ({
      location: l,
      customers: Object.entries(byCust).sort(([a], [b]) => a.localeCompare(b)).map(([c, cars]) => ({
        customer: c,
        cars: cars.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || String(a.refNumber).localeCompare(String(b.refNumber))),
      })),
    }));
  }, [shown]);

  const counts = (cars) => STAGES.map(s => [s, cars.filter(c => c.stage === s).length]).filter(([, n]) => n);

  const copyFor = async (location, customer, cars) => {
    const lines = [
      `${customer} — ${location}`,
      `${cars.length} vehicle${cars.length === 1 ? "" : "s"} not yet sailed (as of ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}):`,
      "",
      ...STAGES.flatMap(s => {
        const list = cars.filter(c => c.stage === s);
        if (!list.length) return [];
        const head = s === "At location" ? (location.includes("–") || /SALLAUM|ACL/.test(location) ? "AT PORT" : "IN WAREHOUSE") : s.toUpperCase();
        return [`${head} (${list.length})`, ...list.map(c =>
          `  #${c.refNumber}  ${c.vehicle}  VIN ${c.vin.slice(-6)}  ${c.title ? `· ${c.title}` : ""}${c.load ? ` · Load ${c.load.name}` : ""}${c.booking ? ` · Booking ${c.booking}` : ""}`.replace(/\s+$/, "")), ""];
      }),
    ];
    try { await navigator.clipboard.writeText(lines.join("\n").trim()); setCopied(`${location}|${customer}`); setTimeout(() => setCopied(""), 2000); }
    catch { window.prompt("Copy this:", lines.join("\n")); }
  };

  const th = { padding: "6px 8px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const td = { padding: "6px 8px", fontSize: 13, borderBottom: "1px solid var(--border-muted, var(--border))", verticalAlign: "top" };
  const input = { background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--text-primary)" };

  return (
    <div style={{ padding: 24, maxWidth: 1300, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 4px" }}>📦 Inventory</h1>
      <p style={{ margin: "0 0 16px", color: "var(--text-secondary)", fontSize: 13 }}>
        Every vehicle that hasn't sailed yet, by location and customer. Click a customer to see the cars; <b>Copy</b> gives a list you can paste to the customer.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <select value={loc} onChange={e => setLoc(e.target.value)} style={{ ...input, minWidth: 240 }}>
          <option value="">All locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <input value={cust} onChange={e => setCust(e.target.value)} placeholder="Customer…" style={{ ...input, minWidth: 220 }} />
        <select value={stage} onChange={e => setStage(e.target.value)} style={input}>
          <option value="">All stages</option>
          {STAGES.map(s => <option key={s} value={s}>{s === "At location" ? "In warehouse / at port" : s}</option>)}
        </select>
        <span style={{ alignSelf: "center", fontSize: 13, color: "var(--text-secondary)" }}>{shown.length} vehicle(s)</span>
      </div>

      {loading && <div>Loading…</div>}
      {err && <div style={{ color: "#dc2626" }}>❌ {err}</div>}

      {groups.map(g => {
        const all = g.customers.flatMap(c => c.cars);
        return (
          <section key={g.location} style={{ marginBottom: 18, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--bg-panel)" }}>
            <div style={{ padding: "10px 14px", background: "var(--bg-elevated)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 15 }}>{g.location}</strong>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{all.length} vehicle(s) · {g.customers.length} customer(s)</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {counts(all).map(([s, n]) => <span key={s} style={{ fontSize: 11, fontWeight: 600, color: STAGE_COLOR[s] }}>{n} {s === "At location" ? "here" : s.toLowerCase()}</span>)}
              </span>
            </div>
            {g.customers.map(c => {
              const key = `${g.location}|${c.customer}`;
              const isOpen = !!open[key];
              return (
                <div key={key} style={{ borderTop: "1px solid var(--border)" }}>
                  <div onClick={() => setOpen(o => ({ ...o, [key]: !o[key] }))}
                    style={{ padding: "8px 14px", display: "flex", gap: 12, alignItems: "center", cursor: "pointer", flexWrap: "wrap" }}>
                    <span style={{ width: 14, color: "var(--text-muted)" }}>{isOpen ? "▾" : "▸"}</span>
                    <strong style={{ minWidth: 220 }}>{c.customer}</strong>
                    <span style={{ fontSize: 13 }}>{c.cars.length} car(s)</span>
                    <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {counts(c.cars).map(([s, n]) => (
                        <span key={s} style={{ fontSize: 12, fontWeight: 600, color: STAGE_COLOR[s] }}>
                          {n} {s === "At location" ? (c.cars.some(x => x.status === "Waiting to Sail") ? "at port" : "in warehouse") : s.toLowerCase()}
                        </span>
                      ))}
                      {c.cars.some(x => x.load) && <span style={{ fontSize: 12, color: "#7c3aed", fontWeight: 600 }}>{c.cars.filter(x => x.load).length} on a load</span>}
                    </span>
                    <button onClick={e => { e.stopPropagation(); copyFor(g.location, c.customer, c.cars); }}
                      style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "pointer", color: "var(--text-primary)" }}>
                      {copied === key ? "✓ Copied" : "📋 Copy for customer"}
                    </button>
                  </div>
                  {isOpen && (
                    <div style={{ overflowX: "auto", padding: "0 14px 10px 40px" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead><tr>{["Order", "Vehicle", "VIN", "Where it is", "Title", "Container load / booking", "Going to"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {c.cars.map(r => (
                            <tr key={r._id}>
                              <td style={td}><Link to={`/orders/${r._id}`}>#{r.refNumber}</Link></td>
                              <td style={td}>{r.vehicle || "—"}{r.fuel && /hybrid|electric/i.test(r.fuel) ? <span style={{ marginLeft: 6, fontSize: 11, color: "#b45309" }}>🔋 {r.fuel}</span> : null}</td>
                              <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.vin || "—"}</td>
                              <td style={{ ...td, color: STAGE_COLOR[r.stage] || "inherit", fontWeight: 600 }}>{stageLabel(r)}<div style={{ fontWeight: 400, fontSize: 11, color: "var(--text-muted)" }}>{r.status}</div></td>
                              <td style={{ ...td, color: /no title/i.test(r.title) ? "#dc2626" : "inherit" }}>{r.title || "—"}</td>
                              <td style={td}>{r.load ? <span style={{ color: "#7c3aed", fontWeight: 600 }}>{r.load.name}</span> : (r.booking || <span style={{ color: "var(--text-muted)" }}>—</span>)}</td>
                              <td style={td}>{r.pod || "—"}{r.line ? <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.line} · {r.type}</div> : null}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {!loading && !err && !groups.length && <div style={{ color: "var(--text-muted)" }}>Nothing matches.</div>}
    </div>
  );
}
