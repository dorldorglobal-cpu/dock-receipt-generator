import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const STATUS_COLORS = {
  "New Order":       { bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.35)",  text: "#60a5fa" },
  "Dispatched":      { bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.35)", text: "#a78bfa" },
  "Waiting to Sail": { bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.35)",  text: "#fbbf24" },
  "Sailed":          { bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.35)",  text: "#34d399" },
  "Arrived":         { bg: "rgba(74,222,128,0.12)",  border: "rgba(74,222,128,0.35)",  text: "#4ade80" },
  "Completed":       { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.35)", text: "#94a3b8" },
};

function statusStyle(s) {
  return STATUS_COLORS[s] || { bg: "rgba(99,102,241,0.1)", border: "rgba(99,102,241,0.3)", text: "#818cf8" };
}

// Group container orders by bookingNumber, falling back to refNumber
function groupByBooking(orders) {
  const map = {};
  for (const o of orders) {
    const key = (o.bookingNumber || "").trim() || o.refNumber;
    if (!map[key]) map[key] = { bookingNumber: key, orders: [] };
    map[key].orders.push(o);
  }
  // Sort each group's orders by createdAt
  for (const g of Object.values(map)) {
    g.orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
  // Sort groups by earliest order createdAt desc
  return Object.values(map).sort((a, b) =>
    new Date(b.orders[0].createdAt) - new Date(a.orders[0].createdAt)
  );
}

export default function Containers() {
  const [orders, setOrders]     = useState([]);
  const [search, setSearch]     = useState("");
  const [expanded, setExpanded] = useState({}); // bookingNumber -> bool
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API}/api/orders`)
      .then(r => r.json())
      .then(data => setOrders(data.filter(o => o.requestType === "Container")));
  }, []);

  const groups = groupByBooking(orders).filter(g => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      g.bookingNumber.toLowerCase().includes(s) ||
      g.orders.some(o =>
        `${o.vin} ${o.customerName} ${o.vessel} ${o.containerNumber} ${o.sealNumber} ${o.refNumber}`
          .toLowerCase().includes(s)
      )
    );
  });

  const toggle = key => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  // Representative fields from first order in group
  const rep = g => g.orders[0];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>📦 Containers</h1>
          <p>Container bookings grouped by booking number.</p>
        </div>
        <button onClick={() => navigate("/orders/new")}
          style={{ padding: "10px 18px", borderRadius: 10, border: "none",
            background: "linear-gradient(135deg,#2563eb,#0e4db5)", color: "#fff",
            cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          + New Order
        </button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 18 }}>
        <input
          placeholder="Search booking #, VIN, container, customer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: "100%", maxWidth: 420, padding: "8px 14px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--bg-input)",
            color: "var(--text-primary)", fontSize: 14 }}
        />
        <span style={{ marginLeft: 14, fontSize: 13, color: "var(--text-secondary)" }}>
          {groups.length} booking{groups.length !== 1 ? "s" : ""} · {orders.length} unit{orders.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Booking cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.length === 0 && (
          <p style={{ color: "var(--text-secondary)", textAlign: "center", marginTop: 40 }}>
            No container orders found.
          </p>
        )}

        {groups.map(g => {
          const r = rep(g);
          const open = !!expanded[g.bookingNumber];
          const statuses = [...new Set(g.orders.map(o => o.status))];
          const dominantStatus = statuses.length === 1 ? statuses[0] : "Mixed";
          const sc = statusStyle(r.status);

          return (
            <div key={g.bookingNumber}
              style={{ background: "var(--bg-panel)", border: "1px solid var(--border)",
                borderRadius: 12, overflow: "hidden" }}>

              {/* Booking header row */}
              <div
                onClick={() => toggle(g.bookingNumber)}
                style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1.5fr 1fr 1fr auto",
                  gap: 16, padding: "14px 20px", cursor: "pointer", alignItems: "center",
                  borderBottom: open ? "1px solid var(--border)" : "none" }}>

                {/* Booking # + container/seal */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>
                    {g.bookingNumber || <span style={{ color: "var(--text-secondary)" }}>No Booking #</span>}
                  </div>
                  {r.containerNumber && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      Container: <strong style={{ color: "var(--text-primary)" }}>{r.containerNumber}</strong>
                      {r.sealNumber && <> · Seal: <strong style={{ color: "var(--text-primary)" }}>{r.sealNumber}</strong></>}
                    </div>
                  )}
                </div>

                {/* Vessel */}
                <div>
                  <div style={{ fontSize: 13 }}>{r.vessel || "—"}</div>
                  {r.voyage && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{r.voyage}</div>}
                </div>

                {/* Route + sail date */}
                <div>
                  <div style={{ fontSize: 13 }}>{r.pol} → {r.pod}</div>
                  {r.sailDate && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Sail: {r.sailDate}</div>}
                </div>

                {/* Unit count */}
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#60a5fa" }}>{g.orders.length}</div>
                  <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>UNIT{g.orders.length !== 1 ? "S" : ""}</div>
                </div>

                {/* Status */}
                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
                    background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text }}>
                    {dominantStatus}
                  </span>
                </div>

                {/* Expand toggle */}
                <div style={{ fontSize: 18, color: "var(--text-secondary)", userSelect: "none" }}>
                  {open ? "▲" : "▼"}
                </div>
              </div>

              {/* VIN chips summary (always visible, collapsed view) */}
              {!open && (
                <div style={{ padding: "8px 20px 12px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {g.orders.map(o => (
                    <span key={o._id}
                      onClick={e => { e.stopPropagation(); navigate(`/orders/${o._id}`); }}
                      style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, cursor: "pointer",
                        background: "var(--bg-elevated)", border: "1px solid var(--border)",
                        color: "var(--text-secondary)", fontFamily: "monospace",
                        transition: "all 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.color = "var(--text-primary)"}
                      onMouseLeave={e => e.currentTarget.style.color = "var(--text-secondary)"}>
                      {o.vin ? o.vin.slice(-6) : o.refNumber}
                    </span>
                  ))}
                </div>
              )}

              {/* Expanded: full order list */}
              {open && (
                <div>
                  {g.orders.map((o, idx) => {
                    const osc = statusStyle(o.status);
                    return (
                      <div key={o._id}
                        onClick={() => navigate(`/orders/${o._id}`)}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.2fr 2fr 1.5fr 1fr 1fr",
                          gap: 16, padding: "12px 20px", cursor: "pointer", alignItems: "center",
                          background: idx % 2 === 0 ? "var(--bg-elevated)" : "transparent",
                          borderBottom: idx < g.orders.length - 1 ? "1px solid var(--border)" : "none",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.06)"}
                        onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? "var(--bg-elevated)" : "transparent"}>

                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{o.refNumber}</div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{o.customerName}</div>
                        </div>

                        <div>
                          <div style={{ fontSize: 13 }}>{o.year} {o.make} {o.model}</div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "monospace" }}>
                            {o.vin || "—"}
                          </div>
                        </div>

                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          {o.color && <div>{o.color}</div>}
                          {o.condition && <div>{o.condition}</div>}
                        </div>

                        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                          {o.lotNumber && <div>Lot: {o.lotNumber}</div>}
                          {o.pin && <div>PIN: {o.pin}</div>}
                        </div>

                        <div>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
                            background: osc.bg, border: `1px solid ${osc.border}`, color: osc.text }}>
                            {o.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
