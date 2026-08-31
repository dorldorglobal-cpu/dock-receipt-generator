import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "";
const f$ = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function EmailOrders() {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [tab, setTab]             = useState("pending"); // pending | approved | rejected
  const [editing, setEditing]     = useState(null);      // EmailOrder being reviewed
  const [saving, setSaving]       = useState(false);
  const [message, setMessage]     = useState("");
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/email-orders?status=${tab}`);
      setItems(await r.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [tab]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await fetch(`${API}/api/email-orders/sync`, { method: "POST" });
      const d = await r.json();
      setMessage(d.pending > 0 ? `Found ${d.pending} pending pickup(s)` : "No new emails found");
      load();
    } catch (e) { setMessage("Sync failed"); }
    setSyncing(false);
  };

  const approve = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/email-orders/${editing._id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setMessage(`Order #${d.order.refNumber} created!`);
      setEditing(null);
      setTab("approved");
      load();
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const reject = async (id) => {
    if (!window.confirm("Reject this pickup email? It will be dismissed.")) return;
    await fetch(`${API}/api/email-orders/${id}/reject`, { method: "POST" });
    load();
  };

  const openEdit = (item) => setEditing({ ...item });
  const f = (k) => (e) => setEditing(prev => ({ ...prev, [k]: e.target.value }));

  const inp = {
    padding: "7px 10px", background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text-primary)", fontSize: 13, width: "100%", boxSizing: "border-box",
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">📧 Email Pickups</h1>
          <p className="page-subtitle">Copart pickup emails auto-parsed into orders</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={sync} disabled={syncing}
            style={{ padding: "9px 18px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            {syncing ? "Checking…" : "🔄 Check Gmail Now"}
          </button>
        </div>
      </div>

      {message && (
        <div style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.4)", borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: "#10b981", fontSize: 13, fontWeight: 600 }}>
          {message}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[["pending","Pending"],["approved","Approved"],["rejected","Rejected"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ padding: "7px 18px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontWeight: tab === k ? 700 : 400,
              background: tab === k ? "var(--accent)" : "var(--bg-panel)", color: tab === k ? "#fff" : "var(--text-secondary)", fontSize: 13 }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 40 }}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
          <p style={{ fontSize: 15, margin: 0 }}>
            {tab === "pending" ? "No pending pickup emails" : `No ${tab} emails`}
          </p>
          {tab === "pending" && (
            <p style={{ fontSize: 13, marginTop: 6, color: "var(--text-muted)" }}>
              Hit "Check Gmail Now" to pull new Copart emails, or wait for the auto-check every 5 minutes.
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {items.map(item => (
            <div key={item._id} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: 16, color: "var(--text-primary)" }}>
                      {item.year} {item.make} {item.model}
                    </span>
                    {item.color && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.color}</span>}
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700,
                      background: item.status === "pending" ? "rgba(245,158,11,0.15)" : item.status === "approved" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                      color: item.status === "pending" ? "#f59e0b" : item.status === "approved" ? "#10b981" : "#ef4444" }}>
                      {item.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "4px 20px", fontSize: 12, color: "var(--text-secondary)" }}>
                    <span>🔖 <strong>Lot:</strong> {item.lot || "—"}</span>
                    <span>🚗 <strong>VIN:</strong> <span style={{ fontFamily: "monospace", letterSpacing: 1 }}>{item.vin || "—"}</span></span>
                    <span>📌 <strong>PIN:</strong> {item.pin || "—"}</span>
                    <span>👤 <strong>Customer:</strong> {item.customerName || "—"}</span>
                    <span>📍 <strong>Pickup:</strong> {[item.pickupCity, item.pickupState].filter(Boolean).join(", ") || item.pickupAddress || "—"}</span>
                    <span>📅 <strong>Sale Date:</strong> {item.saleDate || "—"}</span>
                    {item.orderRef && <span>✅ <strong>Order Ref:</strong> #{item.orderRef}</span>}
                  </div>
                  {item.charges && Object.keys(item.charges).length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
                      {Object.entries(item.charges).map(([k, v]) => (
                        <span key={k} style={{ marginRight: 12 }}>{k}: {f$(v)}</span>
                      ))}
                    </div>
                  )}
                </div>
                {item.status === "pending" && (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button onClick={() => openEdit(item)}
                      style={{ padding: "8px 16px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      Review & Create Order
                    </button>
                    <button onClick={() => reject(item._id)}
                      style={{ padding: "8px 14px", background: "none", border: "1px solid rgba(239,68,68,0.4)", color: "#ef4444", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
                      Dismiss
                    </button>
                  </div>
                )}
                {item.status === "approved" && item.orderId && (
                  <button onClick={() => navigate(`/orders/${item.orderId}`)}
                    style={{ padding: "8px 14px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
                    View Order →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Review / Edit Modal ── */}
      {editing && (
        <div onClick={() => setEditing(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, color: "var(--text-primary)" }}>📋 Review Pickup</h3>
            <p style={{ margin: "0 0 20px", fontSize: 12, color: "var(--text-muted)" }}>Edit any fields before creating the order. The buyer receipt PDF will be attached automatically.</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                ["customerName", "Customer Name"],
                ["year", "Year"],
                ["make", "Make"],
                ["model", "Model"],
                ["color", "Color"],
                ["vin", "VIN"],
                ["lot", "Lot #"],
                ["pin", "Gate Pass PIN"],
                ["pickupAddress", "Pickup Address"],
                ["pickupCity", "Pickup City"],
                ["pickupState", "Pickup State"],
                ["pickupZip", "Pickup ZIP"],
                ["requestType", "Request Type"],
              ].map(([key, label]) => (
                <label key={key} style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", gridColumn: key === "vin" || key === "customerName" || key === "pickupAddress" || key === "notes" ? "1 / -1" : undefined }}>
                  {label}
                  {key === "requestType" ? (
                    <select value={editing[key] || "RORO"} onChange={f(key)} style={{ ...inp, marginTop: 4 }}>
                      <option>RORO</option>
                      <option>Container</option>
                      <option>Inland Only</option>
                    </select>
                  ) : (
                    <input value={editing[key] || ""} onChange={f(key)} style={{ ...inp, marginTop: 4 }} />
                  )}
                </label>
              ))}
              <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", gridColumn: "1 / -1" }}>
                Notes
                <textarea value={editing.notes || ""} onChange={f("notes")} rows={2} style={{ ...inp, marginTop: 4, resize: "vertical" }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
              <button onClick={() => setEditing(null)}
                style={{ padding: "9px 20px", background: "none", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)", cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={approve} disabled={saving}
                style={{ padding: "9px 22px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                {saving ? "Creating…" : "✅ Create Order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
