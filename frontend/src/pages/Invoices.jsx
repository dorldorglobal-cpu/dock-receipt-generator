import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const f$ = (n) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fD = (d) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const STATUS_STYLES = {
  draft: { bg: "rgba(107,114,128,0.15)", color: "#9ca3af", border: "rgba(107,114,128,0.3)", label: "Draft" },
  sent:  { bg: "rgba(37,99,235,0.15)",   color: "#60a5fa", border: "rgba(96,165,250,0.3)",  label: "Sent" },
  paid:  { bg: "rgba(5,150,105,0.15)",   color: "#34d399", border: "rgba(52,211,153,0.3)",  label: "Paid" },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  );
}

export default function Invoices() {
  const navigate = useNavigate();

  const [invoices,   setInvoices]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [statusTab,  setStatusTab]  = useState("all");
  const [from,       setFrom]       = useState("");
  const [to,         setTo]         = useState("");
  const [message,    setMessage]    = useState("");
  const [previewInv, setPreviewInv] = useState(null); // invoice being previewed

  const load = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (statusTab !== "all") p.set("status", statusTab);
      if (search) p.set("search", search);
      if (from)   p.set("from", from);
      if (to)     p.set("to",   to);
      const res  = await fetch(`${API}/api/invoices?${p}`);
      const data = await res.json();
      setInvoices(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [statusTab]);

  const handleSearch = (e) => {
    e.preventDefault();
    load();
  };

  const downloadPdf = (inv) => {
    window.open(`${API}/api/invoices/${inv._id}/pdf`, "_blank");
  };

  const updateStatus = async (inv, status) => {
    const verb = status === "sent" ? "Mark as Sent?" : status === "paid" ? "Mark as Paid?" : "Revert to Draft?";
    if (!window.confirm(verb)) return;
    try {
      const res  = await fetch(`${API}/api/invoices/${inv._id}/status`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(data.error || "Failed to update"); return; }
      setMessage(`Invoice ${data.invoiceNumber} updated to ${status}`);
      load();
    } catch (e) { setMessage("Update failed"); }
  };

  const deleteInvoice = async (inv) => {
    if (!window.confirm(`Delete invoice ${inv.invoiceNumber}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API}/api/invoices/${inv._id}`, { method: "DELETE" });
      if (!res.ok) { setMessage("Delete failed"); return; }
      setMessage(`Invoice ${inv.invoiceNumber} deleted`);
      load();
    } catch (e) { setMessage("Delete failed"); }
  };

  // ── Summary stats ────────────────────────────────────────────────────────────
  const allInvoices = invoices; // already filtered by server
  const totalAmount     = allInvoices.reduce((s, i) => s + (i.total || 0), 0);
  const outstanding     = allInvoices.filter(i => i.status !== "paid").reduce((s, i) => s + (i.total || 0), 0);
  const paidAmount      = allInvoices.filter(i => i.status === "paid").reduce((s, i) => s + (i.total || 0), 0);
  const sentCount       = allInvoices.filter(i => i.status === "sent").length;
  const overdueCount    = allInvoices.filter(i => i.status !== "paid" && i.dueDate && new Date(i.dueDate) < new Date()).length;

  const TABS = [
    { key: "all",   label: "All" },
    { key: "draft", label: "Draft" },
    { key: "sent",  label: "Sent" },
    { key: "paid",  label: "Paid" },
  ];

  return (
    <div>
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1>Invoices</h1>
          <p>Manage and track customer invoices.</p>
        </div>
        {message && (
          <span style={{ fontSize: 13, color: "#34d399" }}>{message}</span>
        )}
      </div>

      {/* ── Summary Chips ── */}
      <div className="dashboard-grid" style={{ marginBottom: 24 }}>
        <div className="dashboard-card">
          <span>Total Invoices</span>
          <strong>{allInvoices.length}</strong>
        </div>
        <div className="dashboard-card">
          <span>Total Billed</span>
          <strong style={{ color: "var(--accent)" }}>{f$(totalAmount)}</strong>
        </div>
        <div className="dashboard-card">
          <span>Outstanding</span>
          <strong style={{ color: outstanding > 0 ? "#f87171" : "var(--text-primary)" }}>
            {f$(outstanding)}
          </strong>
        </div>
        <div className="dashboard-card">
          <span>Collected</span>
          <strong style={{ color: "#34d399" }}>{f$(paidAmount)}</strong>
        </div>
        {overdueCount > 0 && (
          <div className="dashboard-card" style={{ borderColor: "rgba(220,38,38,0.4)", background: "rgba(220,38,38,0.05)" }}>
            <span style={{ color: "#f87171" }}>Overdue</span>
            <strong style={{ color: "#f87171" }}>{overdueCount}</strong>
          </div>
        )}
      </div>

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>

        {/* Status tabs */}
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setStatusTab(t.key)} style={{
              padding: "7px 16px", fontSize: 13, border: "none", cursor: "pointer",
              background: statusTab === t.key ? "var(--accent)" : "var(--bg-panel)",
              color:      statusTab === t.key ? "#fff" : "var(--text-secondary)",
              fontWeight: statusTab === t.key ? 600 : 400,
              borderRight: "1px solid var(--border)",
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 6 }}>
          <div style={{ position: "relative" }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search customer, invoice #, order ref…"
              style={{ fontSize: 13, padding: "7px 32px 7px 10px", width: 260 }}
            />
            {search && (
              <button type="button" onClick={() => { setSearch(""); load(); }} style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", color: "var(--text-muted)",
                cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0,
              }}>✕</button>
            )}
          </div>
          <button type="submit" style={{ padding: "7px 14px", fontSize: 13 }}>Search</button>
        </form>

        {/* Date range */}
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          style={{ fontSize: 12, padding: "7px 10px" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          style={{ fontSize: 12, padding: "7px 10px" }} />
        {(from || to) && (
          <button onClick={() => { setFrom(""); setTo(""); }} style={{
            fontSize: 12, padding: "7px 10px",
            background: "var(--bg-panel)", border: "1px solid var(--border)",
          }}>✕ Clear dates</button>
        )}
        <button onClick={load} style={{ fontSize: 12, padding: "7px 14px", fontWeight: 600 }}>
          Refresh ↻
        </button>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <p style={{ color: "var(--text-muted)", padding: 32, textAlign: "center" }}>Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "60px 0", color: "var(--text-muted)",
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
          <p style={{ fontSize: 15, margin: 0 }}>No invoices found</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>
            Generate an invoice from an order's detail page.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="orders-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Order Ref</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th>Status</th>
                <th>Created</th>
                <th>Due</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const isOverdue = inv.status !== "paid" && inv.dueDate && new Date(inv.dueDate) < new Date();
                return (
                  <tr key={inv._id} style={{ background: isOverdue ? "rgba(220,38,38,0.04)" : undefined }}>
                    <td>
                      <span style={{ fontWeight: 700, fontFamily: "monospace", color: "var(--accent)", fontSize: 13 }}>
                        {inv.invoiceNumber}
                      </span>
                    </td>
                    <td>
                      {inv.orderRef ? (
                        <button onClick={() => navigate(`/orders/${inv.orderId}`)} style={{
                          background: "none", border: "none", color: "var(--accent)",
                          cursor: "pointer", fontFamily: "monospace", fontSize: 12, padding: 0,
                          textDecoration: "underline",
                        }}>
                          {inv.orderRef}
                        </button>
                      ) : "—"}
                    </td>
                    <td style={{ fontWeight: 600 }}>{inv.customerName || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {inv.vehicle || "—"}
                      {inv.vin && (
                        <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                          ···{inv.vin.slice(-6).toUpperCase()}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, fontFamily: "monospace" }}>
                      {f$(inv.total)}
                    </td>
                    <td>
                      <StatusBadge status={inv.status} />
                      {isOverdue && (
                        <span style={{ fontSize: 10, color: "#f87171", display: "block", marginTop: 2 }}>
                          Overdue
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{fD(inv.createdAt)}</td>
                    <td style={{ fontSize: 12, color: isOverdue ? "#f87171" : "var(--text-muted)" }}>
                      {fD(inv.dueDate)}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                        {/* Preview */}
                        <button onClick={() => setPreviewInv(inv)} title="Preview invoice"
                          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6,
                            border: "1px solid var(--border)", background: "var(--bg-panel)",
                            color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}>
                          👁 Preview
                        </button>

                        {/* Download PDF */}
                        <button onClick={() => downloadPdf(inv)} title="Download PDF"
                          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6,
                            border: "1px solid var(--border)", background: "var(--bg-panel)",
                            color: "var(--text-secondary)", cursor: "pointer" }}>
                          📄 PDF
                        </button>

                        {/* Mark Sent (if draft) */}
                        {inv.status === "draft" && (
                          <button onClick={() => updateStatus(inv, "sent")}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "none",
                              background: "rgba(37,99,235,0.15)", color: "#60a5fa",
                              cursor: "pointer", fontWeight: 600 }}>
                            ✈ Mark Sent
                          </button>
                        )}

                        {/* Mark Paid (if draft or sent) */}
                        {inv.status !== "paid" && (
                          <button onClick={() => updateStatus(inv, "paid")}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "none",
                              background: "rgba(5,150,105,0.15)", color: "#34d399",
                              cursor: "pointer", fontWeight: 600 }}>
                            ✓ Mark Paid
                          </button>
                        )}

                        {/* Revert to draft (if sent) */}
                        {inv.status === "sent" && (
                          <button onClick={() => updateStatus(inv, "draft")}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6,
                              border: "1px solid var(--border)", background: "var(--bg-panel)",
                              color: "var(--text-muted)", cursor: "pointer" }}>
                            ↩ Draft
                          </button>
                        )}

                        {/* Delete */}
                        <button onClick={() => deleteInvoice(inv)} title="Delete invoice"
                          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "none",
                            background: "rgba(220,38,38,0.12)", color: "#f87171",
                            cursor: "pointer", fontWeight: 600 }}>
                          🗑 Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Invoice Preview Modal ── */}
      {previewInv && (
        <div onClick={() => setPreviewInv(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
          zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--bg-elevated)", borderRadius: 16,
            border: "1px solid var(--border)", width: "100%", maxWidth: 560,
            maxHeight: "90vh", overflowY: "auto", padding: "0 0 24px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          }}>
            {/* Header bar */}
            <div style={{
              background: "#1d3a8a", borderRadius: "16px 16px 0 0",
              padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            }}>
              <div>
                <div style={{ color: "white", fontWeight: 800, fontSize: 18, letterSpacing: "0.03em" }}>
                  DDG GLOBAL LOGISTICS
                </div>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 }}>
                  International Vehicle Shipping
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "white", fontWeight: 900, fontSize: 22, letterSpacing: "0.08em" }}>INVOICE</div>
                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 2, fontFamily: "monospace" }}>
                  {previewInv.invoiceNumber}
                </div>
              </div>
            </div>

            <div style={{ padding: "20px 28px 0" }}>
              {/* Meta row */}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Bill To</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>{previewInv.customerName || "—"}</div>
                  {previewInv.customerPhone && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>📞 {previewInv.customerPhone}</div>}
                  {previewInv.customerEmail && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>✉ {previewInv.customerEmail}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Details</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Date: <strong>{fD(previewInv.createdAt)}</strong></div>
                  {previewInv.dueDate && <div style={{ fontSize: 12, color: "#f87171", marginTop: 2 }}>Due: <strong>{fD(previewInv.dueDate)}</strong></div>}
                  <div style={{ marginTop: 6 }}><StatusBadge status={previewInv.status} /></div>
                </div>
              </div>

              {/* Order info */}
              {(previewInv.orderRef || previewInv.vehicle) && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-panel)",
                  border: "1px solid var(--border)", marginBottom: 16, fontSize: 12, color: "var(--text-secondary)" }}>
                  {previewInv.orderRef && <span style={{ marginRight: 16 }}>📋 Order: <strong style={{ color: "var(--accent)" }}>{previewInv.orderRef}</strong></span>}
                  {previewInv.vehicle  && <span style={{ marginRight: 16 }}>🚗 {previewInv.vehicle}</span>}
                  {previewInv.pol && previewInv.pod && <span>🚢 {previewInv.pol} → {previewInv.pod}</span>}
                </div>
              )}

              {/* Items table */}
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                <thead>
                  <tr style={{ background: "#1d3a8a" }}>
                    <th style={{ textAlign: "left", padding: "8px 12px", color: "white", fontSize: 11, fontWeight: 700, borderRadius: "6px 0 0 0" }}>Description</th>
                    <th style={{ textAlign: "right", padding: "8px 12px", color: "white", fontSize: 11, fontWeight: 700, borderRadius: "0 6px 0 0" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(previewInv.items || []).map((item, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "var(--bg-panel)" : "transparent" }}>
                      <td style={{ padding: "9px 12px", fontSize: 13, color: "var(--text-primary)", borderBottom: "1px solid var(--border)" }}>
                        {item.description || "—"}
                      </td>
                      <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 700, textAlign: "right", fontFamily: "monospace", color: "var(--accent)", borderBottom: "1px solid var(--border)" }}>
                        {f$(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#111827" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 700, fontSize: 12, color: "#9ca3af", borderRadius: "0 0 0 6px" }}>Total Due</td>
                    <td style={{ padding: "10px 12px", fontWeight: 900, fontSize: 18, textAlign: "right", fontFamily: "monospace", color: "white", borderRadius: "0 0 6px 0" }}>
                      {f$(previewInv.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Notes */}
              {previewInv.notes && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-panel)",
                  border: "1px solid var(--border)", marginBottom: 16, fontSize: 12,
                  color: "var(--text-secondary)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Notes</div>
                  {previewInv.notes}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                <button onClick={() => setPreviewInv(null)}
                  style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid var(--border)",
                    background: "var(--bg-panel)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>
                  Close
                </button>
                <button onClick={() => downloadPdf(previewInv)}
                  style={{ padding: "8px 18px", borderRadius: 8, border: "none",
                    background: "#2563eb", color: "white", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                  📄 Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
