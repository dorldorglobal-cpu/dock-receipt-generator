import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const f$ = (n) => {
  const num = Number(n || 0);
  return (num < 0 ? "-$" : "$") +
    Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fD = (d) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const toInput = (d) => d ? new Date(d).toISOString().slice(0, 10) : "";

const PAYMENT_METHODS = ["Bank ACH", "Wire", "Zelle", "Venmo", "Check", "Cash", "Other"];

const STATUS_STYLES = {
  draft: { bg: "rgba(107,114,128,0.15)", color: "var(--text-secondary)", border: "rgba(107,114,128,0.3)", label: "Draft" },
  sent:  { bg: "rgba(37,99,235,0.15)",   color: "#60a5fa", border: "rgba(96,165,250,0.3)",  label: "Sent" },
  paid:  { bg: "rgba(5,150,105,0.15)",   color: "#34d399", border: "rgba(52,211,153,0.3)",  label: "Paid" },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status?.toLowerCase()] || STATUS_STYLES.draft;
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
  const [search2,     setSearch2]     = useState("");
  const [sortOrderRef, setSortOrderRef] = useState(null); // null | "asc" | "desc"
  const [statusTab,   setStatusTab]   = useState("all");
  const [from,        setFrom]        = useState("");
  const [to,          setTo]          = useState("");
  const [message,     setMessage]     = useState("");
  const [overdue,     setOverdue]     = useState([]);
  const [showOverdue, setShowOverdue] = useState(false);
  const [previewInv,  setPreviewInv]  = useState(null);
  // Client-side filter applied on top of statusTab — "outstanding" and "overdue"
  // don't map to a single invoice status, so they're filtered after fetch.
  const [quickFilter, setQuickFilter] = useState(null); // null | "outstanding" | "overdue"

  // Edit modal state
  const [editModal,   setEditModal]   = useState(null);  // invoice being edited
  const [editItems,   setEditItems]   = useState([]);    // [{ description, amount }]
  const [editNotes,   setEditNotes]   = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editSaving,  setEditSaving]  = useState(false);

  // Bulk selection
  const [selectedIds,   setSelectedIds]   = useState(new Set());
  const [bulkModal,     setBulkModal]     = useState(false);
  const [bulkMethod,    setBulkMethod]    = useState("Bank ACH");
  const [bulkDate,      setBulkDate]      = useState(todayISO());
  const [bulkNotes,     setBulkNotes]     = useState("");
  const [bulkSaving,    setBulkSaving]    = useState(false);

  // Summary-card click filters — resets to the "all" tab (so the full set is
  // loaded) then applies a client-side filter for cards that span statuses.
  const selectCard = (which) => {
    if (which === "all")         { setStatusTab("all");  setQuickFilter(null); }
    else if (which === "paid")   { setStatusTab("paid"); setQuickFilter(null); }
    else if (which === "outstanding") { setStatusTab("all"); setQuickFilter("outstanding"); }
    else if (which === "overdue")     { setStatusTab("all"); setQuickFilter("overdue"); }
  };

  const displayedInvoices = (() => {
    let list = invoices.filter(i => {
      if (quickFilter === "outstanding") return i.status !== "paid";
      if (quickFilter === "overdue")     return i.status !== "paid" && i.dueDate && new Date(i.dueDate) < new Date();
      return true;
    });
    if (search2.trim()) {
      const q = search2.trim().toLowerCase();
      list = list.filter(i =>
        (i.orderRef   || "").toLowerCase().includes(q) ||
        (i.customerName || "").toLowerCase().includes(q) ||
        (i.invoiceNumber || "").toLowerCase().includes(q) ||
        (i.vin         || "").toLowerCase().includes(q) ||
        (i.status      || "").toLowerCase().includes(q)
      );
    }
    if (sortOrderRef) {
      list = [...list].sort((a, b) => {
        const ra = (a.orderRef || "").replace(/\D/g, "") || "0";
        const rb = (b.orderRef || "").replace(/\D/g, "") || "0";
        return sortOrderRef === "asc" ? Number(ra) - Number(rb) : Number(rb) - Number(ra);
      });
    }
    return list;
  })();

  const unpaidInvoices = displayedInvoices.filter(i => i.status !== "paid");
  const allUnpaidSelected = unpaidInvoices.length > 0 && unpaidInvoices.every(i => selectedIds.has(i._id));
  const toggleSelect = (id) => setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll = () => setSelectedIds(allUnpaidSelected ? new Set() : new Set(unpaidInvoices.map(i => i._id)));

  // Remaining balance owed across selected invoices (what "Mark as Paid" will actually record)
  const selectedInvoices = invoices.filter(i => selectedIds.has(i._id));
  const selectedTotal = selectedInvoices.reduce((s, i) => s + (i.total || 0), 0);
  const selectedRemaining = selectedInvoices.reduce((s, i) => {
    const paid = (i.payments || []).reduce((ps, p) => ps + p.amount, 0);
    return s + Math.max(0, (i.total || 0) - paid);
  }, 0);

  const bulkMarkPaid = async () => {
    if (!selectedIds.size) return;
    setBulkSaving(true);
    const ids = [...selectedIds];
    const count = ids.length;
    await Promise.all(ids.map(async id => {
      const inv = invoices.find(i => i._id === id);
      if (!inv) return;
      const remaining = Math.max(0, (inv.total || 0) - (inv.payments || []).reduce((s, p) => s + p.amount, 0));
      // Record payment entry
      if (remaining > 0) {
        await fetch(`${API}/api/invoices/${id}/payments`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: remaining, method: bulkMethod, date: bulkDate, notes: bulkNotes }),
        });
      }
      // Mark as paid
      await fetch(`${API}/api/invoices/${id}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid" }),
      });
    }));
    setSelectedIds(new Set());
    setBulkModal(false);
    setBulkSaving(false);
    setMessage(`${count} invoice(s) marked as Paid`);
    load();
  };

  const [statusModal, setStatusModal] = useState(null); // { inv }
  const [statusSel,   setStatusSel]   = useState("");

  // Payment modal state
  const [payModal,       setPayModal]       = useState(null);  // { inv, editPayment? }
  const [payAmount,      setPayAmount]      = useState("");
  const [payMethod,      setPayMethod]      = useState("Bank ACH");
  const [payDate,        setPayDate]        = useState(todayISO());
  const [payNotes,       setPayNotes]       = useState("");
  const [paySaving,      setPaySaving]      = useState(false);
  const [customerCredit, setCustomerCredit] = useState(0);   // existing credit for this customer
  const [applyCredit,    setApplyCredit]    = useState(false); // user chose to apply credit

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

  // ── Edit invoice modal helpers ────────────────────────────────────────────
  const openEditInvoice = (inv) => {
    setEditModal(inv);
    setEditItems((inv.items || []).map(it => ({ description: it.description || "", amount: String(it.amount ?? "") })));
    setEditNotes(inv.notes || "");
    setEditDueDate(toInput(inv.dueDate));
  };

  const updateEditItem = (index, key, value) =>
    setEditItems(prev => prev.map((it, i) => (i === index ? { ...it, [key]: value } : it)));

  const addEditItem = () => setEditItems(prev => [...prev, { description: "", amount: "" }]);

  const addEditDiscount = () => setEditItems(prev => [...prev, { description: "Discount", amount: "" }]);

  const removeEditItem = (index) => setEditItems(prev => prev.filter((_, i) => i !== index));

  // A "Discount" line entered as a positive number is stored as negative —
  // lets the user just type "100" instead of remembering the minus sign.
  const normalizedAmount = (it) => {
    const amt = Number(it.amount || 0);
    return /discount/i.test(it.description || "") && amt > 0 ? -amt : amt;
  };

  const editTotal = editItems.reduce((s, it) => s + normalizedAmount(it), 0);

  const saveEditInvoice = async () => {
    if (!editModal) return;
    setEditSaving(true);
    try {
      const items = editItems
        .filter(it => it.description.trim() || it.amount !== "")
        .map(it => ({ description: it.description, amount: normalizedAmount(it) }));
      const res  = await fetch(`${API}/api/invoices/${editModal._id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, notes: editNotes, dueDate: editDueDate || null }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(data.error || "Failed to save invoice"); setEditSaving(false); return; }
      setMessage(
        `Invoice ${data.invoiceNumber} updated${data._fileReplaced ? " — order file replaced" : ""}`
      );
      setEditModal(null);
      load();
    } catch (e) {
      setMessage("Failed to save invoice");
    }
    setEditSaving(false);
  };

  // ── Payment modal helpers ─────────────────────────────────────────────────
  const openAddPayment = async (inv) => {
    const paid = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, (inv.total || 0) - paid);
    setPayModal({ inv, editPayment: null });
    setPayAmount(remaining > 0 ? remaining.toFixed(2) : "");
    setPayMethod("Bank ACH");
    setPayDate(todayISO());
    setApplyCredit(false);
    setCustomerCredit(0);
    if (inv.customerName) {
      try {
        const r = await fetch(`${API}/api/invoices/credits/${encodeURIComponent(inv.customerName)}`);
        const d = await r.json();
        setCustomerCredit(d.balance || 0);
      } catch {}
    }
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
      const { inv, editPayment } = payModal;
      const body = {
        amount: Number(payAmount), method: payMethod, date: payDate, notes: payNotes,
        ...(applyCredit && customerCredit > 0 ? { applyCredit: Math.min(customerCredit, Number(payAmount)) } : {}),
      };
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

      const paid = Number(payAmount);
      const prevPaid = (inv.payments || []).reduce((s, p) => s + p.amount, 0);
      const remaining = Math.max(0, (inv.total || 0) - prevPaid);
      const excess = paid - remaining;

      if (!editPayment && excess > 0.005) {
        setMessage(`Payment recorded — ${f$(excess)} credit added to ${inv.customerName}`);
      } else if (!editPayment && applyCredit) {
        setMessage(`Payment recorded with credit applied`);
      } else {
        setMessage(editPayment ? "Payment updated" : `Payment of ${f$(paid)} recorded`);
      }
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
  const outstanding  = invoices.filter(i => i.status?.toLowerCase() !== "paid").reduce((s, i) => s + (i.total || 0), 0);
  const paidAmount   = invoices.filter(i => i.status?.toLowerCase() === "paid").reduce((s, i) => s + (i.total || 0), 0);
  // Sourced from the dedicated /overdue fetch (not the tab-filtered `invoices`
  // list) so the count stays correct no matter which status tab is active.
  const overdueCount = overdue.length;

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
            <span style={{ color:"var(--text-secondary)", fontSize:13, marginLeft:8 }}>
              — {f$(overdue.reduce((s,i) => s + (i.total||0), 0))} outstanding past due date
            </span>
          </div>
          <button onClick={() => setShowOverdue(v => !v)}
            style={{ fontSize:12, padding:"5px 12px", borderRadius:7, border:"1px solid rgba(248,113,113,0.4)",
              background:"none", color:"#f87171", cursor:"pointer", fontWeight:600 }}>
            {showOverdue ? "Hide" : "View All"}
          </button>
          <button onClick={() => selectCard("overdue")}
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

      {/* ── Summary Chips (click to filter the table below) ── */}
      {(() => {
        const isAllActive         = statusTab === "all"  && quickFilter === null;
        const isCollectedActive   = statusTab === "paid" && quickFilter === null;
        const isOutstandingActive = quickFilter === "outstanding";
        const isOverdueActive     = quickFilter === "overdue";
        const activeStyle = { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent) inset" };
        return (
          <div className="dashboard-grid" style={{ marginBottom: 24 }}>
            <div className="dashboard-card" onClick={() => selectCard("all")}
              style={{ cursor: "pointer", ...(isAllActive ? activeStyle : {}) }}>
              <span>Total Invoices</span>
              <strong>{invoices.length}</strong>
            </div>
            <div className="dashboard-card" onClick={() => selectCard("all")}
              style={{ cursor: "pointer", ...(isAllActive ? activeStyle : {}) }}>
              <span>Total Billed</span>
              <strong style={{ color: "var(--accent)" }}>{f$(totalAmount)}</strong>
            </div>
            <div className="dashboard-card" onClick={() => selectCard("outstanding")}
              style={{ cursor: "pointer", ...(isOutstandingActive ? activeStyle : {}) }}>
              <span>Outstanding</span>
              <strong style={{ color: outstanding > 0 ? "#f87171" : "var(--text-primary)" }}>{f$(outstanding)}</strong>
            </div>
            <div className="dashboard-card" onClick={() => selectCard("paid")}
              style={{ cursor: "pointer", ...(isCollectedActive ? activeStyle : {}) }}>
              <span>Collected</span>
              <strong style={{ color: "#34d399" }}>{f$(paidAmount)}</strong>
            </div>
            {overdueCount > 0 && (
              <div className="dashboard-card" onClick={() => selectCard("overdue")} style={{
                cursor: "pointer", borderColor: "rgba(220,38,38,0.4)", background: "rgba(220,38,38,0.05)",
                ...(isOverdueActive ? { boxShadow: "0 0 0 1px #f87171 inset" } : {}),
              }}>
                <span style={{ color: "#f87171" }}>Overdue</span>
                <strong style={{ color: "#f87171" }}>{overdueCount}</strong>
              </div>
            )}
          </div>
        );
      })()}

      {quickFilter && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 12, color: "var(--text-secondary)" }}>
          Showing: <strong style={{ color: "var(--text-primary)" }}>{quickFilter === "overdue" ? "Overdue" : "Outstanding"}</strong>
          <button onClick={() => setQuickFilter(null)} style={{
            fontSize: 11, padding: "2px 9px", borderRadius: 20, border: "1px solid var(--border)",
            background: "var(--bg-panel)", color: "var(--text-muted)", cursor: "pointer",
          }}>✕ Clear</button>
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setStatusTab(t.key); setQuickFilter(null); }} style={{
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
              placeholder="Search customer, invoice #, order ref, VIN…"
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
        {/* Second filter — client-side, instant */}
        <div style={{ position: "relative" }}>
          <input value={search2} onChange={e => setSearch2(e.target.value)}
            placeholder="Filter results…"
            style={{ fontSize: 13, padding: "7px 28px 7px 10px", width: 180 }} />
          {search2 && (
            <button type="button" onClick={() => setSearch2("")} style={{
              position:"absolute", right:6, top:"50%", transform:"translateY(-50%)",
              background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:14,
            }}>✕</button>
          )}
        </div>
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
      ) : displayedInvoices.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
          <p style={{ fontSize: 15, margin: 0 }}>
            {quickFilter ? `No ${quickFilter} invoices` : "No invoices found"}
          </p>
          <p style={{ fontSize: 13, marginTop: 6 }}>
            {quickFilter
              ? <button onClick={() => setQuickFilter(null)} style={{ background:"none", border:"none", color:"var(--accent)", cursor:"pointer", padding:0, fontSize:13, textDecoration:"underline" }}>Clear filter</button>
              : "Generate an invoice from an order's detail page."}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="orders-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width:36, textAlign:"center" }}>
                  <input type="checkbox" checked={allUnpaidSelected} onChange={toggleAll}
                    title={allUnpaidSelected ? "Deselect all" : "Select all unpaid"}
                    style={{ cursor:"pointer", width:15, height:15 }} />
                </th>
                <th>Invoice #</th>
                <th onClick={() => setSortOrderRef(s => s === "asc" ? "desc" : s === "desc" ? null : "asc")}
                  style={{ cursor:"pointer", userSelect:"none", whiteSpace:"nowrap",
                    color: sortOrderRef ? "#a78bfa" : undefined }}>
                  Order Ref {sortOrderRef === "asc" ? "↑" : sortOrderRef === "desc" ? "↓" : "↕"}
                </th>
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
              {displayedInvoices.map(inv => {
                const isOverdue = inv.status !== "paid" && inv.dueDate && new Date(inv.dueDate) < new Date();
                const payments  = inv.payments || [];
                const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
                const remaining = Math.max(0, (inv.total || 0) - totalPaid);
                return (
                  <tr key={inv._id} style={{ background: selectedIds.has(inv._id) ? "rgba(124,58,237,0.07)" : isOverdue ? "rgba(220,38,38,0.04)" : undefined }}>
                    <td style={{ textAlign:"center" }}>
                      {inv.status !== "paid" && (
                        <input type="checkbox" checked={selectedIds.has(inv._id)} onChange={() => toggleSelect(inv._id)}
                          style={{ cursor:"pointer", width:15, height:15 }} />
                      )}
                    </td>
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
                      <button onClick={() => { setStatusModal({ inv }); setStatusSel(inv.status); }}
                        title="Click to change status"
                        style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}>
                        <StatusBadge status={inv.status} />
                      </button>
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
                        <button onClick={() => openEditInvoice(inv)} title="Edit invoice / add discount"
                          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "none",
                            background: "rgba(245,158,11,0.15)", color: "#f59e0b", cursor: "pointer", fontWeight: 600 }}>
                          ✎ Edit
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

      {/* ── Bulk Action Bar ── */}
      {selectedIds.size > 0 && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          background:"var(--bg-panel)", border:"1px solid var(--border)", borderRadius:12,
          padding:"12px 24px", display:"flex", alignItems:"center", gap:16,
          boxShadow:"0 4px 24px rgba(0,0,0,0.35)", zIndex:200, whiteSpace:"nowrap" }}>
          <span style={{ fontWeight:600, color:"var(--text-primary)" }}>
            {selectedIds.size} invoice{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <span style={{ fontWeight:700, fontFamily:"monospace", color:"#34d399", fontSize:15 }}>
            {f$(selectedRemaining)}
            {selectedRemaining !== selectedTotal && (
              <span style={{ fontWeight:400, fontFamily:"inherit", color:"var(--text-muted)", fontSize:11, marginLeft:6 }}>
                (of {f$(selectedTotal)})
              </span>
            )}
          </span>
          <button onClick={() => { setBulkDate(todayISO()); setBulkNotes(""); setBulkModal(true); }}
            style={{ padding:"8px 20px", background:"#059669", border:"none", borderRadius:8,
              color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer" }}>
            ✅ Mark as Paid
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            style={{ padding:"8px 14px", background:"none", border:"1px solid var(--border)",
              borderRadius:8, color:"var(--text-secondary)", cursor:"pointer", fontSize:13 }}>
            Cancel
          </button>
        </div>
      )}

      {/* ── Bulk Mark Paid Modal ── */}
      {bulkModal && (
        <div onClick={() => setBulkModal(false)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.65)",
          zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"var(--bg-panel)", border:"1px solid var(--border)", borderRadius:14,
            padding:28, width:"100%", maxWidth:400,
          }}>
            <h3 style={{ margin:"0 0 6px", color:"var(--text-primary)", fontSize:17 }}>
              ✅ Mark as Paid
            </h3>
            <p style={{ margin:"0 0 20px", fontSize:13, color:"var(--text-secondary)" }}>
              {selectedIds.size} invoice{selectedIds.size !== 1 ? "s" : ""} — remaining balance of{" "}
              <strong style={{ color:"#34d399" }}>{f$(selectedRemaining)}</strong> will be recorded as a payment.
            </p>
            <div style={{ display:"grid", gap:14 }}>
              <label style={{ display:"block", fontSize:12, color:"var(--text-secondary)" }}>
                Payment Method
                <select value={bulkMethod} onChange={e => setBulkMethod(e.target.value)}
                  style={{ display:"block", width:"100%", marginTop:4, padding:"8px 10px",
                    background:"var(--bg-base)", border:"1px solid var(--border)", borderRadius:7,
                    color:"var(--text-primary)", fontSize:13 }}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label style={{ display:"block", fontSize:12, color:"var(--text-secondary)" }}>
                Date Paid
                <input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)}
                  style={{ display:"block", width:"100%", marginTop:4, padding:"8px 10px",
                    background:"var(--bg-base)", border:"1px solid var(--border)", borderRadius:7,
                    color:"var(--text-primary)", fontSize:13, boxSizing:"border-box" }} />
              </label>
              <label style={{ display:"block", fontSize:12, color:"var(--text-secondary)" }}>
                Notes (optional)
                <input value={bulkNotes} onChange={e => setBulkNotes(e.target.value)}
                  placeholder="e.g. batch ref #12345"
                  style={{ display:"block", width:"100%", marginTop:4, padding:"8px 10px",
                    background:"var(--bg-base)", border:"1px solid var(--border)", borderRadius:7,
                    color:"var(--text-primary)", fontSize:13, boxSizing:"border-box" }} />
              </label>
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:22 }}>
              <button onClick={() => setBulkModal(false)}
                style={{ padding:"9px 20px", background:"none", border:"1px solid var(--border)",
                  borderRadius:8, color:"var(--text-secondary)", cursor:"pointer" }}>
                Cancel
              </button>
              <button onClick={bulkMarkPaid} disabled={bulkSaving}
                style={{ padding:"9px 22px", background:"#059669", color:"#fff", border:"none",
                  borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:14, opacity: bulkSaving ? 0.6 : 1 }}>
                {bulkSaving ? "Saving…" : `Mark ${selectedIds.size} as Paid`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Status Change Modal ── */}
      {statusModal && (
        <div onClick={() => setStatusModal(null)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:9999,
            display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:"var(--bg-card)", borderRadius:14, padding:"28px 32px", width:320,
              boxShadow:"0 20px 60px rgba(0,0,0,0.5)", display:"flex", flexDirection:"column", gap:16 }}>
            <h3 style={{ margin:0, fontSize:16 }}>Change Invoice Status</h3>
            <div style={{ fontSize:12, color:"var(--text-muted)" }}>{statusModal.inv.invoiceNumber} — {statusModal.inv.customerName}</div>
            <select value={statusSel} onChange={e => setStatusSel(e.target.value)}
              style={{ padding:"10px 12px", borderRadius:8, border:"1px solid var(--border)",
                background:"var(--bg-input)", color:"var(--text-primary)", fontSize:14, width:"100%" }}>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
            </select>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={async () => {
                  await fetch(`${API}/api/invoices/${statusModal.inv._id}/status`, {
                    method:"PATCH", headers:{"Content-Type":"application/json"},
                    body: JSON.stringify({ status: statusSel }),
                  });
                  setStatusModal(null);
                  load();
                  setMessage(`Invoice ${statusModal.inv.invoiceNumber} → ${statusSel}`);
                }}
                style={{ flex:1, padding:"10px", borderRadius:8, border:"none", background:"#7c3aed",
                  color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                Save
              </button>
              <button onClick={() => setStatusModal(null)}
                style={{ padding:"10px 16px", borderRadius:8, border:"1px solid var(--border)",
                  background:"var(--bg-panel)", color:"var(--text-secondary)", cursor:"pointer" }}>
                Cancel
              </button>
            </div>
          </div>
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
            {/* Credit banner — shown when customer has credit and this is a new payment */}
            {!payModal.editPayment && customerCredit > 0.005 && (
              <div style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.4)",
                borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#10b981" }}>💰 Credit Available</span>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: 8 }}>
                      {payModal.inv.customerName} has <strong style={{ color: "#10b981" }}>{f$(customerCredit)}</strong> on account
                    </span>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={applyCredit} onChange={e => setApplyCredit(e.target.checked)}
                      style={{ cursor: "pointer" }} />
                    Apply credit
                  </label>
                </div>
                {applyCredit && (
                  <div style={{ fontSize: 11, color: "#10b981", marginTop: 6 }}>
                    ✓ Up to {f$(Math.min(customerCredit, Number(payAmount) || 0))} will be deducted from this customer's credit balance
                  </div>
                )}
              </div>
            )}
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

      {/* ── Edit Invoice Modal ── */}
      {editModal && (
        <div onClick={() => !editSaving && setEditModal(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
          zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 14,
            padding: 28, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto",
          }}>
            <h3 style={{ margin: "0 0 4px", color: "var(--text-primary)", fontSize: 17 }}>
              ✎ Edit Invoice
            </h3>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 18 }}>
              <strong style={{ color: "#60a5fa" }}>{editModal.invoiceNumber}</strong> — {editModal.customerName}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {editItems.map((item, index) => (
                <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input value={item.description}
                    onChange={e => updateEditItem(index, "description", e.target.value)}
                    placeholder="Description"
                    style={{ ...inputStyle, flex: 1 }} />
                  <input type="number" step="0.01" value={item.amount}
                    onChange={e => updateEditItem(index, "amount", e.target.value)}
                    placeholder="Amount"
                    style={{ ...inputStyle, width: 110 }} />
                  <button type="button" onClick={() => removeEditItem(index)}
                    style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <button type="button" onClick={addEditItem}
                style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6,
                  border: "1px solid var(--border)", background: "var(--bg-base)",
                  color: "var(--text-secondary)", cursor: "pointer" }}>
                + Add Line Item
              </button>
              <button type="button" onClick={addEditDiscount}
                style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6,
                  border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)",
                  color: "#f59e0b", cursor: "pointer", fontWeight: 600 }}>
                − Add Discount
              </button>
            </div>

            <div style={{ display: "grid", gap: 14, marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>
                Due Date
                <input type="date" value={editDueDate}
                  onChange={e => setEditDueDate(e.target.value)}
                  style={{ ...inputStyle, marginTop: 4 }} />
              </label>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)" }}>
                Notes
                <input value={editNotes} onChange={e => setEditNotes(e.target.value)}
                  style={{ ...inputStyle, marginTop: 4 }} />
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 16px", borderRadius: 8, background: "var(--bg-base)", marginBottom: 20 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>New Total</span>
              <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace",
                color: editTotal < 0 ? "#f87171" : "var(--text-primary)" }}>
                {f$(editTotal)}
              </span>
            </div>

            {editModal.total !== editTotal && (
              <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 16 }}>
                ⚠ Total will change from {f$(editModal.total)} to {f$(editTotal)}. The invoice PDF on the order will be replaced.
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setEditModal(null)} disabled={editSaving}
                style={{ padding: "9px 20px", background: "none", border: "1px solid var(--border)",
                  borderRadius: 8, color: "var(--text-secondary)", cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={saveEditInvoice} disabled={editSaving}
                style={{ padding: "9px 22px", background: "#2563eb", color: "#fff", border: "none",
                  borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14, opacity: editSaving ? 0.6 : 1 }}>
                {editSaving ? "Saving…" : "💾 Save Changes"}
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
                    <td style={{ padding: "10px 12px", fontWeight: 700, fontSize: 12, color: "var(--text-secondary)", borderRadius: "0 0 0 6px" }}>Total Due</td>
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
