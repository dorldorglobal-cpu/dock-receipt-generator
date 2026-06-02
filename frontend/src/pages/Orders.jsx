import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, refNumber }
  const [deleting, setDeleting] = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const statusFilter = searchParams.get("status");

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    const res = await fetch(`${API}/api/orders`);
    const data = await res.json();
    setOrders(data);
  };

  const deleteOrder = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`${API}/api/orders/${deleteTarget.id}`, { method: "DELETE" });
      setOrders((prev) => prev.filter((o) => o._id !== deleteTarget.id));
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const filtered = orders.filter((o) => {
    const text = `${o.refNumber} ${o.customerName} ${o.vin} ${o.make} ${o.model}`.toLowerCase();

    const matchesSearch = text.includes(search.toLowerCase());
    const matchesStatus = statusFilter ? o.status === statusFilter : true;
    const matchesSource = sourceFilter ? (o.source || "") === sourceFilter : true;

    return matchesSearch && matchesStatus && matchesSource;
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>
            Orders {statusFilter ? `— ${statusFilter}` : ""}
          </h1>

          <p>
            {statusFilter
              ? `Showing orders with status: ${statusFilter}`
              : "Manage all DDG shipments and operations."}
          </p>
        </div>

        {statusFilter && (
          <button
            onClick={() => navigate("/orders")}
            style={{
              padding: "10px 14px",
              borderRadius: "10px",
              border: "none",
              background: "#111827",
              color: "white",
              cursor: "pointer",
            }}
          >
            Show All Orders
          </button>
        )}
      </div>

      <div className="orders-toolbar">
        <input
          placeholder="Search reference, VIN, customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          style={{ padding:"6px 10px", borderRadius:6, border:"1px solid var(--border)",
            background:"var(--bg-input)", color:"var(--text-primary)", fontSize:13 }}>
          <option value="">All Sources</option>
          <option value="USA OFFICE">🇺🇸 USA Office</option>
          <option value="GHANA OFFICE">🇬🇭 Ghana Office</option>
        </select>
      </div>

      <table className="orders-table">
        <thead>
          <tr>
            <th>Ref #</th>
            <th>Customer</th>
            <th>Vehicle</th>
            <th>Route</th>
            <th>Shipping Line</th>
            <th>Status</th>
            <th style={{ width: 100, textAlign: "center" }}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {filtered.map((o) => (
            <tr
              key={o._id}
              onClick={() => navigate(`/orders/${o._id}`)}
              style={{ cursor: "pointer" }}
            >
              <td>
                <strong>{o.refNumber}</strong>
              </td>

              <td>
                <div>{o.customerName}</div>
                <small>{o.customerPhone}</small>
                {o.source && (
                  <div style={{ marginTop: 3 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
                      background: o.source === "GHANA OFFICE" ? "rgba(34,197,94,0.15)" : "rgba(99,102,241,0.15)",
                      color:      o.source === "GHANA OFFICE" ? "#4ade80"              : "#a78bfa",
                      border:     `1px solid ${o.source === "GHANA OFFICE" ? "rgba(74,222,128,0.3)" : "rgba(167,139,250,0.3)"}` }}>
                      {o.source}
                    </span>
                  </div>
                )}
              </td>

              <td>
                {o.year} {o.make} {o.model}
                <br />
                <small>{o.vin}</small>
              </td>

              <td>
                {o.pol} → {o.pod}
              </td>

              <td>{(() => {
                const bn = (o.bookingNumber || "").toUpperCase();
                if (bn.startsWith("SLSE") || bn.startsWith("SLS")) return "SALLAUM LINES";
                if (bn.startsWith("ACL") || bn.startsWith("GLL")) return "ACL";
                return o.shippingLine || "";
              })()}</td>

              <td>
                <span className="status-badge">{o.status}</span>
              </td>

              <td
                style={{ textAlign: "center", whiteSpace: "nowrap" }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  title="Edit order"
                  onClick={() => navigate(`/orders/${o._id}`)}
                  style={{
                    padding: "4px 10px",
                    marginRight: 5,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  ✏️
                </button>
                <button
                  title="Delete order"
                  onClick={() => setDeleteTarget({ id: o._id, refNumber: o.refNumber })}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(239,68,68,0.35)",
                    background: "rgba(239,68,68,0.1)",
                    color: "#fca5a5",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  🗑️
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {filtered.length === 0 && (
        <p style={{ marginTop: "20px", color: "#6b7280" }}>
          No orders found.
        </p>
      )}

      {/* ── Delete Confirmation Modal ─────────────────────────────────── */}
      {deleteTarget && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.65)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            padding: "28px 32px",
            maxWidth: 420,
            width: "90%",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
            <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>Delete Order?</h3>
            <p style={{ color: "var(--text-secondary)", marginBottom: 22, fontSize: 14 }}>
              This will permanently delete order <strong>Ref #{deleteTarget.refNumber}</strong>.
              This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                style={{
                  padding: "9px 22px", borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  color: "var(--text-primary)",
                  cursor: "pointer", fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                onClick={deleteOrder}
                disabled={deleting}
                style={{
                  padding: "9px 22px", borderRadius: 8,
                  border: "none",
                  background: "#dc2626",
                  color: "#fff",
                  cursor: deleting ? "not-allowed" : "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {deleting ? "Deleting…" : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}