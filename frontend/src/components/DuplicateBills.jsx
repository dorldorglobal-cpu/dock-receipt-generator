import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const HIDDEN_KEY = "dupBillsNotDupes"; // groups the user marked "not a duplicate" (this browser)

const fmt$ = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const groupKey = (g) => g.bills.map(b => b._id).sort().join(",");
const readHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]")); } catch { return new Set(); } };

/**
 * "Duplicate Bills" — bills for the same order, category and amount, side by
 * side, with one click to combine them into the bill you keep.
 */
export default function DuplicateBills({ onClose, onChanged }) {
  const [groups, setGroups]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [keepIds, setKeepIds] = useState({}); // groupKey → bill _id to keep
  const [busy, setBusy]       = useState("");  // groupKey being combined
  const [msg, setMsg]         = useState("");
  const [hidden, setHidden]   = useState(readHidden);
  const [showHidden, setShowHidden] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await (await fetch(`${API}/api/expenses/duplicates`)).json();
      const list = Array.isArray(data) ? data : [];
      setGroups(list);
      setKeepIds(Object.fromEntries(list.map(g => [groupKey(g), g.suggestedKeep])));
    } catch { setGroups([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const combine = async (g) => {
    const key = groupKey(g), keepId = keepIds[key];
    setBusy(key); setMsg("");
    try {
      for (const b of g.bills.filter(b => b._id !== keepId)) {
        const res = await fetch(`${API}/api/expenses/duplicates/combine`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keepId, removeId: b._id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Combine failed");
      }
      setMsg(`✅ Order ${g.orderRef} — combined into one ${fmt$(g.amount)} bill`);
      await load();
      onChanged?.();
    } catch (e) { setMsg(`❌ Order ${g.orderRef}: ${e.message}`); }
    setBusy("");
  };

  const toggleHidden = (g) => {
    const next = new Set(hidden);
    next.has(groupKey(g)) ? next.delete(groupKey(g)) : next.add(groupKey(g));
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch { /* storage blocked */ }
  };

  // Bills for different cars on one order are a wrong order link, not a duplicate
  const isSet   = (g) => hidden.has(groupKey(g)) || g.differentVehicles;
  const active  = groups.filter(g => !isSet(g));
  const aside   = groups.filter(isSet);
  const wronglyUnpaid = active.reduce((s, g) => s + (g.bills.some(b => b.status !== "unpaid") ? g.bills.filter(b => b.status === "unpaid").reduce((t, b) => t + b.amount, 0) : 0), 0);

  const statusTag = (b) => {
    const c = b.status === "paid" ? ["#e7f6ec", "#15803d"] : b.status === "partial" ? ["#fdeee2", "#c2410c"] : ["#fdecec", "#dc2626"];
    return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: c[0], color: c[1] }}>
      {b.status === "paid" ? "Paid" : b.status === "partial" ? "Partial" : "Unpaid"}
    </span>;
  };

  const renderGroup = (g, setAside) => {
    const key = groupKey(g), keepId = keepIds[key];
    return (
      <div key={key} style={{ border: "1px solid var(--border)", borderRadius: 10, marginTop: 14, overflow: "hidden", opacity: setAside ? 0.75 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--bg-elevated)", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>
            Order {g.bills.find(b => b.orderId)?.orderId
              ? <Link to={`/orders/${g.bills.find(b => b.orderId).orderId}`}>{g.orderRef}</Link> : g.orderRef}
          </strong>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{g.category} · {g.bills.length} bills of {fmt$(g.amount)}</span>
          {g.differentVehicles && <span style={{ fontSize: 11, color: "#b45309", fontWeight: 600 }}>⚠ Different VINs — probably one bill is on the wrong order</span>}
          <span style={{ flex: 1 }} />
          {!g.differentVehicles && (
            <button onClick={() => toggleHidden(g)} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
              {setAside ? "↩ Show again" : "Not a duplicate"}
            </button>
          )}
          {!setAside && (
            <button onClick={() => combine(g)} disabled={!!busy}
              style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy === key ? "Combining…" : "Combine → keep selected"}
            </button>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(g.bills.length, 3)}, 1fr)` }}>
          {g.bills.map(b => {
            const kept = keepId === b._id;
            return (
              <label key={b._id} style={{ display: "block", padding: "10px 12px", borderTop: "1px solid var(--border-muted)", borderLeft: "1px solid var(--border-muted)", cursor: setAside ? "default" : "pointer",
                background: !setAside && kept ? "rgba(52,211,153,0.07)" : "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  {!setAside && <input type="radio" name={key} checked={kept} onChange={() => setKeepIds(k => ({ ...k, [key]: b._id }))} />}
                  <strong style={{ fontSize: 13 }}>{b.vendor || "—"}</strong>
                  {statusTag(b)}
                  {!setAside && <span style={{ fontSize: 11, color: kept ? "#15803d" : "#dc2626", fontWeight: 600 }}>{kept ? "Keep" : "Remove"}</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  <div>{(b.description || "").slice(0, 90) || "—"}</div>
                  <div>Invoice # <strong>{b.invoiceNumber || "—"}</strong> · VIN {(b.vin || (b.description || "").match(/VIN:\s*(\w{11,17})/i)?.[1] || "—").slice(-6)}</div>
                  <div>Bill date {fmtDate(b.date)} · created {fmtDate(b.createdAt)}</div>
                  <div>{b.status !== "unpaid" ? <>Paid {fmtDate(b.paidDate)} {b.paymentMethod && `· ${b.paymentMethod}`}</> : "Not paid"}
                    {(b.billFileName || b.billDriveId) && " · 📄 bill"}{(b.receiptFileName || b.receiptDriveId) && " · 📎 proof"}</div>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 14, width: "100%", maxWidth: 1040, maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>🧹 Duplicate Bills</h2>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
              {loading ? "Checking…" : <>{active.length} order{active.length === 1 ? "" : "s"} with the same bill entered twice
                {wronglyUnpaid > 0 && <> · <strong style={{ color: "#dc2626" }}>{fmt$(wronglyUnpaid)}</strong> showing unpaid that was already paid</>}</>}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
              Pick the bill to keep (the one with the invoice # and bill is pre-selected). Combine moves the payment onto it and deletes the other.
            </div>
            {msg && <div style={{ fontSize: 13, marginTop: 6 }}>{msg}</div>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: "4px 22px 18px" }}>
          {!loading && !active.length && <div style={{ padding: 36, textAlign: "center", color: "var(--text-muted)" }}>No duplicate bills. 🎉</div>}
          {active.map(g => renderGroup(g, false))}
          {aside.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <button onClick={() => setShowHidden(s => !s)} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", padding: 0 }}>
                {showHidden ? "▼" : "▶"} {aside.length} set aside (different cars or marked not a duplicate)
              </button>
              {showHidden && aside.map(g => renderGroup(g, true))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
