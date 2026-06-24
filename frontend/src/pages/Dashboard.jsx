import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const STATUS_CONFIG = {
  "New Order":       { cls: "badge-new",      emoji: "🆕" },
  "Awaiting Pickup": { cls: "badge-pickup",   emoji: "🚗" },
  "Waiting to Sail": { cls: "badge-sail",     emoji: "⚓" },
  "Sailed":          { cls: "badge-sailed",   emoji: "🚢" },
  "Completed":       { cls: "badge-complete", emoji: "✅" },
  "Problem / Hold":  { cls: "badge-problem",  emoji: "⚠️" },
  "Canceled":        { cls: "badge-default",  emoji: "🚫" },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { cls: "badge-default", emoji: "" };
  return <span className={`status-badge ${cfg.cls}`}>{status}</span>;
}

function fmt$(n) {
  if (!n && n !== 0) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Dashboard() {
  const [orders, setOrders]   = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/orders`).then(r => r.json()).catch(() => []),
      fetch(`${API}/api/expenses/summary`).then(r => r.json()).catch(() => null),
    ]).then(([ords, sum]) => {
      setOrders(Array.isArray(ords) ? ords : []);
      setSummary(sum);
      setLoading(false);
    });
  }, []);

  const [activityModal, setActivityModal] = useState(false);
  const [activityView, setActivityView]   = useState("month"); // "day"|"week"|"month"|"year"
  const [activityDate, setActivityDate]   = useState(() => new Date().toISOString().slice(0, 10));

  const now = new Date();

  const activity = useMemo(() => {
    const startOf = (unit) => {
      const d = new Date(now);
      if (unit === "day")   { d.setHours(0,0,0,0); }
      if (unit === "week")  { d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay()); }
      if (unit === "month") { d.setDate(1); d.setHours(0,0,0,0); }
      if (unit === "year")  { d.setMonth(0,1); d.setHours(0,0,0,0); }
      return d;
    };
    const countSince = (d) => orders.filter(o => new Date(o.createdAt) >= d).length;
    return {
      today:   countSince(startOf("day")),
      week:    countSince(startOf("week")),
      month:   countSince(startOf("month")),
      year:    countSince(startOf("year")),
    };
  }, [orders]);

  // Drill-down: group orders by chosen view
  const drillDown = useMemo(() => {
    if (!activityModal) return [];
    const groups = {};
    orders.forEach(o => {
      const d = new Date(o.createdAt);
      let key;
      if (activityView === "day") {
        key = d.toISOString().slice(0, 10);
      } else if (activityView === "week") {
        const day = new Date(d); day.setHours(0,0,0,0);
        day.setDate(day.getDate() - day.getDay());
        key = day.toISOString().slice(0, 10);
      } else if (activityView === "month") {
        key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      } else {
        key = String(d.getFullYear());
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    });
    return Object.entries(groups).sort((a,b) => b[0].localeCompare(a[0]));
  }, [orders, activityModal, activityView]);

  // Orders in selected date
  const selectedOrders = useMemo(() => {
    if (!activityDate) return [];
    return orders.filter(o => {
      const d = new Date(o.createdAt);
      if (activityView === "day")   return d.toISOString().slice(0,10) === activityDate;
      if (activityView === "week")  { const w = new Date(d); w.setHours(0,0,0,0); w.setDate(w.getDate()-w.getDay()); return w.toISOString().slice(0,10) === activityDate; }
      if (activityView === "month") return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` === activityDate;
      return String(d.getFullYear()) === activityDate;
    });
  }, [orders, activityDate, activityView]);

  const fmtGroupLabel = (key) => {
    if (activityView === "day")   return new Date(key+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"});
    if (activityView === "week")  { const d = new Date(key+"T12:00:00"); const e = new Date(d); e.setDate(e.getDate()+6); return `${d.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${e.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`; }
    if (activityView === "month") { const [y,m] = key.split("-"); return new Date(+y,+m-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"}); }
    return key;
  };

  const countStatus = (status) => orders.filter(o => o.status === status).length;

  // Revenue estimate from order charges
  const totalRevenue = orders.reduce((s, o) => {
    const c = o.charges || {};
    return s + [c.towingCharge, c.oceanFreight].reduce((cs, v) => cs + Number(v || 0), 0);
  }, 0);

  const orderCards = [
    { label: "Total Orders",    value: orders.length,                    color: "var(--accent)",  status: "ALL" },
    { label: "New Orders",      value: countStatus("New Order"),         color: "var(--accent)",  status: "New Order" },
    { label: "Awaiting Pickup", value: countStatus("Awaiting Pickup"),   color: "var(--warning)", status: "Awaiting Pickup" },
    { label: "Waiting to Sail", value: countStatus("Waiting to Sail"),   color: "var(--purple)",  status: "Waiting to Sail" },
    { label: "Sailed",          value: countStatus("Sailed"),            color: "var(--success)", status: "Sailed" },
    { label: "Completed",       value: countStatus("Completed"),         color: "#4ade80",         status: "Completed" },
    { label: "Problem / Hold",  value: countStatus("Problem / Hold"),    color: "var(--danger)",  status: "Problem / Hold" },
    { label: "Canceled",        value: countStatus("Canceled"),          color: "#9ca3af",        status: "Canceled" },
  ];

  const recent = orders.slice(0, 10);

  const openOrders = (status) => {
    navigate(status === "ALL" ? "/orders" : `/orders?status=${encodeURIComponent(status)}`);
  };

  // Top expense categories
  const topCats = summary?.byCategory
    ? Object.entries(summary.byCategory).sort((a,b) => b[1]-a[1]).slice(0, 5)
    : [];

  const CAT_COLORS = {
    "Towing / Transport":   "#60a5fa",
    "Ocean Freight":        "#34d399",
    "Port / Terminal Fees": "#a78bfa",
    "Loaders & Warehouses": "#fb923c",
    "Software":             "#38bdf8",
    "Legal Fees":           "#f472b6",
    "Office & Admin":       "#fbbf24",
    "General Overhead":     "#9ca3af",
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>DDG Global Operations overview</p>
        </div>
        <div className="header-actions">
          <button onClick={() => navigate("/orders/new")}>+ New Order</button>
        </div>
      </div>

      {/* ── Order stat cards ─────────────────────────────────────────────────── */}
      <div className="dashboard-grid">
        {orderCards.map(card => (
          <div key={card.label} className="dashboard-card" onClick={() => openOrders(card.status)}>
            <span>{card.label}</span>
            <strong style={{ color: card.color }}>{loading ? "—" : card.value}</strong>
          </div>
        ))}
      </div>

      {/* ── New Orders Activity Card ─────────────────────────────────────────── */}
      {!loading && (
        <div onClick={() => setActivityModal(true)} style={{
          background:"linear-gradient(135deg,var(--bg-panel) 0%,var(--bg-base) 100%)",
          borderRadius:14, padding:"22px 28px", marginBottom:24,
          border:"1px solid var(--border)", cursor:"pointer", transition:"border-color 0.15s",
          display:"grid", gridTemplateColumns:"1fr auto", gap:20, alignItems:"center",
        }}
          onMouseEnter={e=>e.currentTarget.style.borderColor="#60a5fa"}
          onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:"#60a5fa", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>
              📊 New Orders Activity
            </div>
            <div style={{ display:"flex", gap:32, flexWrap:"wrap" }}>
              {[
                { label:"Today",        value: activity.today,  color:"#34d399" },
                { label:"This Week",    value: activity.week,   color:"#60a5fa" },
                { label:"This Month",   value: activity.month,  color:"#a78bfa" },
                { label:"This Year",    value: activity.year,   color:"#fbbf24" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontSize:11, color:"#6b7280", marginBottom:3 }}>{label}</div>
                  <div style={{ fontSize:36, fontWeight:800, color, lineHeight:1 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:12, color:"var(--border)", marginBottom:6 }}>Click to drill down</div>
            <div style={{ fontSize:28, color:"var(--border)" }}>→</div>
          </div>
        </div>
      )}

      {/* ── Activity Drill-Down Modal ─────────────────────────────────────────── */}
      {activityModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:24, overflowY:"auto" }}
          onClick={() => setActivityModal(false)}>
          <div style={{ background:"var(--bg-panel)", borderRadius:14, width:"100%", maxWidth:860, padding:28, boxShadow:"0 24px 60px rgba(0,0,0,0.5)", marginTop:20 }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <h2 style={{ margin:0, fontSize:20, color:"var(--text-primary)" }}>📊 New Orders Activity</h2>
              <button onClick={() => setActivityModal(false)} style={{ background:"none", border:"none", color:"#6b7280", fontSize:22, cursor:"pointer" }}>✕</button>
            </div>

            {/* View toggle */}
            <div style={{ display:"flex", gap:8, marginBottom:20 }}>
              {[["day","By Day"],["week","By Week"],["month","By Month"],["year","By Year"]].map(([v,lbl]) => (
                <button key={v} onClick={() => { setActivityView(v); setActivityDate(""); }}
                  style={{ padding:"7px 18px", borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontWeight:600,
                    background: activityView===v ? "#3b82f6" : "var(--bg-elevated)",
                    color: activityView===v ? "#fff" : "#6b7280" }}>
                  {lbl}
                </button>
              ))}
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", gap:20 }}>
              {/* Left: period list */}
              <div style={{ background:"var(--bg-elevated)", borderRadius:10, padding:12, maxHeight:520, overflowY:"auto" }}>
                <div style={{ fontSize:11, color:"#6b7280", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>
                  {activityView==="day"?"Days":activityView==="week"?"Weeks":activityView==="month"?"Months":"Years"}
                </div>
                {drillDown.map(([key, ords]) => (
                  <div key={key} onClick={() => setActivityDate(key)}
                    style={{ padding:"8px 10px", borderRadius:7, cursor:"pointer", marginBottom:4,
                      background: activityDate===key ? "#1e3a5f" : "transparent",
                      border: `1px solid ${activityDate===key ? "#3b82f6" : "transparent"}` }}
                    onMouseEnter={e=>e.currentTarget.style.background=activityDate===key?"#1e3a5f":"var(--bg-hover)"}
                    onMouseLeave={e=>e.currentTarget.style.background=activityDate===key?"#1e3a5f":"transparent"}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:12, color:"var(--text-primary)" }}>{fmtGroupLabel(key)}</span>
                      <span style={{ fontSize:15, fontWeight:800, color:"#60a5fa" }}>{ords.length}</span>
                    </div>
                  </div>
                ))}
                {drillDown.length === 0 && <div style={{ fontSize:12, color:"#4b5563" }}>No orders yet</div>}
              </div>

              {/* Right: orders in selected period */}
              <div>
                {activityDate ? (
                  <>
                    <div style={{ fontSize:13, fontWeight:700, color:"var(--text-primary)", marginBottom:12 }}>
                      {fmtGroupLabel(activityDate)} — <span style={{ color:"#60a5fa" }}>{selectedOrders.length} order{selectedOrders.length!==1?"s":""}</span>
                    </div>
                    {selectedOrders.length === 0 && <div style={{ fontSize:13, color:"#4b5563" }}>No orders in this period.</div>}
                    <div style={{ display:"flex", flexDirection:"column", gap:8, maxHeight:480, overflowY:"auto" }}>
                      {selectedOrders.map(o => (
                        <div key={o._id} onClick={() => { navigate(`/orders/${o._id}`); setActivityModal(false); }}
                          style={{ background:"var(--bg-elevated)", borderRadius:8, padding:"10px 14px", cursor:"pointer", border:"1px solid var(--border)",
                            display:"flex", justifyContent:"space-between", alignItems:"center" }}
                          onMouseEnter={e=>e.currentTarget.style.borderColor="#60a5fa"}
                          onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
                          <div>
                            <div style={{ fontSize:13, fontWeight:600, color:"var(--text-primary)" }}>
                              #{o.refNumber} — {o.customerName || "—"}
                            </div>
                            <div style={{ fontSize:11, color:"#6b7280", marginTop:2 }}>
                              {[o.year,o.make,o.model].filter(Boolean).join(" ")||o.vin||"—"}
                              {" · "}{new Date(o.createdAt).toLocaleString()}
                            </div>
                          </div>
                          <span style={{ fontSize:11, padding:"2px 8px", borderRadius:5, background:"rgba(96,165,250,0.1)", color:"#60a5fa", fontWeight:600 }}>
                            {o.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:200, color:"#4b5563", fontSize:14 }}>
                    ← Select a period to see orders
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Financial summary ─────────────────────────────────────────────────── */}
      {!loading && (
        <div className="form-section" style={{ marginBottom: 24 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, paddingBottom:12, borderBottom:"1px solid var(--border-muted)" }}>
            <h2 style={{ margin:0, border:"none", padding:0 }}>Financials</h2>
            <div style={{ display:"flex", gap:10 }}>
              <button className="btn-ghost" style={{ fontSize:12, padding:"6px 14px" }} onClick={() => navigate("/expenses")}>
                All Expenses →
              </button>
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:14 }}>
            {/* Revenue estimate */}
            <div style={{ background:"var(--bg-panel)", borderRadius:10, padding:"16px 18px", border:"1px solid var(--border)" }}>
              <div style={{ fontSize:11, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>Est. Revenue</div>
              <div style={{ fontSize:22, fontWeight:800, color:"var(--accent)" }}>{fmt$(totalRevenue)}</div>
              <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:4 }}>from towing + ocean charges</div>
            </div>

            {/* Total expenses */}
            <div style={{ background:"var(--bg-panel)", borderRadius:10, padding:"16px 18px", border:"1px solid var(--border)" }}>
              <div style={{ fontSize:11, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>Total Expenses</div>
              <div style={{ fontSize:22, fontWeight:800, color:"#f87171" }}>{fmt$(summary?.totalAllTime)}</div>
              <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:4 }}>{summary?.count || 0} records</div>
            </div>

            {/* Unpaid */}
            <div style={{ background:"var(--bg-panel)", borderRadius:10, padding:"16px 18px", border:"1px solid rgba(248,113,113,0.3)" }}>
              <div style={{ fontSize:11, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>Outstanding / Unpaid</div>
              <div style={{ fontSize:22, fontWeight:800, color: summary?.totalUnpaid > 0 ? "#f87171" : "#34d399" }}>
                {fmt$(summary?.totalUnpaid)}
              </div>
              <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:4 }}>needs payment</div>
            </div>

            {/* Paid this month */}
            <div style={{ background:"var(--bg-panel)", borderRadius:10, padding:"16px 18px", border:"1px solid rgba(52,211,153,0.25)" }}>
              <div style={{ fontSize:11, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>Paid This Month</div>
              <div style={{ fontSize:22, fontWeight:800, color:"#34d399" }}>{fmt$(summary?.totalPaidMonth)}</div>
              <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:4 }}>
                {new Date().toLocaleString("default", { month:"long", year:"numeric" })}
              </div>
            </div>
          </div>

          {/* Net margin bar */}
          {totalRevenue > 0 && summary?.totalAllTime > 0 && (
            <div style={{ marginTop:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--text-muted)", marginBottom:6 }}>
                <span>Gross margin estimate</span>
                <span style={{ color: totalRevenue > summary.totalAllTime ? "#34d399" : "#f87171", fontWeight:700 }}>
                  {fmt$(totalRevenue - summary.totalAllTime)}
                  {" "}
                  ({totalRevenue > 0 ? Math.round(((totalRevenue - summary.totalAllTime) / totalRevenue) * 100) : 0}%)
                </span>
              </div>
              <div style={{ height:8, background:"var(--bg-panel)", borderRadius:4, overflow:"hidden", border:"1px solid var(--border)" }}>
                <div style={{
                  height:"100%", borderRadius:4,
                  width: `${Math.min(100, Math.max(0, (summary.totalAllTime / totalRevenue) * 100))}%`,
                  background: totalRevenue > summary.totalAllTime ? "#f87171" : "#f87171",
                  transition:"width 0.5s",
                }} />
              </div>
              <div style={{ display:"flex", gap:16, marginTop:6, fontSize:11, color:"var(--text-muted)" }}>
                <span style={{ color:"#f87171" }}>■ Expenses</span>
                <span style={{ color:"var(--accent)" }}>■ Revenue</span>
              </div>
            </div>
          )}

          {/* Category breakdown */}
          {topCats.length > 0 && (
            <div style={{ marginTop:16, display:"flex", flexWrap:"wrap", gap:10 }}>
              {topCats.map(([cat, amt]) => (
                <div key={cat} style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 12px",
                  background:"var(--bg-panel)", borderRadius:20, border:"1px solid var(--border)" }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", background: CAT_COLORS[cat] || "#9ca3af", flexShrink:0 }} />
                  <span style={{ fontSize:12, color:"var(--text-secondary)" }}>{cat}</span>
                  <span style={{ fontSize:12, color:"var(--text-primary)", fontWeight:600 }}>{fmt$(amt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Recent orders ────────────────────────────────────────────────────── */}
      <div className="form-section">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, paddingBottom:12, borderBottom:"1px solid var(--border-muted)" }}>
          <h2 style={{ margin:0, border:"none", padding:0 }}>Recent Orders</h2>
          <button className="btn-ghost" style={{ fontSize:12, padding:"6px 14px" }} onClick={() => navigate("/orders")}>
            View all
          </button>
        </div>

        {loading ? (
          <div className="empty-state">Loading orders…</div>
        ) : recent.length === 0 ? (
          <div className="empty-state">
            No orders yet.{" "}
            <span style={{ color:"var(--accent)", cursor:"pointer" }} onClick={() => navigate("/orders/new")}>
              Create your first order →
            </span>
          </div>
        ) : (
          <table className="orders-table">
            <thead>
              <tr>
                <th>Ref #</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>VIN</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(o => (
                <tr key={o._id} style={{ cursor:"pointer" }} onClick={() => navigate(`/orders/${o._id}`)}>
                  <td style={{ color:"var(--accent)", fontWeight:500 }}>{o.refNumber || "—"}</td>
                  <td>{o.customerName || "—"}</td>
                  <td style={{ color:"var(--text-secondary)" }}>{[o.year, o.make, o.model].filter(Boolean).join(" ") || "—"}</td>
                  <td style={{ fontFamily:"monospace", fontSize:12, color:"var(--text-muted)" }}>{o.vin || "—"}</td>
                  <td><StatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
