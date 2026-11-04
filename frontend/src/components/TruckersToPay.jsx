import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const PAY_METHODS = ["Zelle", "Bank ACH", "Wire", "Check", "Cash", "Other"];

const fmt$ = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
const daysSince = (d) => d ? Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000)) : null;
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * "Truckers to Pay" — every unpaid / partly paid Towing / Transport bill,
 * grouped by trucker, with tick-to-pay. Replaces the hand-written list of
 * units owed to each transporter.
 */
export default function TruckersToPay({ onClose, onPaid }) {
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState("");
  const [picked, setPicked]     = useState({});   // bill _id → true
  const [payDate, setPayDate]   = useState(todayISO());
  const [method, setMethod]     = useState("Zelle");
  const [proof, setProof]       = useState(null);
  const [paying, setPaying]     = useState(false);
  const [msg, setMsg]           = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await (await fetch(`${API}/api/expenses/to-pay`)).json();
      const list = Array.isArray(data) ? data : [];
      setRows(list);
      // Ticks are saved on the bill (set when the dispatch bill is created), so they stick until paid
      setPicked(Object.fromEntries(list.filter(r => r.toPay).map(r => [r._id, true])));
    } catch { setRows([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Group by trucker (case/space-insensitive), longest-waiting trucker first
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const shown = !f ? rows : rows.filter(r =>
      [r.vendor, r.orderRef, r.vin, r.vehicle, r.pickup, r.invoiceNumber].some(v => (v || "").toLowerCase().includes(f)));
    const map = new Map();
    for (const r of shown) {
      const key = r.vendor.toLowerCase().replace(/\s+/g, " ").trim();
      if (!map.has(key)) map.set(key, { vendor: r.vendor, bills: [] });
      map.get(key).bills.push(r);
    }
    return [...map.values()]
      .map(g => ({ ...g, owed: g.bills.reduce((s, b) => s + b.owed, 0), oldest: g.bills[0]?.date }))
      .sort((a, b) => new Date(a.oldest || 0) - new Date(b.oldest || 0));
  }, [rows, filter]);

  const totalOwed  = groups.reduce((s, g) => s + g.owed, 0);
  const unitCount  = groups.reduce((s, g) => s + g.bills.length, 0);
  const pickedRows = rows.filter(r => picked[r._id]);
  const pickedSum  = pickedRows.reduce((s, r) => s + r.owed, 0);
  const pickedVendors = new Set(pickedRows.map(r => r.vendor.toLowerCase().trim()));

  const setTicks = (ids, on) => {
    setPicked(p => { const n = { ...p }; for (const id of ids) n[id] = on; return n; });
    fetch(`${API}/api/expenses/to-pay`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, toPay: on }),
    }).catch(() => setMsg("❌ Couldn't save that tick — refresh and try again"));
  };
  const toggle      = (id) => setTicks([id], !picked[id]);
  const toggleGroup = (g) => setTicks(g.bills.map(b => b._id), !g.bills.every(b => picked[b._id]));

  const paySelected = async () => {
    if (!pickedRows.length) return;
    setPaying(true); setMsg("");
    try {
      const fd = new FormData();
      fd.append("ids", JSON.stringify(pickedRows.map(r => r._id)));
      fd.append("paidDate", payDate);
      fd.append("paymentMethod", method);
      fd.append("action", "pay");
      // Pay what's still owed on each — a partly paid bill only gets its balance
      fd.append("amountOverrides", JSON.stringify(Object.fromEntries(pickedRows.map(r => [r._id, r.owed]))));
      if (proof) fd.append("proof", proof);
      const res = await fetch(`${API}/api/expenses/bulk-pay`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Payment failed");
      setMsg(`✅ Paid ${pickedRows.length} unit${pickedRows.length === 1 ? "" : "s"} — ${fmt$(pickedSum)} by ${method}`);
      setPicked({}); setProof(null);
      await load();
      onPaid?.();
    } catch (e) { setMsg("❌ " + e.message); }
    setPaying(false);
  };

  const printList = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    // Only the ticked units — the printout is the payment run, not the whole list
    // (all ticked units, even ones a search is currently hiding)
    const byVendor = new Map();
    for (const r of pickedRows) {
      const key = r.vendor.toLowerCase().replace(/\s+/g, " ").trim();
      if (!byVendor.has(key)) byVendor.set(key, { vendor: r.vendor, bills: [] });
      byVendor.get(key).bills.push(r);
    }
    const ticked = [...byVendor.values()].map(g => ({ ...g, owed: g.bills.reduce((s, b) => s + b.owed, 0) }));
    const body = ticked.map(g => `
      <h3>${esc(g.vendor)} — ${esc(fmt$(g.owed))} <span>(${g.bills.length} unit${g.bills.length === 1 ? "" : "s"})</span></h3>
      <table><tr><th></th><th>Order</th><th>Vehicle</th><th>VIN</th><th>Pickup</th><th>Billed</th><th>Owed</th></tr>
      ${g.bills.map(b => `<tr><td>☐</td><td>${esc(b.orderRef)}</td><td>${esc(b.vehicle)}</td><td>${esc(b.vin.slice(-6))}</td>
        <td>${esc(b.pickup)}</td><td>${esc(fmtDate(b.date))}</td><td>${esc(fmt$(b.owed))}${b.status === "partial" ? " (bal.)" : ""}</td></tr>`).join("")}
      </table>`).join("");
    const units = ticked.reduce((s, g) => s + g.bills.length, 0);
    const total = ticked.reduce((s, g) => s + g.owed, 0);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Truckers to Pay</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}
      h3{font-size:14px;margin:18px 0 4px}h3 span{font-weight:normal;color:#555}table{border-collapse:collapse;width:100%}
      th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}th{font-size:11px;color:#555}</style></head><body>
      <h1>Truckers to Pay</h1><div>${esc(new Date().toLocaleDateString())} · ${units} unit${units === 1 ? "" : "s"} · ${ticked.length} trucker${ticked.length === 1 ? "" : "s"} · <strong>${esc(fmt$(total))}</strong></div>${body}
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  const inp = { background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text-primary)", fontSize: 13 };
  const th  = { padding: "6px 8px", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap" };
  const td  = { padding: "7px 8px", fontSize: 13, color: "var(--text-primary)", borderTop: "1px solid var(--border-muted)" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 14, width: "100%", maxWidth: 980, maxHeight: "92vh", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>🚚 Truckers to Pay</h2>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {loading ? "Loading…" : `${unitCount} unit${unitCount === 1 ? "" : "s"} · ${groups.length} trucker${groups.length === 1 ? "" : "s"} · `}
              {!loading && <strong style={{ color: "#f87171" }}>{fmt$(totalOwed)} owed</strong>}
            </div>
          </div>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search trucker, order #, VIN…" style={{ ...inp, width: 220 }} />
          <button onClick={printList} disabled={!pickedRows.length} title={pickedRows.length ? "Print the ticked units" : "Tick the units to print"}
            style={{ ...inp, cursor: pickedRows.length ? "pointer" : "not-allowed", fontWeight: 600, opacity: pickedRows.length ? 1 : 0.5 }}>
            🖨 Print{pickedRows.length ? ` ${pickedRows.length} ticked` : ""}
          </button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {/* List */}
        <div style={{ overflowY: "auto", padding: "8px 22px 16px", flex: 1 }}>
          {!loading && !groups.length && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
              {filter ? "No units match that search." : "Nothing owed to truckers right now. 🎉"}
            </div>
          )}
          {groups.map(g => {
            const allPicked = g.bills.every(b => picked[b._id]);
            return (
              <div key={g.vendor} style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--bg-elevated)" }}>
                  <input type="checkbox" checked={allPicked} onChange={() => toggleGroup(g)} title="Select all units for this trucker" />
                  <strong style={{ flex: 1, fontSize: 14 }}>{g.vendor}</strong>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{g.bills.length} unit{g.bills.length === 1 ? "" : "s"}</span>
                  <strong style={{ color: "#f87171", minWidth: 90, textAlign: "right" }}>{fmt$(g.owed)}</strong>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr><th style={{ ...th, width: 28 }}></th><th style={th}>Order</th><th style={th}>Vehicle</th><th style={th}>VIN</th>
                      <th style={th}>Pickup</th><th style={th}>Billed</th><th style={{ ...th, textAlign: "right" }}>Owed</th></tr>
                  </thead>
                  <tbody>
                    {g.bills.map(b => {
                      const days = daysSince(b.date);
                      return (
                        <tr key={b._id} onClick={() => toggle(b._id)} style={{ cursor: "pointer", background: picked[b._id] ? "rgba(52,211,153,0.07)" : "transparent" }}>
                          <td style={td}><input type="checkbox" checked={!!picked[b._id]} onChange={() => toggle(b._id)} onClick={e => e.stopPropagation()} /></td>
                          <td style={td} onClick={e => e.stopPropagation()}>
                            {b.orderId ? <Link to={`/orders/${b.orderId}`} style={{ fontWeight: 600 }}>{b.orderRef || "—"}</Link> : (b.orderRef || "—")}
                          </td>
                          <td style={td}>{b.vehicle || <span style={{ color: "var(--text-muted)" }}>{b.description.slice(0, 40) || "—"}</span>}</td>
                          <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{b.vin ? b.vin.slice(-6) : "—"}</td>
                          <td style={{ ...td, color: "var(--text-secondary)", fontSize: 12 }}>{b.pickup || "—"}</td>
                          <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>
                            {fmtDate(b.date)}
                            {days != null && <span style={{ marginLeft: 6, color: days > 14 ? "#f87171" : days > 7 ? "#fbbf24" : "var(--text-muted)" }}>{days}d</span>}
                          </td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                            {fmt$(b.owed)}
                            {b.status === "partial" && <div style={{ fontSize: 10, color: "#f97316", fontWeight: 500 }}>left of {fmt$(b.amount)} bill</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        {/* Pay bar */}
        <div style={{ padding: "12px 22px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180, fontSize: 13 }}>
            {pickedRows.length
              ? <>Selected <strong>{pickedRows.length}</strong> unit{pickedRows.length === 1 ? "" : "s"} · <strong style={{ color: "#34d399" }}>{fmt$(pickedSum)}</strong>
                  {pickedVendors.size > 1 && <span style={{ color: "#fbbf24" }}> · {pickedVendors.size} truckers</span>}</>
              : <span style={{ color: "var(--text-muted)" }}>Tick the units you're paying</span>}
            {msg && <div style={{ fontSize: 12, marginTop: 2 }}>{msg}</div>}
          </div>
          <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} style={inp} />
          <select value={method} onChange={e => setMethod(e.target.value)} style={inp}>
            {PAY_METHODS.map(m => <option key={m}>{m}</option>)}
          </select>
          <label style={{ ...inp, cursor: "pointer", borderStyle: "dashed", color: proof ? "var(--text-primary)" : "var(--text-secondary)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {proof ? `📎 ${proof.name}` : "📎 Proof (optional)"}
            <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={e => setProof(e.target.files[0] || null)} />
          </label>
          <button onClick={paySelected} disabled={!pickedRows.length || paying}
            style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: (!pickedRows.length || paying) ? 0.5 : 1 }}>
            {paying ? "Saving…" : `✅ Mark ${pickedRows.length || ""} Paid`}
          </button>
        </div>
      </div>
    </div>
  );
}
