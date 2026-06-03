import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const TABS = [
  { label: "All",              value: "all",              color: "#8b949e" },
  { label: "New Order",        value: "New Order",        color: "#60a5fa" },
  { label: "Dispatched",       value: "Dispatched",       color: "#a78bfa" },
  { label: "Waiting to Sail",  value: "Waiting to Sail",  color: "#fbbf24" },
  { label: "Sailed",           value: "Sailed",           color: "#34d399" },
  { label: "Arrived",          value: "Arrived",          color: "#4ade80" },
  { label: "Completed",        value: "Completed",        color: "#94a3b8" },
];

const STATUS_COLORS = {
  "New Order":       { bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.35)",  text: "#60a5fa" },
  "Dispatched":      { bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.35)", text: "#a78bfa" },
  "Waiting to Sail": { bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.35)",  text: "#fbbf24" },
  "Sailed":          { bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.35)",  text: "#34d399" },
  "Arrived":         { bg: "rgba(74,222,128,0.12)",  border: "rgba(74,222,128,0.35)",  text: "#4ade80" },
  "Completed":       { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.35)", text: "#94a3b8" },
  "Paid":            { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.35)", text: "#94a3b8" },
};

export default function Orders() {
  const [orders, setOrders]           = useState([]);
  const [search, setSearch]           = useState("");
  const [activeTab, setActiveTab]     = useState("all");
  const [sourceFilter, setSourceFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]       = useState(false);
  const navigate = useNavigate();

  useEffect(() => { fetchOrders(); }, []);

  const fetchOrders = async () => {
    const res  = await fetch(`${API}/api/orders`);
    const data = await res.json();
    setOrders(data);
  };

  const deleteOrder = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`${API}/api/orders/${deleteTarget.id}`, { method: "DELETE" });
      setOrders(prev => prev.filter(o => o._id !== deleteTarget.id));
    } catch (err) { console.error("Delete failed:", err); }
    finally { setDeleting(false); setDeleteTarget(null); }
  };

  // Count per tab
  const counts = {};
  for (const t of TABS) {
    counts[t.value] = t.value === "all"
      ? orders.length
      : orders.filter(o => o.status === t.value).length;
  }

  const filtered = orders.filter(o => {
    const text = `${o.refNumber} ${o.customerName} ${o.vin} ${o.make} ${o.model}`.toLowerCase();
    const matchSearch  = text.includes(search.toLowerCase());
    const matchTab     = activeTab === "all" || o.status === activeTab;
    const matchSource  = sourceFilter ? (o.source || "") === sourceFilter : true;
    return matchSearch && matchTab && matchSource;
  });

  const shippingLine = (o) => {
    const bn = (o.bookingNumber || "").toUpperCase();
    if (bn.startsWith("SLSE") || bn.startsWith("SLS")) return "SALLAUM";
    if (bn.startsWith("ACL") || bn.startsWith("GLL")) return "ACL";
    return o.shippingLine || "";
  };

  const statusStyle = (s) => STATUS_COLORS[s] || { bg: "rgba(99,102,241,0.1)", border: "rgba(99,102,241,0.3)", text: "#818cf8" };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <p>Manage all DDG shipments and operations.</p>
        </div>
        <button onClick={() => navigate("/orders/new")}
          style={{ padding: "10px 18px", borderRadius: 10, border: "none",
            background: "linear-gradient(135deg,#1a6ef7,#0e4db5)", color: "#fff",
            cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          + New Order
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 0, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t.value} onClick={() => setActiveTab(t.value)}
            style={{
              padding: "8px 16px", borderRadius: "8px 8px 0 0", border: "none",
              background: activeTab === t.value ? "var(--bg-panel)" : "transparent",
              color: activeTab === t.value ? t.color : "var(--text-secondary)",
              cursor: "pointer", fontSize: 13, fontWeight: activeTab === t.value ? 600 : 400,
              borderBottom: activeTab === t.value ? `2px solid ${t.color}` : "2px solid transparent",
              transition: "all 0.15s",
            }}>
            {t.label}
            <span style={{
              marginLeft: 6, fontSize: 11, padding: "1px 6px", borderRadius: 10,
              background: activeTab === t.value ? `${t.color}22` : "var(--bg-elevated)",
              color: activeTab === t.value ? t.color : "var(--text-secondary)",
            }}>{counts[t.value] || 0}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="orders-toolbar">
        <input placeholder="Search ref, VIN, customer…" value={search}
          onChange={e => setSearch(e.target.value)} />
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          style={{ padding:"6px 10px", borderRadius:6, border:"1px solid var(--border)",
            background:"var(--bg-input)", color:"var(--text-primary)", fontSize:13 }}>
          <option value="">All Sources</option>
          <option value="USA OFFICE">🇺🇸 USA Office</option>
          <option value="GHANA OFFICE">🇬🇭 Ghana Office</option>
        </select>
      </div>

      {/* Table */}
      <table className="orders-table">
        <thead>
          <tr>
            <th>Ref #</th>
            <th>Customer</th>
            <th>Vehicle</th>
            <th>Route</th>
            <th>Vessel</th>
            <th>Status</th>
            <th style={{ width: 100, textAlign: "center" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(o => {
            const sc = statusStyle(o.status);
            return (
              <tr key={o._id} onClick={() => navigate(`/orders/${o._id}`)} style={{ cursor: "pointer" }}>
                <td><strong style={{ fontSize: 22, letterSpacing: "0.01em" }}>{o.refNumber}</strong></td>
                <td>
                  <div>{o.customerName}</div>
                  <small>{o.customerPhone}</small>
                  {o.source && (
                    <div style={{ marginTop: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
                        background: o.source === "GHANA OFFICE" ? "rgba(34,197,94,0.15)" : "rgba(99,102,241,0.15)",
                        color: o.source === "GHANA OFFICE" ? "#4ade80" : "#a78bfa",
                        border: `1px solid ${o.source === "GHANA OFFICE" ? "rgba(74,222,128,0.3)" : "rgba(167,139,250,0.3)"}` }}>
                        {o.source}
                      </span>
                    </div>
                  )}
                </td>
                <td>
                  <div style={{ color: "var(--text-primary)" }}>{o.year} {o.make} {o.model}</div>
                  <small style={{ color: "var(--text-primary)", opacity: 0.7 }}>{o.vin}</small>
                </td>
                <td>{o.pol} → {o.pod}</td>
                <td>
                  <div style={{ fontSize: 13 }}>{o.vessel || "—"}</div>
                  {o.voyage && <small style={{ color: "var(--text-secondary)" }}>{o.voyage}</small>}
                  {shippingLine(o) && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{shippingLine(o)}</div>}
                </td>
                <td>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
                    background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text }}>
                    {o.status}
                  </span>
                </td>
                <td style={{ textAlign: "center", whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
                  <button title="Edit" onClick={() => navigate(`/orders/${o._id}`)}
                    style={{ padding:"4px 10px", marginRight:5, borderRadius:6,
                      border:"1px solid var(--border)", background:"var(--bg-panel)",
                      color:"var(--text-secondary)", cursor:"pointer", fontSize:13 }}>✏️</button>
                  <button title="Delete" onClick={() => setDeleteTarget({ id: o._id, refNumber: o.refNumber })}
                    style={{ padding:"4px 10px", borderRadius:6,
                      border:"1px solid rgba(239,68,68,0.35)", background:"rgba(239,68,68,0.1)",
                      color:"#fca5a5", cursor:"pointer", fontSize:13 }}>🗑️</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {filtered.length === 0 && (
        <p style={{ marginTop: 20, color: "#6b7280", textAlign: "center" }}>
          No orders found{activeTab !== "all" ? ` in "${activeTab}"` : ""}.
        </p>
      )}

      {/* Delete Modal */}
      {deleteTarget && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
          <div style={{ background:"var(--bg-elevated)", border:"1px solid var(--border)",
            borderRadius:14, padding:"28px 32px", maxWidth:420, width:"90%", textAlign:"center" }}>
            <div style={{ fontSize:36, marginBottom:12 }}>🗑️</div>
            <h3 style={{ margin:"0 0 8px", fontSize:18 }}>Delete Order?</h3>
            <p style={{ color:"var(--text-secondary)", marginBottom:22, fontSize:14 }}>
              This will permanently delete order <strong>Ref #{deleteTarget.refNumber}</strong>. This cannot be undone.
            </p>
            <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                style={{ padding:"9px 22px", borderRadius:8, border:"1px solid var(--border)",
                  background:"var(--bg-panel)", color:"var(--text-primary)", cursor:"pointer", fontSize:14 }}>
                Cancel
              </button>
              <button onClick={deleteOrder} disabled={deleting}
                style={{ padding:"9px 22px", borderRadius:8, border:"none",
                  background:"#dc2626", color:"#fff", cursor: deleting ? "not-allowed" : "pointer",
                  fontSize:14, fontWeight:600 }}>
                {deleting ? "Deleting…" : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
