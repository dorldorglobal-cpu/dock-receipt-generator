import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const f$ = (n) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fD = (d) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const toInput = (d) => d ? new Date(d).toISOString().slice(0, 10) : "";

const PAYMENT_METHODS = ["Bank ACH", "Wire", "Zelle", "Venmo", "Check", "Cash", "Other"];

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

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Invoices() {
  const navigate = useNavigate();

  const [invoices,    setInvoices]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [statusTab,   setStatusTab]   = useState("all");
  const [from,        setFrom]        = useState("");
  const [to,          setTo]          = useState("");
  const [message,     setMessage]     = useState("");
  const [overdue,     setOverdue]     = useState([]);
  const [showOverdue, setShowOverdue] = useState(false);
  const [previewInv,  setPreviewInv]  = useState(null);

  // Payment modal state
  const [payModal,    setPayModal]    = useState(null);  // { inv, editPayment? }
  const [payAmount,   setPayAmount]   = useState("");
  const [payMethod,   setPayMethod]   = useState("Bank ACH");
  const [payDate,     setPayDate]     = useState(todayISO());
  const [payNotes,    setPayNotes]    = useState("");
  const [paySaving,   setPaySaving]   = useState(false);

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

  useEffect(() => {
    fetch(`${API}/api/invoices/overdue`)
      .then(r => r.json())
      .then(d => setOverdue(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [invoices]);

  const handleSearch = (e) => { e.preventDefault(); load(); };

  const downloadPdf = (inv) => window.open(`${API}/api/invoices/${inv._id}/pdf`, "_blank");

  const updateStatus = async (inv, status) => {
    if (!window.confirm(status === "sent" ? "Mark as Sent?" : status === "draft" ? "Revert to Draft?" : "Mark as Paid?")) return;
    try {
      const res  = await fetch(`${API}/api/invoices/${inv._id}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(data.error || "Failed to update"); return; }
      setMessage(`Invoice ${data.invoiceNumber} → ${status}`);
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

  // ── Payment modal helpers ─────────────────────────────────────────────────
  const openAddPayment = (inv) => {
    const paid = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, (inv.total || 0) - paid);
    setPayModal({ inv, editPayment: null });
    setPayAmount(remaining > 0 ? remaining.toFixed(2) : "");
    setPayMethod("Bank ACH");
    setPayDate(todayISO());
    setPayNotes("");
  };

  const openEditPayment = (inv, payment) => {
    setPayModal({ inv, editPayment: payment });
    setPayAmount(String(payment.amount));
    setPayMethod(payment.method || "Bank ACH");
    setPayDate(toInput(payment.date) || todayISO());
    setPayNotes(payment.notes || "");
  };

  const savePayment = async () => {
    if (!payAmount || isNaN(Number(payAmount))) return alert("Enter a valid amount");
    setPaySaving(true);
    try {
      const body = { amount: Number(payAmount), method: payMethod, date: payDate, notes: payNotes };
      const { inv, editPayment } = payModal;
      let url, method;
      if (editPayment) {
        url    = `${API}/api/invoices/${inv._id}/payments/${editPayment._id}`;
        method = "PUT";
      } else {
        url    = `${API}/api/invoices/${inv._id}/payments`;
        method = "POST";
      }
      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMessage(editPayment ? "Payment updated" : `Payment of ${f$(body.amount)} recorded`);
      setPayModal(null);
      load();
    } catch (e) { alert(e.message); }
    setPaySaving(false);
  };

  const deletePayment = async (inv, payment) => {
    if (!window.confirm(`Delete payment of ${f$(payment.amount)}?`)) return;
    try {
      const res = await fetch(`${API}/api/invoices/${inv._id}/payments/${payment._id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setMessage("Payment deleted");
      load();
    } catch (e) { alert(e.message); }
  };

  // ── Summary stats ─────────────────────────────────────────────────────────
  const totalAmount  = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const outstanding  = invoices.filter(i => i.status !== "paid").reduce((s, i) => s + (i.total || 0), 0);
  const paidAmount   = invoices.filter(i => i.status === "paid").reduce((s, i) => s + (i.total || 0), 0);
  const overdueCount = invoices.filter(i => i.status !== "paid" && i.dueDate && new Date(i.dueDate) < new Date()).length;

  const TABS = [
    { key: "all",   label: "All" },
    { key: "draft", label: "Draft" },
    { key: "sent",  label: "Sent" },
    { key: "paid",  label: "Paid" },
  ];

  const inputStyle = {
    padding: "8px 10px", background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text-primary)", fontSize: 13, width: "100%", boxSizing: "border-box",
  };

  return (
    <div>
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1>Invoices</h1>
          <p>Manage and track customer invoices.</p>
        </div>
        {message && <span style={{ fontSize: 13, color: "#34d399" }}>{message}</span>}
      </div>

      {/* ── Overdue Alert Banner ── */}
      {overdue.length > 0 && (
        <div style={{ background:"rgba(220,38,38,0.08)", border:"1px solid rgba(220,38,38,0.35)",
          borderRadius:10, padding:"12px 18px", marginBottom:18, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
          <span style={{ fontSize:18 }}>🚨</span>
          <div style={{ flex:1 }}>
            <strong style={{ color:"#f87171" }}>{overdue.length} overdue invoice{overdue.length !== 1 ? "s" : ""}</strong>
            <span style={{ color:"#9ca3af", fontSize:13, marginLeft:8 }}>
              — {f$(overdue.reduce((s,i) => s + (i.total||0), 0))} outstanding past due date
            </span>
          </div>
          <button onClick={() => setShowOverdue(v => !v)}
            style={{ fontSize:12, padding:"5px 12px", borderRadius:7, border:"1px solid rgba(248,113,113,0.4)",
              background:"none", color:"#f87171", cursor:"pointer", fontWeight:600 }}>
            {showOverdue ? "Hide" : "View All"}
          </button>
          <button onClick={() => setStatusTab("sent")}
            style={{ fontSize:12, padding:"5px 12px", borderRadius:7, border:"none",
              background:"rgba(220,38,38,0.2)", color:"#f87171", cursor:"pointer", fontWeight:600 }}>
            Filter Overdue
          </button>
        </div>
      )}
      {showOverdue && overdue.length > 0 && (
        <div style={{ background:"var(--bg-panel)", border:"1px solid rgba(220,38,38,0.25)", borderRadius:10, padding:16, marginBottom:18 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#f87171", textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>Overdue Invoices</div>
          {overdue.map(inv => (
            <div key={inv._id} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderBottom:"1px solid rgba(255,255,255,0.05)", fontSize:13 }}>
              <span style={{ fontFamily:"monospace", color:"var(--accent)", fontWeight:700, minWidth:120 }}>{inv.invoiceNumber}</span>
              <span style={{ flex:1, color:"var(--text-primary)" }}>{inv.customerName || "—"}</span>
              <span style={{ color:"#f87171", fontSize:11 }}>Due {fD(inv.dueDate)}</span>
              <span style={{ fontFamily:"monospace", fontWeight:700, color:"#f87171" }}>{f$(inv.total)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Summary Chips ── */}
      <div className="dashboard-grid" style={{ marginBottom: 24 }}>
        <div className="dashboard-card">
          <span>Total Invoices</span>
          <strong>{invoices.length}</strong>
        </div>
        <div className="dashboard-card">
          <span>Total Billed</span>
          <strong style={{ color: "var(--accent)" }}>{f$(totalAmount)}</strong>
        </div>
        <div className="dashboard-card">
          <span>Outstanding</span>
          <strong style={{ color: outstanding > 0 ? "#f87171" : "var(--text-primary)" }}>{f$(outstanding)}</strong>
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
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setStatusTab(t.key)} style={{
              padding: "7px 16px", fontSize: 13, border: "none", cursor: "pointer",
              background: statusTab === t.key ? "var(--accent)" : "var(--bg-panel)",
              color:      statusTab === t.key ? "#fff" : "var(--text-secondary)",
              fontWeight: statusTab === t.key ? 600 : 400,
              borderRight: "1px solid var(--border)",
            }}>{t.label}</button>
          ))}
        </div>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 6 }}>
          <div style={{ position: "relative" }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search customer, invoice #, order ref…"
              style={{ fontSize: 13, padding: "7px 32px 7px 10px", width: 260 }} />
            {search && (
              <button type="button" onClick={() => { setSearch(""); load(); }} style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14,
              }}>✕</button>
            )}
          </div>
          <button type="submit" style={{ padding: "7px 14px", fontSize: 13 }}>Search</button>
        </form>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ fontSize: 12, padding: "7px 10px" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ fontSize: 12, padding: "7px 10px" }} />
        {(from || to) && (
          <button onClick={() => { setFrom(""); setTo(""); }} style={{ fontSize: 12, padding: "7px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
            ✕ Clear dates
          </button>
        )}
        <button onClick={load} style={{ fontSize: 12, padding: "7px 14px", fontWeight: 600 }}>Refresh ↻</button>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <p style={{ color: "var(--text-muted)", padding: 32, textAlign: "center" }}>Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
          <p style={{ fontSize: 15, margin: 0 }}>No invoices found</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>Generate an invoice from an order's detail page.</p>
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
                <th>Status / Payments</th>
                <th>Created</th>
                <th>Due</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const isOverdue = inv.status !== "paid" && inv.dueDate && new Date(inv.dueDate) < new Date();
                const payments  = inv.payments || [];
                const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
                const remaining = Math.max(0, (inv.total || 0) - totalPaid);
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
                          cursor: "pointer", fontFamily: "monospace", fontSize: 12, padding: 0, textDecoration: "underline",
                        }}>{inv.orderRef}</button>
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
                      {payments.length > 0 && remaining > 0 && (
                        <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600, marginTop: 1 }}>
                          {f$(remaining)} left
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={inv.status} />
                      {isOverdue && <span style={{ fontSize: 10, color: "#f87171", display: "block", marginTop: 2 }}>Overdue</span>}
                      {/* Payment history */}
                      {payments.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                          {payments.map(p => (
                            <div key={p._id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                              <span style={{ color: "#34d399", fontWeight: 700, fontFamily: "monospace" }}>{f$(p.amount)}</span>
                              <span style={{ color: "var(--text-muted)" }}>{p.method || ""}</span>
                              <span style={{ color: "var(--text-muted)" }}>{fD(p.date)}</span>
                              <button onClick={() => openEditPayment(inv, p)} title="Edit payment"
                                style={{ background: "none", border: "none", cursor: "pointer", color: "#60a5fa", fontSize: 11, padding: "0 2px" }}>✎</button>
                              <button onClick={() => deletePayment(inv, p)} title="Delete payment"
                                style={{ background: "none", border: "none", cursor: "pointer", color: "#f87171", fontSize: 11, padding: "0 2px" }}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{fD(inv.createdAt)}</td>
                    <td style={{ fontSize: 12, color: isOverdue ? "#f87171" : "var(--text-muted)" }}>{fD(inv.dueDate)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                        <button onClick={() => setPreviewInv(inv)} title="Preview invoice"
                          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6,
                            border: "1px solid var(--border)", background: "var(--bg-panel)",
                            color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}>
                          👁 Preview
                        </button>
                        <button onClick={() => downloadPdf(inv)} title="Download PDF"
                          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6,
                            border: "1px solid var(--border)", background: "var(--bg-panel)",
                            color: "var(--text-secondary)", cursor: "pointer" }}>
                          📄 PDF
                        </button>
                        {inv.status === "draft" && (
                          <button onClick={() => updateStatus(inv, "sent")}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "none",
                              background: "rgba(37,99,235,0.15)", color: "#60a5fa", cursor: "pointer", fontWeight: 600 }}>
                            ✈ Mark Sent
                          </button>
                        )}
                        {inv.status !== "paid" && (
                          <button onClick={() => openAddPayment(inv)}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "none",
                              background: "rgba(5,150,105,0.15)", color: "#34d399", cursor: "pointer", fontWeight: 600 }}>
                            💳 Record Payment
                          </button>
                        )}
                        {inv.status === "paid" && (
                          <button onClick={() => openAddPayment(inv)}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "none",
                              background: "rgba(245,158,11,0.12)", color: "#f59e0b", cursor: "pointer", fontWeight: 600 }}>
                            + Add Payment
                          </button>
                        )}
                        {inv.status === "sent" && (
                          <button onClick={() => updateStatus(inv, "draft")}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6,
                              border: "1px solid var(--border)", background: "var(--bg-panel)",
                              color: "var(--text-muted)", cursor: "pointer" }}>
                            ↩ Draft
                          </button>
                        )}
                        <button onClick={() => deleteInvoice(inv)} title="Delete invoice"
                          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "none",
                            background: "rgba(220,38,38,0.12)", color: "#f87171", cursor: "pointer", fontWeight: 600 }}>
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

      {/* ── Payment Modal ── */}
      {payModal && (
        <div onClick={() => setPayModal(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
          zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 14,
            padding: 28, width: "100%", maxWidth: 400,
          }}>
            <h3 style={{ margin: "0 0 20px", color: "var(--text-primary)", fontSize: 17 }}>
              {payModal.editPayment ? "✎ Edit Payment" : "💳 Record Payment"}
            </h3>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
              Invoice <strong style={{ color: "#60a5fa" }}>{payModal.inv.invoiceNumber}</strong>
              {" — Total "}<strong style={{ color: "var(--text-primary)" }}>{f$(payModal.inv.total)}</strong>
              {(() => {
                const payments = payModal.inv.payments || [];
                const paid = payments.reduce((s, p) => s + p.amount, 0);
                const rem  = Math.max(0, (payModal.inv.total || 0) - paid);
                return rem > 0 && !payModal.editPayment
                  ? <span style={{ color: "#f59e0b" }}> · {f$(rem)} remaining</span>
                  : null;
              })()}
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>
                Amount *
                <input type="number" min="0.01" step="0.01" value={payAmount}
                  onChange={e => setPayAmount(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
              </label>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>
                Payment Method
                <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>
                Date
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
              </label>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>
                Notes (optional)
                <input value={payNotes} onChange={e => setPayNotes(e.target.value)}
                  placeholder="e.g. ref #12345" style={{ ...inputStyle, marginTop: 4 }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
              <button onClick={() => setPayModal(null)}
                style={{ padding: "9px 20px", background: "none", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)", cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={savePayment} disabled={paySaving}
                style={{ padding: "9px 22px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                {paySaving ? "Saving…" : payModal.editPayment ? "Save Changes" : "Record Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invoice Preview Modal ── */}
      {previewInv && (
        <div onClick={() => setPreviewInv(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
          zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--bg-elevated)", borderRadius: 16,
            border: "1px solid var(--border)", width: "100%", maxWidth: 560,
            maxHeight: "90vh", overflowY: "auto", padding: "0 0 24px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          }}>
            <div style={{
              background: "#1d3a8a", borderRadius: "16px 16px 0 0",
              padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            }}>
              <div>
                <div style={{ color: "white", fontWeight: 800, fontSize: 18, letterSpacing: "0.03em" }}>DDG GLOBAL LOGISTICS</div>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 }}>International Vehicle Shipping</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "white", fontWeight: 900, fontSize: 22, letterSpacing: "0.08em" }}>INVOICE</div>
                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 2, fontFamily: "monospace" }}>{previewInv.invoiceNumber}</div>
              </div>
            </div>

            <div style={{ padding: "20px 28px 0" }}>
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

              {(previewInv.orderRef || previewInv.vehicle) && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-panel)",
                  border: "1px solid var(--border)", marginBottom: 16, fontSize: 12, color: "var(--text-secondary)" }}>
                  {previewInv.orderRef && <span style={{ marginRight: 16 }}>📋 Order: <strong style={{ color: "var(--accent)" }}>{previewInv.orderRef}</strong></span>}
                  {previewInv.vehicle  && <span style={{ marginRight: 16 }}>🚗 {previewInv.vehicle}</span>}
                  {previewInv.pol && previewInv.pod && <span>🚢 {previewInv.pol} → {previewInv.pod}</span>}
                </div>
              )}

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
                      <td style={{ padding: "9px 12px", fontSize: 13, color: "var(--text-primary)", borderBottom: "1px solid var(--border)" }}>{item.description || "—"}</td>
                      <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 700, textAlign: "right", fontFamily: "monospace", color: "var(--accent)", borderBottom: "1px solid var(--border)" }}>{f$(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "var(--bg-elevated)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 700, fontSize: 12, color: "#9ca3af", borderRadius: "0 0 0 6px" }}>Total Due</td>
                    <td style={{ padding: "10px 12px", fontWeight: 900, fontSize: 18, textAlign: "right", fontFamily: "monospace", color: "white", borderRadius: "0 0 6px 0" }}>{f$(previewInv.total)}</td>
                  </tr>
                </tfoot>
              </table>

              {/* Payment history in preview */}
              {(previewInv.payments || []).length > 0 && (
                <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 8, background: "rgba(5,150,105,0.07)", border: "1px solid rgba(52,211,153,0.2)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#34d399", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Payments Received</div>
                  {(previewInv.payments || []).map(p => (
                    <div key={p._id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                      <span>{fD(p.date)} · {p.method || "—"}{p.notes ? ` · ${p.notes}` : ""}</span>
                      <span style={{ fontWeight: 700, color: "#34d399", fontFamily: "monospace" }}>{f$(p.amount)}</span>
                    </div>
                  ))}
                  {(() => {
                    const paid = (previewInv.payments || []).reduce((s, p) => s + p.amount, 0);
                    const rem  = Math.max(0, (previewInv.total || 0) - paid);
                    return rem > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(52,211,153,0.15)", color: "#f59e0b", fontWeight: 700 }}>
                        <span>Balance Remaining</span>
                        <span style={{ fontFamily: "monospace" }}>{f$(rem)}</span>
                      </div>
                    );
                  })()}
                </div>
              )}

              {previewInv.notes && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-panel)",
                  border: "1px solid var(--border)", marginBottom: 16, fontSize: 12, color: "var(--text-secondary)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Notes</div>
                  {previewInv.notes}
                </div>
              )}

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
