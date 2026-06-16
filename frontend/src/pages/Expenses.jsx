import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";


const CATEGORIES = [
  "Towing / Transport",
  "Ocean Freight",
  "Port / Terminal Fees",
  "Loaders & Warehouses",
  "Software",
  "Legal Fees",
  "Office & Admin",
  "General Overhead",
];

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

function fmt$(n) {
  if (n == null) return "$0.00";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_FORM = {
  category: "",
  description: "",
  vendor: "",
  amount: "",
  date: todayISO(),
  orderRef: "",
  invoiceNumber: "",
  status: "unpaid",
  paidDate: "",
  notes: "",
};

// ── DropZone ──────────────────────────────────────────────────────────────────
function DropZone({ label, file, setFile, existingUrl, existingName, onRemoveExisting, accept = "image/*,.pdf", hint }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef(null);
  const hasNew  = !!file;
  const hasOld  = !hasNew && !!existingUrl;

  return (
    <div>
      {label && <div style={{ fontSize:12, color:"#9ca3af", marginBottom:5 }}>{label}</div>}
      <div
        onClick={() => ref.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
        style={{
          border: `2px dashed ${drag ? "#60a5fa" : (hasNew||hasOld) ? "#34d399" : "#374151"}`,
          borderRadius: 8, padding: "12px 14px", textAlign: "center",
          cursor: "pointer", transition: "all 0.15s", minHeight: 72,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 4,
          background: drag ? "rgba(96,165,250,0.07)" : (hasNew||hasOld) ? "rgba(52,211,153,0.05)" : "#111827",
        }}
      >
        <input ref={ref} type="file" accept={accept} style={{ display:"none" }}
          onChange={e => setFile(e.target.files[0] || null)} />
        {hasNew ? (
          <>
            <span style={{ fontSize:13, color:"#34d399" }}>📎 {file.name}</span>
            <span style={{ fontSize:11, color:"#6b7280" }}>{(file.size/1024).toFixed(0)} KB</span>
            <button type="button" onClick={e => { e.stopPropagation(); setFile(null); }}
              style={{ fontSize:11, color:"#f87171", background:"none", border:"none", cursor:"pointer", padding:0, marginTop:2 }}>
              Remove
            </button>
          </>
        ) : hasOld ? (
          <>
            <a href={existingUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ fontSize:13, color:"#60a5fa", textDecoration:"none" }}>
              📎 {existingName || "View file"}
            </a>
            <div style={{ display:"flex", gap:12, marginTop:4 }}>
              <button type="button" onClick={e => { e.stopPropagation(); ref.current?.click(); }}
                style={{ fontSize:11, color:"#9ca3af", background:"none", border:"none", cursor:"pointer", padding:0 }}>
                Replace
              </button>
              {onRemoveExisting && (
                <button type="button" onClick={e => { e.stopPropagation(); onRemoveExisting(); }}
                  style={{ fontSize:11, color:"#f87171", background:"none", border:"none", cursor:"pointer", padding:0 }}>
                  Remove
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <span style={{ fontSize:22 }}>📂</span>
            <span style={{ fontSize:12, color:"#9ca3af" }}>{hint || "Drop file or click to browse"}</span>
            <span style={{ fontSize:11, color:"#4b5563" }}>PDF · JPG · PNG up to 20 MB</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  useEffect(() => {
    const handler = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: "#1e2433", borderRadius: 12, padding: 28,
        width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: "#f1f5f9" }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Expense Form ──────────────────────────────────────────────────────────────
function ExpenseForm({ form, setForm, onSubmit, saving,
  receiptFile, setReceiptFile, existingReceipt, onRemoveReceipt,
  billFile,    setBillFile,    existingBill,    onRemoveBill,
  vendors = [] }) {
  const inp = (key) => ({
    value: form[key] ?? "",
    onChange: (e) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const inputStyle = {
    width: "100%", padding: "8px 10px", background: "#111827",
    border: "1px solid #374151", borderRadius: 6, color: "#f1f5f9",
    fontSize: 13, boxSizing: "border-box", marginTop: 4,
  };
  const labelStyle = { display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 2 };

  return (
    <form onSubmit={onSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

        {/* Category */}
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Category *
          <select {...inp("category")} required style={inputStyle}>
            <option value="">Select category…</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        {/* Description */}
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Description *
          <input {...inp("description")} required style={inputStyle} placeholder="e.g. Towing – VIN 1HGCV1F3XJA123456" />
        </label>

        {/* Vendor */}
        <label style={labelStyle}>
          Vendor / Paid To
          <input
            {...inp("vendor")}
            list="vendor-list"
            style={inputStyle}
            placeholder="Type or select a vendor…"
            autoComplete="off"
          />
          {vendors.length > 0 && (
            <datalist id="vendor-list">
              {vendors.map(v => (
                <option key={v._id} value={v.name}>
                  {v.category ? `${v.name} — ${v.category}` : v.name}
                </option>
              ))}
            </datalist>
          )}
        </label>

        {/* Amount */}
        <label style={labelStyle}>
          Amount ($) *
          <input
            type="number" min="0" step="0.01" required
            {...inp("amount")} style={inputStyle} placeholder="0.00"
          />
        </label>

        {/* Date */}
        <label style={labelStyle}>
          Expense Date *
          <input type="date" {...inp("date")} required style={inputStyle} />
        </label>

        {/* Order Ref */}
        <label style={labelStyle}>
          Order # (optional)
          <input {...inp("orderRef")} style={inputStyle} placeholder="e.g. 30979" />
        </label>

        {/* Invoice Number */}
        <label style={labelStyle}>
          Invoice # (optional)
          <input {...inp("invoiceNumber")} style={inputStyle} placeholder="e.g. INV-0042" />
        </label>

        {/* Status */}
        <label style={labelStyle}>
          Payment Status
          <select {...inp("status")} style={inputStyle}>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
          </select>
        </label>

        {/* Paid Date */}
        {form.status === "paid" && (
          <label style={labelStyle}>
            Date Paid
            <input type="date" {...inp("paidDate")} style={inputStyle} />
          </label>
        )}

        {/* Notes */}
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Notes
          <textarea {...inp("notes")} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Optional notes…" />
        </label>

        {/* File attachments */}
        <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <DropZone
            label="Bill / Invoice Document"
            hint="Drop the vendor's invoice or bill"
            file={billFile} setFile={setBillFile}
            existingUrl={existingBill ? `${API}/api/expenses/${existingBill._id}/bill` : null}
            existingName="View bill"
            onRemoveExisting={onRemoveBill}
          />
          <DropZone
            label="Payment Receipt / Proof"
            hint="Drop proof of payment"
            file={receiptFile} setFile={setReceiptFile}
            existingUrl={existingReceipt ? `${API}/api/expenses/${existingReceipt._id}/receipt` : null}
            existingName="View receipt"
            onRemoveExisting={onRemoveReceipt}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
        <button type="submit" disabled={saving} style={{
          background: "#3b82f6", color: "#fff", border: "none", borderRadius: 7,
          padding: "9px 22px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? "Saving…" : "Save Expense"}
        </button>
      </div>
    </form>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Expenses() {
  const navigate = useNavigate();
  const [expenses, setExpenses]     = useState([]);
  const [summary, setSummary]       = useState(null);
  const [vendors, setVendors]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [filterCat, setFilterCat]   = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [dateFrom, setDateFrom]     = useState("");
  const [dateTo, setDateTo]         = useState("");
  const [showModal, setShowModal]   = useState(false);
  const [editing, setEditing]       = useState(null); // null = add, else expense obj
  const [form, setForm]             = useState(EMPTY_FORM);
  const [receiptFile, setReceiptFile] = useState(null);
  const [billFile, setBillFile]       = useState(null);
  const [saving, setSaving]         = useState(false);
  const [activeFilter, setActiveFilter] = useState(null); // "unpaid" | "paid"
  const [sortKey, setSortKey]       = useState("date");
  const [sortDir, setSortDir]       = useState(-1);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ── Pay Bills mode ────────────────────────────────────────────────────────────
  const [payMode, setPayMode]           = useState(false);
  const [selected, setSelected]         = useState({}); // { [_id]: true }
  const [payDate, setPayDate]           = useState(todayISO());
  const [payMethod, setPayMethod]       = useState("Bank ACH");
  const [paying, setPaying]             = useState(false);

  const toggleSelect = (id) => setSelected(s => ({ ...s, [id]: !s[id] }));
  const selectedIds  = Object.keys(selected).filter(id => selected[id]);
  const selectedTotal = expenses.filter(e => selected[e._id]).reduce((sum, e) => sum + (e.amount || 0), 0);
  const selectedByVendor = expenses.filter(e => selected[e._id]).reduce((acc, e) => {
    const v = e.vendor || "Unknown";
    acc[v] = (acc[v] || 0) + (e.amount || 0);
    return acc;
  }, {});

  const selectedExpenses = expenses.filter(e => selected[e._id]);
  const allSelectedPaid   = selectedExpenses.length > 0 && selectedExpenses.every(e => e.status === "paid");
  const allSelectedUnpaid = selectedExpenses.length > 0 && selectedExpenses.every(e => e.status === "unpaid");
  const mixedSelection    = selectedExpenses.length > 0 && !allSelectedPaid && !allSelectedUnpaid;

  const bulkAction = async (action) => {
    if (!selectedIds.length) return;
    const label = action === "unpay" ? "unpaid" : `paid via ${payMethod}`;
    if (!window.confirm(`Mark ${selectedIds.length} bill(s) as ${label}?`)) return;
    setPaying(true);
    try {
      const res = await fetch(`${API}/api/expenses/bulk-pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, paidDate: payDate, paymentMethod: payMethod, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Optimistically update local state immediately
      setExpenses(prev => prev.map(e => {
        if (!selectedIds.includes(e._id)) return e;
        if (action === "unpay") return { ...e, status: "unpaid", paidDate: null, paymentMethod: "" };
        return { ...e, status: "paid", paidDate: payDate, paymentMethod: payMethod };
      }));
      setSelected({});
      setFilterStatus(""); // triggers useEffect → fresh fetchAll with no filter
    } catch (err) {
      window.alert("Failed: " + err.message);
    } finally {
      setPaying(false);
    }
  };

  // ── Bill import state ────────────────────────────────────────────────────────
  const [importTab, setImportTab]         = useState("sallaum"); // "sallaum" | "dispatch"

  // Shared manual entry form (used by all 4 cards)
  const [showManualForm, setShowManualForm] = useState(null); // "sallaum"|"acl"|"dispatch"|"other"|null
  const [manualForm, setManualForm]         = useState({ vendor: "", amount: "", date: todayISO(), category: "Towing / Transport", orderRef: "", vin: "", invoiceNumber: "", description: "" });
  const [manualFile, setManualFile]         = useState(null);
  const [manualSaving, setManualSaving]     = useState(false);
  const [manualMsg, setManualMsg]           = useState("");
  const [extraLines, setExtraLines]         = useState([]); // [{ description, amount }]

  const CARD_DEFAULTS = {
    sallaum:  { vendor: "Sallaum Lines",   category: "Ocean Freight",        color: "#3b82f6" },
    acl:      { vendor: "Grimaldi / ACL",  category: "Ocean Freight",        color: "#8b5cf6" },
    dispatch: { vendor: "",                category: "Towing / Transport",   color: "#f59e0b" },
    other:    { vendor: "",                category: "Towing / Transport",   color: "#10b981" },
  };

  const lookupOrderByVin = async (vin) => {
    if (!vin || vin.length !== 17) return;
    try {
      const res  = await fetch(`${API}/api/orders?search=${encodeURIComponent(vin)}`);
      const data = await res.json();
      const match = Array.isArray(data) ? data.find(o => o.vin?.toUpperCase() === vin.toUpperCase()) : null;
      if (match) {
        setManualForm(f => ({ ...f, orderRef: match.refNumber, vin: vin.toUpperCase() }));
        setManualMsg(`✅ Linked to order #${match.refNumber} — ${match.year || ""} ${match.make || ""} ${match.model || ""}`.trim());
      }
    } catch {}
  };

  const openManualForm = (type) => {
    const defaults = CARD_DEFAULTS[type];
    setManualForm({ vendor: defaults.vendor, amount: "", date: todayISO(), category: defaults.category, orderRef: "", vin: "", invoiceNumber: "", description: "" });
    setManualFile(null);
    setManualMsg("");
    setExtraLines([]);
    setShowManualForm(type);
  };

  const submitManualBill = async () => {
    if (!manualForm.vendor || !manualForm.amount) return;
    setManualSaving(true);
    setManualMsg("");
    try {
      // Save main line
      const fd = new FormData();
      fd.append("category",      manualForm.category);
      fd.append("description",   manualForm.description || manualForm.vendor);
      fd.append("vendor",        manualForm.vendor);
      fd.append("amount",        manualForm.amount);
      fd.append("date",          manualForm.date);
      fd.append("orderRef",      manualForm.orderRef || "");
      fd.append("vin",           manualForm.vin || "");
      fd.append("invoiceNumber", manualForm.invoiceNumber || "");
      fd.append("status",        "unpaid");
      const validExtras = extraLines.filter(l => l.description.trim() && Number(l.amount) > 0);
      if (validExtras.length) fd.append("lineItems", JSON.stringify(validExtras));
      if (manualFile) fd.append("bill", manualFile);
      const res = await fetch(`${API}/api/expenses`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setManualMsg(`✅ Expense added${validExtras.length ? ` + ${validExtras.length} line${validExtras.length > 1 ? "s" : ""}` : ""}!`);
      setTimeout(() => { setShowManualForm(null); setManualMsg(""); setExtraLines([]); }, 1200);
      fetchAll();
    } catch (err) {
      setManualMsg("❌ " + err.message);
    } finally {
      setManualSaving(false);
    }
  };

  // Legacy aliases (keep old Other form working)
  const showOtherForm  = showManualForm === "other";
  const setShowOtherForm = (v) => setShowManualForm(v ? "other" : null);
  const otherForm      = manualForm;
  const setOtherForm   = setManualForm;
  const otherFile      = manualFile;
  const setOtherFile   = setManualFile;
  const otherSaving    = manualSaving;
  const otherMsg       = manualMsg;
  const submitOtherBill = submitManualBill;

  // ── Misc auto-parse state ─────────────────────────────────────────────────────
  const [miscResults, setMiscResults]     = useState([]);
  const [miscLoading, setMiscLoading]     = useState(false);
  const [miscMsg, setMiscMsg]             = useState("");

  const parseMiscBills = async (files) => {
    setMiscLoading(true); setMiscMsg(""); setMiscResults([]);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("invoices", f));
      const res = await fetch(`${API}/api/expenses/parse-misc`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMiscResults(data.results);
      const unmatched = data.results.filter(r => !r.matched && !r.error).length;
      setMiscMsg(unmatched > 0 ? `⚠ ${unmatched} invoice(s) not matched to an order.` : `✅ ${data.results.length} invoice(s) parsed.`);
    } catch (err) { setMiscMsg("❌ " + err.message); }
    finally { setMiscLoading(false); }
  };

  const applyMiscBills = async () => {
    setMiscLoading(true);
    try {
      const res = await fetch(`${API}/api/expenses/apply-misc`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: miscResults }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMiscMsg(`✅ ${data.created} expense(s) created!`);
      setMiscResults([]); fetchAll();
    } catch (err) { setMiscMsg("❌ " + err.message); }
    finally { setMiscLoading(false); }
  };

  // ── Payment Proof (bank ACH confirmation) import state ───────────────────────
  const [proofFile,        setProofFile]        = useState(null); // the dropped File object
  const [proofDriveFile,   setProofDriveFile]    = useState(null); // { fname, driveId, driveUrl } once uploaded
  const [proofRows,        setProofRows]         = useState([]);
  const [proofLoading,     setProofLoading]      = useState(false);
  const [proofMsg,         setProofMsg]          = useState("");

  const parseProofFile = async (file) => {
    setProofLoading(true); setProofMsg(""); setProofRows([]); setProofDriveFile(null);
    try {
      const fd = new FormData();
      fd.append("proof", file);
      const res = await fetch(`${API}/api/expenses/parse-payment-proof`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProofRows(data.rows);
      setProofDriveFile(data.proofFile || null);
      const needsReview = data.rows.filter(r => r.matchType !== "exact" && r.matchType !== "combined").length;
      setProofMsg(needsReview > 0
        ? `⚠ ${needsReview} of ${data.rows.length} payment(s) need manual review.`
        : `✅ ${data.rows.length} payment(s) auto-matched.`);
    } catch (err) { setProofMsg("❌ " + err.message); }
    finally { setProofLoading(false); }
  };

  const applyProofRows = async () => {
    setProofLoading(true);
    try {
      const res = await fetch(`${API}/api/expenses/apply-payment-proof`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: proofRows, paymentMethod: "Bank ACH", proofFile: proofDriveFile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProofMsg(`✅ ${data.updated} bill(s) marked paid!`);
      setProofRows([]); setProofFile(null); setProofDriveFile(null); fetchAll();
    } catch (err) { setProofMsg("❌ " + err.message); }
    finally { setProofLoading(false); }
  };

  // ── Sallaum import state ─────────────────────────────────────────────────────
  const [sallaumFile, setSallaumFile]     = useState(null);
  const [sallaumParsed, setSallaumParsed] = useState(null); // { invoiceNumber, voyage, vessel, pol, pod, rows }
  const [sallaumRows, setSallaumRows]     = useState([]);   // local editable copy
  const [sallaumLoading, setSallaumLoading] = useState(false);
  const [sallaumMsg, setSallaumMsg]       = useState("");

  const parseSallaumBillFile = async (file) => {
    if (!file) return;
    setSallaumLoading(true);
    setSallaumMsg("");
    setSallaumParsed(null);
    try {
      const fd = new FormData();
      fd.append("invoice", file);
      const res = await fetch(`${API}/api/expenses/parse-sallaum`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");
      setSallaumParsed(data);
      setSallaumRows(data.rows.map(r => ({ ...r, skip: false })));
      const unmatched = data.rows.filter(r => !r.matched).length;
      setSallaumMsg(unmatched > 0 ? `⚠ ${unmatched} VIN(s) not matched to any order — review below.` : "");
    } catch (err) {
      setSallaumMsg("❌ " + err.message);
    } finally {
      setSallaumLoading(false);
    }
  };

  const applySallaumBill = async () => {
    if (!sallaumParsed) return;
    const toApply = sallaumRows.filter(r => !r.skip);
    if (toApply.length === 0) { setSallaumMsg("No rows to apply."); return; }
    setSallaumLoading(true);
    try {
      const res = await fetch(`${API}/api/expenses/apply-sallaum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sallaumParsed, rows: sallaumRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply failed");
      setSallaumMsg(`✅ ${data.created} expense(s) created successfully!`);
      setSallaumParsed(null);
      setSallaumRows([]);
      setSallaumFile(null);
      fetchAll();
    } catch (err) {
      setSallaumMsg("❌ " + err.message);
    } finally {
      setSallaumLoading(false);
    }
  };

  // ── Dispatch import state ─────────────────────────────────────────────────────
  const [dispatchFiles, setDispatchFiles]   = useState([]);
  const [dispatchRows, setDispatchRows]     = useState([]);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchMsg, setDispatchMsg]       = useState("");

  // Auto-load dispatch parse result passed from order docs
  useEffect(() => {
    const stored = sessionStorage.getItem("dispatchParseResult");
    if (!stored) return;
    sessionStorage.removeItem("dispatchParseResult");
    try {
      const { rows, orderRef, orderId } = JSON.parse(stored);
      if (rows && rows.length) {
        // Each row from parse-dispatch already has billFileName etc; inject orderRef if missing
        const enriched = rows.flatMap(r => (r.rows || [r]).map(row => ({
          ...row,
          orderRef: row.orderRef || orderRef || "",
          orderId:  row.orderId  || orderId  || null,
          matched:  !!(row.orderId || orderId),
        })));
        setDispatchRows(enriched);
        setDispatchMsg(`📋 Dispatch sheet imported from order ${orderRef || ""} — review and create expenses.`);
        // Scroll to dispatch section
        setTimeout(() => document.getElementById("dispatch-section")?.scrollIntoView({ behavior:"smooth" }), 300);
      }
    } catch(e) { console.error("dispatch import error", e); }
  }, []);

  const parseDispatchBills = async (files) => {
    if (!files || files.length === 0) return;
    setDispatchLoading(true);
    setDispatchMsg("");
    setDispatchRows([]);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("invoices", f));
      const res = await fetch(`${API}/api/expenses/parse-dispatch`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");
      setDispatchRows(data.rows);
      const unmatched = data.rows.filter(r => !r.matched && !r.error).length;
      setDispatchMsg(unmatched > 0 ? `⚠ ${unmatched} VIN(s) not matched to any order.` : `✅ ${data.rows.length} dispatch sheet(s) parsed.`);
    } catch (err) {
      setDispatchMsg("❌ " + err.message);
    } finally {
      setDispatchLoading(false);
    }
  };

  const applyDispatchBills = async () => {
    const toApply = dispatchRows.filter(r => !r.skip && (r.matched || r.orderRef));
    if (toApply.length === 0) { setDispatchMsg("No matched rows to apply."); return; }
    // Capture the source order ID before clearing rows
    const sourceOrderId = dispatchRows.find(r => r.orderId)?.orderId || null;
    setDispatchLoading(true);
    try {
      const res = await fetch(`${API}/api/expenses/apply-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: dispatchRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply failed");
      setDispatchRows([]);
      setDispatchFiles([]);
      fetchAll();
      // Go back to the order if this came from one
      if (sourceOrderId) {
        navigate(`/orders/${sourceOrderId}`);
      } else {
        setDispatchMsg(`✅ ${data.created} expense(s) created!`);
      }
    } catch (err) {
      setDispatchMsg("❌ " + err.message);
    } finally {
      setDispatchLoading(false);
    }
  };

  // ── Container import state ────────────────────────────────────────────────────
  const [containerFiles, setContainerFiles]   = useState([]);
  const [containerResults, setContainerResults] = useState([]);
  const [containerLoading, setContainerLoading] = useState(false);
  const [containerMsg, setContainerMsg]         = useState("");

  const parseContainerBills = async (files) => {
    setContainerLoading(true);
    setContainerMsg("");
    setContainerResults([]);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("invoices", f));
      const res = await fetch(`${API}/api/expenses/parse-container`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setContainerResults(data.results);
      const unmatched = data.results.flatMap(r => r.rows || []).filter(r => !r.matched).length;
      setContainerMsg(unmatched > 0 ? `⚠ ${unmatched} VIN(s) not matched.` : `✅ ${data.results.length} invoice(s) parsed.`);
    } catch (err) {
      setContainerMsg("❌ " + err.message);
    } finally {
      setContainerLoading(false);
    }
  };

  const applyContainerBills = async () => {
    setContainerLoading(true);
    try {
      const res = await fetch(`${API}/api/expenses/apply-container`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: containerResults }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setContainerMsg(`✅ ${data.created} expense(s) created!`);
      setContainerResults([]);
      setContainerFiles([]);
      fetchAll();
    } catch (err) {
      setContainerMsg("❌ " + err.message);
    } finally {
      setContainerLoading(false);
    }
  };

  // ── ACL import state ──────────────────────────────────────────────────────────
  const [aclFiles, setAclFiles]       = useState([]);
  const [aclRows, setAclRows]         = useState([]);
  const [aclLoading, setAclLoading]   = useState(false);
  const [aclMsg, setAclMsg]           = useState("");

  const parseAclBills = async (files) => {
    if (!files || files.length === 0) return;
    setAclLoading(true);
    setAclMsg("");
    setAclRows([]);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("invoices", f));
      const res = await fetch(`${API}/api/expenses/parse-acl`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");
      setAclRows(data.rows);
      const unmatched = data.rows.filter(r => !r.matched && !r.error).length;
      setAclMsg(unmatched > 0 ? `⚠ ${unmatched} VIN(s) not matched to any order.` : `✅ ${data.rows.length} rated bill(s) parsed.`);
    } catch (err) {
      setAclMsg("❌ " + err.message);
    } finally {
      setAclLoading(false);
    }
  };

  const applyAclBills = async () => {
    const toApply = aclRows.filter(r => !r.skip && (r.matched || r.orderRef));
    if (toApply.length === 0) { setAclMsg("No matched rows to apply."); return; }
    setAclLoading(true);
    try {
      const res = await fetch(`${API}/api/expenses/apply-acl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: aclRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply failed");
      setAclMsg(`✅ ${data.created} expense(s) created!`);
      setAclRows([]);
      setAclFiles([]);
      fetchAll();
    } catch (err) {
      setAclMsg("❌ " + err.message);
    } finally {
      setAclLoading(false);
    }
  };

  // Fetch vendor list once on mount for autocomplete
  useEffect(() => {
    fetch(`${API}/api/vendors`)
      .then(r => r.json())
      .then(d => setVendors(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)       params.set("search", search);
      if (filterCat)    params.set("category", filterCat);
      if (filterStatus) params.set("status", filterStatus);
      if (dateFrom)     params.set("from", dateFrom);
      if (dateTo)       params.set("to", dateTo);

      const [expRes, sumRes] = await Promise.all([
        fetch(`${API}/api/expenses?${params}`),
        fetch(`${API}/api/expenses/summary`),
      ]);
      const expData = await expRes.json();
      const sumData = await sumRes.json();
      setExpenses(Array.isArray(expData) ? expData : []);
      setSummary(sumData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [search, filterCat, filterStatus, dateFrom, dateTo]);

  // Open add modal
  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setReceiptFile(null);
    setBillFile(null);
    setShowModal(true);
  };

  // Open edit modal
  const openEdit = (exp) => {
    setEditing(exp);
    setForm({
      category:      exp.category      || "",
      description:   exp.description   || "",
      vendor:        exp.vendor        || "",
      amount:        exp.amount != null ? String(exp.amount) : "",
      date:          exp.date ? exp.date.slice(0, 10) : todayISO(),
      orderRef:      exp.orderRef      || "",
      invoiceNumber: exp.invoiceNumber || "",
      status:        exp.status        || "unpaid",
      paidDate:      exp.paidDate ? exp.paidDate.slice(0, 10) : "",
      notes:         exp.notes         || "",
    });
    setReceiptFile(null);
    setBillFile(null);
    setShowModal(true);
  };

  // Submit (create or update)
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => v !== undefined && v !== null && fd.append(k, v));
      if (receiptFile) fd.append("receipt", receiptFile);
      if (billFile)    fd.append("bill",    billFile);

      const url    = editing ? `${API}/api/expenses/${editing._id}` : `${API}/api/expenses`;
      const method = editing ? "PUT" : "POST";
      const res    = await fetch(url, { method, body: fd });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Save failed");
        return;
      }
      setShowModal(false);
      fetchAll();
    } catch (err) {
      alert("Network error");
    } finally {
      setSaving(false);
    }
  };

  // Mark as paid
  const markPaid = async (exp) => {
    const paidDate = window.prompt("Enter paid date (YYYY-MM-DD):", todayISO());
    if (paidDate === null) return;
    await fetch(`${API}/api/expenses/${exp._id}/pay`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paidDate: paidDate || todayISO() }),
    });
    fetchAll();
  };

  // Remove files from existing expense
  const removeReceipt = async () => {
    if (!editing) return;
    if (!window.confirm("Remove the receipt?")) return;
    await fetch(`${API}/api/expenses/${editing._id}/receipt`, { method: "DELETE" });
    setEditing(e => ({ ...e, receiptFileName: "" }));
  };
  const removeBill = async () => {
    if (!editing) return;
    if (!window.confirm("Remove the bill document?")) return;
    await fetch(`${API}/api/expenses/${editing._id}/bill`, { method: "DELETE" });
    setEditing(e => ({ ...e, billFileName: "" }));
  };

  // Delete
  const doDelete = async (id) => {
    await fetch(`${API}/api/expenses/${id}`, { method: "DELETE" });
    setConfirmDelete(null);
    fetchAll();
  };

  const bulkDelete = async () => {
    const deletable = expenses.filter(e => selected[e._id] && e.status === "unpaid");
    const paid      = expenses.filter(e => selected[e._id] && e.status === "paid");
    if (deletable.length === 0) { alert("Only paid expenses are selected — mark them unpaid first to delete."); return; }
    const msg = paid.length > 0
      ? `Delete ${deletable.length} unpaid expense(s)? (${paid.length} paid ones will be skipped)`
      : `Delete ${deletable.length} expense(s)? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    await Promise.all(deletable.map(e => fetch(`${API}/api/expenses/${e._id}`, { method: "DELETE" })));
    setSelected({});
    fetchAll();
  };

  // Sorting
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d * -1);
    else { setSortKey(key); setSortDir(-1); }
  };

  const sorted = [...expenses].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey === "date" || sortKey === "paidDate") { av = av ? new Date(av) : 0; bv = bv ? new Date(bv) : 0; }
    if (av < bv) return -1 * sortDir;
    if (av > bv) return  1 * sortDir;
    return 0;
  });

  // Stat card filter
  const displayList = activeFilter
    ? sorted.filter(e => e.status === activeFilter)
    : sorted;

  const th = { padding: "10px 14px", textAlign: "left", color: "#9ca3af", fontSize: 12, fontWeight: 600, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" };
  const td = { padding: "11px 14px", fontSize: 13, color: "#e2e8f0", borderTop: "1px solid #1e2433" };

  const SortArrow = ({ k }) => {
    if (sortKey !== k) return <span style={{ color: "#374151", marginLeft: 4 }}>↕</span>;
    return <span style={{ color: "#60a5fa", marginLeft: 4 }}>{sortDir === 1 ? "↑" : "↓"}</span>;
  };

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1300, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#f1f5f9" }}>Expenses</h1>
          <p style={{ margin: "4px 0 0", color: "#9ca3af", fontSize: 13 }}>
            Track and manage all business expenses
          </p>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (search)       params.set("search", search);
              if (filterCat)    params.set("category", filterCat);
              if (filterStatus) params.set("status", filterStatus);
              if (dateFrom)     params.set("from", dateFrom);
              if (dateTo)       params.set("to", dateTo);
              window.open(`${API}/api/expenses/export?${params}`, "_blank");
            }}
            style={{ background:"#1e2433", color:"#9ca3af", border:"1px solid #374151", borderRadius:8, padding:"10px 16px", fontSize:13, fontWeight:600, cursor:"pointer" }}>
            ⬇ Export CSV
          </button>
          <button onClick={openAdd} style={{
            background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8,
            padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            + Add Expense
          </button>
        </div>
      </div>

      {/* ── Import Bill Panel ── */}
      <div style={{ background: "#1e2433", borderRadius: 12, padding: "20px 24px", marginBottom: 24, border: "1px solid #374151" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", marginBottom: 16 }}>📥 Import Bill</div>

        {/* Six dropzones side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14, marginBottom: 6 }}>

          {/* Sallaum dropzone */}
          {[
            { label: "🚢 Sallaum", sub: "Drop invoice PDF", color: "#3b82f6", loading: sallaumLoading, hasFiles: !!sallaumFile, fileName: sallaumFile?.name, manualKey: "sallaum",
              onFiles: (files) => { setSallaumFile(files[0]); setSallaumParsed(null); setSallaumRows([]); setSallaumMsg(""); parseSallaumBillFile(files[0]); },
              accept: ".pdf", multiple: false },
            { label: "⚓ ACL / Grimaldi", sub: "Drop rated bill PDF(s)", color: "#8b5cf6", loading: aclLoading, hasFiles: aclFiles.length > 0, fileName: aclFiles.length > 0 ? `${aclFiles.length} file(s)` : null, manualKey: "acl",
              onFiles: (files) => { setAclFiles(files); setAclRows([]); setAclMsg(""); parseAclBills(files); },
              accept: ".pdf", multiple: true },
            { label: "🚛 Dispatch", sub: "Drop dispatch sheet PDF(s)", color: "#f59e0b", loading: dispatchLoading, hasFiles: dispatchFiles.length > 0, fileName: dispatchFiles.length > 0 ? `${dispatchFiles.length} file(s)` : null, manualKey: "dispatch",
              onFiles: (files) => { setDispatchFiles(files); setDispatchRows([]); setDispatchMsg(""); parseDispatchBills(files); },
              accept: ".pdf", multiple: true },
          ].map(dz => (
            <div key={dz.label}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = dz.color; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = dz.hasFiles ? dz.color : "#374151"; }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = dz.hasFiles ? dz.color : "#374151"; const files = Array.from(e.dataTransfer.files); if (files.length) dz.onFiles(files); }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "#111827", border: `2px dashed ${dz.hasFiles ? dz.color : "#374151"}`, borderRadius: 12, padding: "24px 16px", transition: "border-color 0.15s", textAlign: "center" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = dz.color}
              onMouseLeave={e => e.currentTarget.style.borderColor = dz.hasFiles ? dz.color : "#374151"}>
              <span style={{ fontSize: 32 }}>{dz.loading ? "⏳" : dz.hasFiles ? "✅" : "📂"}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{dz.label}</span>
              <span style={{ fontSize: 12, color: dz.hasFiles ? "#34d399" : "#6b7280", marginBottom: 4 }}>
                {dz.loading ? "Parsing…" : dz.hasFiles ? dz.fileName : dz.sub}
              </span>
              <div style={{ display: "flex", gap: 6, marginTop: 2 }} onClick={e => e.stopPropagation()}>
                <label style={{ fontSize: 11, color: dz.color, border: `1px solid ${dz.color}`, borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                  📂 Browse
                  <input type="file" accept={dz.accept} multiple={dz.multiple} style={{ display: "none" }}
                    onChange={e => { const files = Array.from(e.target.files); if (files.length) dz.onFiles(files); }} />
                </label>
                <button onClick={() => openManualForm(dz.manualKey)}
                  style={{ fontSize: 11, color: "#9ca3af", border: "1px solid #374151", borderRadius: 6, padding: "3px 10px", background: "none", cursor: "pointer" }}>
                  ✏️ Manual
                </button>
              </div>
            </div>
          ))}

          {/* Container / Loader card */}
          <div
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#ec4899"; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = containerFiles.length > 0 ? "#ec4899" : "#374151"; }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#ec4899"; const files = Array.from(e.dataTransfer.files); if (files.length) { setContainerFiles(files); parseContainerBills(files); }}}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "#111827", border: `2px dashed ${containerFiles.length > 0 ? "#ec4899" : "#374151"}`, borderRadius: 12, padding: "24px 16px", transition: "border-color 0.15s", textAlign: "center" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#ec4899"}
            onMouseLeave={e => e.currentTarget.style.borderColor = containerFiles.length > 0 ? "#ec4899" : "#374151"}>
            <span style={{ fontSize: 32 }}>{containerLoading ? "⏳" : containerFiles.length > 0 ? "✅" : "📦"}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>📦 Container</span>
            <span style={{ fontSize: 12, color: containerFiles.length > 0 ? "#34d399" : "#6b7280", marginBottom: 4 }}>
              {containerLoading ? "Parsing…" : containerFiles.length > 0 ? `${containerFiles.length} file(s)` : "Drop loader invoice PDF(s)"}
            </span>
            <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
              <label style={{ fontSize: 11, color: "#ec4899", border: "1px solid #ec4899", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                📂 Browse
                <input type="file" accept=".pdf" multiple style={{ display: "none" }}
                  onChange={e => { const files = Array.from(e.target.files); if (files.length) { setContainerFiles(files); parseContainerBills(files); }}} />
              </label>
              <button onClick={() => openManualForm("other")}
                style={{ fontSize: 11, color: "#9ca3af", border: "1px solid #374151", borderRadius: 6, padding: "3px 10px", background: "none", cursor: "pointer" }}>
                ✏️ Manual
              </button>
            </div>
          </div>

          {/* Other card */}
          <div
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#10b981"; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = showManualForm === "other" || manualFile ? "#10b981" : "#374151"; }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#10b981"; const files = Array.from(e.dataTransfer.files); if (files.length) { setManualFile(files[0]); parseMiscBills(files); } }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "#111827", border: `2px dashed ${manualFile || showManualForm === "other" ? "#10b981" : "#374151"}`, borderRadius: 12, padding: "24px 16px", transition: "border-color 0.15s", textAlign: "center" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#10b981"}
            onMouseLeave={e => e.currentTarget.style.borderColor = showManualForm === "other" || manualFile ? "#10b981" : "#374151"}>
            <span style={{ fontSize: 32 }}>{manualFile ? "✅" : "📋"}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>📋 Other</span>
            <span style={{ fontSize: 12, color: manualFile ? "#34d399" : "#6b7280", marginBottom: 4 }}>
              {manualFile ? manualFile.name : "Drop bill or browse / enter manually"}
            </span>
            <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
              <label style={{ fontSize: 11, color: "#10b981", border: "1px solid #10b981", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                📂 Browse
                <input type="file" accept=".pdf,image/*" style={{ display: "none" }}
                  onChange={e => { const files = Array.from(e.target.files); if (files.length) { setManualFile(files[0]); parseMiscBills(files); } }} />
              </label>
              <button onClick={() => openManualForm("other")}
                style={{ fontSize: 11, color: "#9ca3af", border: "1px solid #374151", borderRadius: 6, padding: "3px 10px", background: "none", cursor: "pointer" }}>
                ✏️ Manual
              </button>
            </div>
          </div>

          {/* Payment Proof card */}
          <div
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#06b6d4"; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = proofFile ? "#06b6d4" : "#374151"; }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#06b6d4"; const files = Array.from(e.dataTransfer.files); if (files.length) { setProofFile(files[0]); parseProofFile(files[0]); } }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "#111827", border: `2px dashed ${proofFile ? "#06b6d4" : "#374151"}`, borderRadius: 12, padding: "24px 16px", transition: "border-color 0.15s", textAlign: "center" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#06b6d4"}
            onMouseLeave={e => e.currentTarget.style.borderColor = proofFile ? "#06b6d4" : "#374151"}>
            <span style={{ fontSize: 32 }}>{proofLoading ? "⏳" : proofFile ? "✅" : "🏦"}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>🏦 Payment Proof</span>
            <span style={{ fontSize: 12, color: proofFile ? "#34d399" : "#6b7280", marginBottom: 4 }}>
              {proofLoading ? "Parsing…" : proofFile ? proofFile.name : "Drop bank ACH confirmation PDF"}
            </span>
            <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
              <label style={{ fontSize: 11, color: "#06b6d4", border: "1px solid #06b6d4", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                📂 Browse
                <input type="file" accept=".pdf" style={{ display: "none" }}
                  onChange={e => { const files = Array.from(e.target.files); if (files.length) { setProofFile(files[0]); parseProofFile(files[0]); } }} />
              </label>
            </div>
          </div>
        </div>

        {/* ── Other manual entry form ── */}
        {showManualForm && (
          <div style={{ marginTop: 16, padding: "18px 20px", background: "#111827", borderRadius: 10, border: `1px solid ${CARD_DEFAULTS[showManualForm]?.color || "#374151"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: CARD_DEFAULTS[showManualForm]?.color || "#10b981" }}>
                {{ sallaum: "🚢 Sallaum", acl: "⚓ ACL / Grimaldi", dispatch: "🚛 Dispatch", other: "📋 Other" }[showManualForm]} — Manual Entry
              </div>
              <button onClick={() => { setShowManualForm(null); setManualFile(null); }} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 16, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {[
                { key: "vendor",        label: "Vendor *",             type: "text",   placeholder: "Vendor name",         color: "#f1f5f9" },
                { key: "amount",        label: "Amount ($) *",         type: "number", placeholder: "0.00",                color: "#34d399" },
                { key: "date",          label: "Date",                 type: "date",   placeholder: "",                    color: "#f1f5f9" },
                { key: "orderRef",      label: "Order Ref (optional)", type: "text",   placeholder: "Leave blank if none",  color: "#fbbf24" },
                { key: "vin",           label: "VIN (optional)",        type: "text",   placeholder: "17-digit VIN",         color: "#a78bfa" },
                { key: "invoiceNumber", label: "Invoice # (optional)", type: "text",   placeholder: "Invoice or ref #",     color: "#f1f5f9" },
              ].map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>{f.label}</div>
                  <input type={f.type} min={f.type==="number"?"0":undefined} step={f.type==="number"?"0.01":undefined}
                    value={manualForm[f.key]}
                    onChange={e => {
                      const val = e.target.value;
                      setManualForm(fm => ({...fm, [f.key]: val}));
                      if (f.key === "vin" && val.length === 17) lookupOrderByVin(val);
                    }}
                    placeholder={f.placeholder}
                    style={{ width: "100%", background: "#1e2433", border: "1px solid #374151", borderRadius: 6, padding: "7px 10px", color: f.color, fontSize: 13, boxSizing: "border-box", fontWeight: f.key==="amount"?600:400, fontFamily: f.key==="vin"?"monospace":"inherit", textTransform: f.key==="vin"?"uppercase":"none" }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Category</div>
                <select value={manualForm.category} onChange={e => setManualForm(f => ({...f, category: e.target.value}))}
                  style={{ width: "100%", background: "#1e2433", border: "1px solid #374151", borderRadius: 6, padding: "7px 10px", color: "#f1f5f9", fontSize: 13, boxSizing: "border-box" }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: "span 3" }}>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Description / Notes</div>
                <input value={manualForm.description} onChange={e => setManualForm(f => ({...f, description: e.target.value}))} placeholder="What is this bill for?"
                  style={{ width: "100%", background: "#1e2433", border: "1px solid #374151", borderRadius: 6, padding: "7px 10px", color: "#f1f5f9", fontSize: 13, boxSizing: "border-box" }} />
              </div>
            </div>
            {/* ── Extra Charge Lines ── */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>Extra Charges (optional)</div>
                <button
                  onClick={() => setExtraLines(l => [...l, { description: "", amount: "" }])}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #374151", background: "none", color: "#34d399", cursor: "pointer" }}>
                  + Add Line
                </button>
              </div>
              {extraLines.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {extraLines.map((line, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px 32px", gap: 6, alignItems: "center" }}>
                      <input
                        value={line.description}
                        onChange={e => setExtraLines(ls => ls.map((l, j) => j === i ? { ...l, description: e.target.value } : l))}
                        placeholder="e.g. Storage Fee, Gate Fee…"
                        style={{ background: "#1e2433", border: "1px solid #374151", borderRadius: 6, padding: "6px 10px", color: "#f1f5f9", fontSize: 13, boxSizing: "border-box" }} />
                      <input
                        type="number" min="0" step="0.01"
                        value={line.amount}
                        onChange={e => setExtraLines(ls => ls.map((l, j) => j === i ? { ...l, amount: e.target.value } : l))}
                        placeholder="0.00"
                        style={{ background: "#1e2433", border: "1px solid #374151", borderRadius: 6, padding: "6px 10px", color: "#34d399", fontSize: 13, fontWeight: 600, boxSizing: "border-box" }} />
                      <button
                        onClick={() => setExtraLines(ls => ls.filter((_, j) => j !== i))}
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16, padding: 0 }}>✕</button>
                    </div>
                  ))}
                  <div style={{ textAlign: "right", fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                    Total incl. extras: <strong style={{ color: "#34d399" }}>
                      ${(Number(manualForm.amount || 0) + extraLines.reduce((s, l) => s + Number(l.amount || 0), 0)).toFixed(2)}
                    </strong>
                  </div>
                </div>
              )}
            </div>

            {/* Attached file */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Bill Document (optional)</div>
              {manualFile ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#1e2433", borderRadius: 6, padding: "6px 12px" }}>
                  <span style={{ fontSize: 13, color: "#34d399" }}>📄 {manualFile.name}</span>
                  <button onClick={() => setManualFile(null)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 12 }}>✕ Remove</button>
                </div>
              ) : (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#1e2433", border: "1px dashed #374151", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12, color: "#9ca3af" }}>
                  📎 Attach bill PDF / image
                  <input type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) setManualFile(e.target.files[0]); }} />
                </label>
              )}
            </div>
            {manualMsg && <div style={{ marginBottom: 10, fontSize: 13, color: manualMsg.startsWith("✅") ? "#34d399" : "#f87171" }}>{manualMsg}</div>}
            <button onClick={submitManualBill} disabled={manualSaving || !manualForm.vendor || !manualForm.amount}
              style={{ background: manualForm.vendor && manualForm.amount ? "#059669" : "#374151", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {manualSaving ? "Saving…" : "✅ Add Expense"}
            </button>
          </div>
        )}

        {/* ── Sallaum results ── */}
        {(sallaumMsg || (sallaumParsed && sallaumRows.length > 0)) && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #374151" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa", marginBottom: 10 }}>🚢 Sallaum Results</div>
            {sallaumMsg && <div style={{ marginBottom: 10, fontSize: 13, color: sallaumMsg.startsWith("✅") ? "#34d399" : sallaumMsg.startsWith("❌") ? "#f87171" : "#fbbf24" }}>{sallaumMsg}</div>}
            {sallaumParsed && sallaumRows.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>
                  Invoice <strong style={{ color: "#f1f5f9" }}>{sallaumParsed.invoiceNumber}</strong>
                  {" · "}{sallaumParsed.vessel} · Voyage {sallaumParsed.voyage}
                  {" · "}{sallaumParsed.pol} → {sallaumParsed.pod} · {sallaumParsed.invoiceDate}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr>{["✓","VIN","Vehicle","Order Ref","Customer","Amount","Status"].map(h => <th key={h} style={{ padding:"8px 12px", textAlign:"left", color:"#6b7280", fontSize:11, fontWeight:600, borderBottom:"1px solid #374151", whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {sallaumRows.map((row, i) => (
                        <tr key={row.vin} style={{ opacity: row.skip ? 0.4 : 1 }}>
                          <td style={{ padding:"8px 12px", borderBottom:"1px solid #1a2030" }}><input type="checkbox" checked={!row.skip} onChange={e => setSallaumRows(rs => rs.map((r,j) => j===i?{...r,skip:!e.target.checked}:r))} /></td>
                          <td style={{ padding:"8px 12px", borderBottom:"1px solid #1a2030", fontFamily:"monospace", fontSize:12, color:"#94a3b8" }}>{row.vin}</td>
                          <td style={{ padding:"8px 12px", borderBottom:"1px solid #1a2030", color:"#e2e8f0" }}>{row.ymm||"—"}</td>
                          <td style={{ padding:"8px 12px", borderBottom:"1px solid #1a2030" }}>{row.matched?<span style={{color:"#60a5fa",fontWeight:600}}>{row.orderRef}</span>:<input value={row.orderRef} placeholder="Enter ref…" onChange={e=>setSallaumRows(rs=>rs.map((r,j)=>j===i?{...r,orderRef:e.target.value}:r))} style={{background:"#111827",border:"1px solid #f59e0b",borderRadius:6,padding:"3px 8px",color:"#fbbf24",fontSize:12,width:110}}/>}</td>
                          <td style={{ padding:"8px 12px", borderBottom:"1px solid #1a2030", color:"#9ca3af", fontSize:12 }}>{row.customerName||"—"}</td>
                          <td style={{ padding:"8px 12px", borderBottom:"1px solid #1a2030", color:"#34d399", fontWeight:600 }}>${row.total.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                          <td style={{ padding:"8px 12px", borderBottom:"1px solid #1a2030" }}>{row.matched?<span style={{color:"#34d399",fontSize:12}}>✅ Matched</span>:<span style={{color:"#f59e0b",fontSize:12}}>⚠ No match</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop:14, display:"flex", alignItems:"center", gap:16 }}>
                  <button onClick={applySallaumBill} disabled={sallaumLoading} style={{ background:"#059669", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", fontSize:14, fontWeight:600, cursor:"pointer" }}>
                    {sallaumLoading?"Applying…":`✅ Create ${sallaumRows.filter(r=>!r.skip).length} Expenses`}
                  </button>
                  {sallaumRows.filter(r=>!r.matched&&!r.orderRef).length>0&&<span style={{fontSize:12,color:"#6b7280"}}>{sallaumRows.filter(r=>!r.matched&&!r.orderRef).length} without order ref — will save unlinked</span>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── ACL results ── */}
        {(aclMsg || aclRows.length > 0) && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #374151" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#8b5cf6", marginBottom: 10 }}>⚓ ACL / Grimaldi Results</div>
            {aclMsg && <div style={{ marginBottom: 10, fontSize: 13, color: aclMsg.startsWith("✅") ? "#34d399" : aclMsg.startsWith("❌") ? "#f87171" : "#fbbf24" }}>{aclMsg}</div>}
            {aclRows.length > 0 && (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                    <thead><tr>{["✓","File","VIN","Vehicle","Vessel / Voyage","POD","Order Ref","Amount","Notes","Status"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",color:"#6b7280",fontSize:11,fontWeight:600,borderBottom:"1px solid #374151",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {aclRows.map((row,i)=>(
                        <tr key={i} style={{opacity:row.skip?0.4:1}}>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}><input type="checkbox" checked={!row.skip} onChange={e=>setAclRows(rs=>rs.map((r,j)=>j===i?{...r,skip:!e.target.checked}:r))}/></td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#6b7280",fontSize:11,maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.fileName}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",fontFamily:"monospace",fontSize:12,color:"#94a3b8"}}>{row.vin||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#e2e8f0",whiteSpace:"nowrap"}}>{row.ymm||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#9ca3af",fontSize:12,whiteSpace:"nowrap"}}>{[row.vessel,row.voyage].filter(Boolean).join(" / ")||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#9ca3af",fontSize:11,whiteSpace:"nowrap"}}>{row.pod||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>{row.matched?<span style={{color:"#60a5fa",fontWeight:600}}>{row.orderRef}</span>:<input value={row.orderRef} placeholder="Enter ref…" onChange={e=>setAclRows(rs=>rs.map((r,j)=>j===i?{...r,orderRef:e.target.value}:r))} style={{background:"#111827",border:"1px solid #f59e0b",borderRadius:6,padding:"3px 8px",color:"#fbbf24",fontSize:12,width:100}}/>}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}><input type="number" value={row.total} min="0" step="0.01" onChange={e=>setAclRows(rs=>rs.map((r,j)=>j===i?{...r,total:parseFloat(e.target.value)||0}:r))} style={{background:"#111827",border:"1px solid #374151",borderRadius:6,padding:"3px 8px",color:"#34d399",fontSize:13,width:80,fontWeight:600}}/></td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}><input value={row.notes} placeholder="misc charges…" onChange={e=>setAclRows(rs=>rs.map((r,j)=>j===i?{...r,notes:e.target.value}:r))} style={{background:"#111827",border:"1px solid #374151",borderRadius:6,padding:"3px 8px",color:"#e2e8f0",fontSize:12,width:140}}/></td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>{row.error?<span style={{color:"#f87171",fontSize:11}}>❌ Error</span>:row.matched?<span style={{color:"#34d399",fontSize:12}}>✅ Matched</span>:<span style={{color:"#f59e0b",fontSize:12}}>⚠ No match</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{marginTop:14,display:"flex",alignItems:"center",gap:16}}>
                  <button onClick={applyAclBills} disabled={aclLoading} style={{background:"#059669",color:"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontSize:14,fontWeight:600,cursor:"pointer"}}>
                    {aclLoading?"Applying…":`✅ Create ${aclRows.filter(r=>!r.skip&&(r.matched||r.orderRef)).length} Expenses`}
                  </button>
                  {aclRows.filter(r=>!r.matched&&!r.error).length>0&&<span style={{fontSize:12,color:"#6b7280"}}>{aclRows.filter(r=>!r.matched).length} unmatched — enter ref or uncheck to skip</span>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Dispatch results ── */}
        {(dispatchMsg || dispatchRows.length > 0) && (
          <div id="dispatch-section" style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #374151" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", marginBottom: 10 }}>🚛 Dispatch Results</div>
            {dispatchMsg && <div style={{ marginBottom: 10, fontSize: 13, color: dispatchMsg.startsWith("✅") ? "#34d399" : dispatchMsg.startsWith("❌") ? "#f87171" : "#fbbf24" }}>{dispatchMsg}</div>}
            {dispatchRows.length > 0 && (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                    <thead><tr>{["✓","File","Load #","VIN","Vehicle","Carrier","Pickup","Order Ref","Amount","Notes","Status"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",color:"#6b7280",fontSize:11,fontWeight:600,borderBottom:"1px solid #374151",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {dispatchRows.map((row,i)=>(
                        <React.Fragment key={i}>
                        <tr style={{opacity:row.skip?0.4:1}}>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}><input type="checkbox" checked={!row.skip} onChange={e=>setDispatchRows(rs=>rs.map((r,j)=>j===i?{...r,skip:!e.target.checked}:r))}/></td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#6b7280",fontSize:11,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.fileName}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#a78bfa",fontWeight:600,fontSize:13}}>{row.loadId||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",fontFamily:"monospace",fontSize:12,color:"#94a3b8"}}>{row.vin||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#e2e8f0",whiteSpace:"nowrap"}}>{row.ymm||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#9ca3af",fontSize:12,whiteSpace:"nowrap"}}>{row.carrier||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#9ca3af",fontSize:11,whiteSpace:"nowrap"}}>{row.origin||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>{row.matched?<span style={{color:"#60a5fa",fontWeight:600}}>{row.orderRef}</span>:<input value={row.orderRef} placeholder="Enter ref…" onChange={e=>setDispatchRows(rs=>rs.map((r,j)=>j===i?{...r,orderRef:e.target.value}:r))} style={{background:"#111827",border:"1px solid #f59e0b",borderRadius:6,padding:"3px 8px",color:"#fbbf24",fontSize:12,width:100}}/>}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}><input type="number" value={row.total} min="0" step="0.01" onChange={e=>setDispatchRows(rs=>rs.map((r,j)=>j===i?{...r,total:parseFloat(e.target.value)||0}:r))} style={{background:"#111827",border:"1px solid #374151",borderRadius:6,padding:"3px 8px",color:"#34d399",fontSize:13,width:80,fontWeight:600}}/></td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}><input value={row.notes} placeholder="misc charges…" onChange={e=>setDispatchRows(rs=>rs.map((r,j)=>j===i?{...r,notes:e.target.value}:r))} style={{background:"#111827",border:"1px solid #374151",borderRadius:6,padding:"3px 8px",color:"#e2e8f0",fontSize:12,width:130}}/></td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>
                            {row.error?<span style={{color:"#f87171",fontSize:11}}>❌ Error</span>:row.matched?<span style={{color:"#34d399",fontSize:12}}>✅ Matched</span>:<span style={{color:"#f59e0b",fontSize:12}}>⚠ No match</span>}
                            <button onClick={()=>setDispatchRows(rs=>rs.map((r,j)=>j===i?{...r,lineItems:[...(r.lineItems||[]),{description:"",amount:""}]}:r))}
                              style={{marginLeft:8,fontSize:10,padding:"1px 7px",borderRadius:5,border:"1px solid #374151",background:"none",color:"#34d399",cursor:"pointer"}}>
                              + Extra
                            </button>
                          </td>
                        </tr>
                        {(row.lineItems||[]).map((li,li_i)=>(
                          <tr key={`li-${i}-${li_i}`} style={{background:"#0d1117",opacity:row.skip?0.4:1}}>
                            <td colSpan={8}></td>
                            <td style={{padding:"4px 8px"}} colSpan={1}>
                              <input value={li.description} placeholder="Extra charge description…"
                                onChange={e=>setDispatchRows(rs=>rs.map((r,j)=>j!==i?r:{...r,lineItems:r.lineItems.map((l,k)=>k===li_i?{...l,description:e.target.value}:l)}))}
                                style={{background:"#111827",border:"1px solid #374151",borderRadius:6,padding:"3px 8px",color:"#e2e8f0",fontSize:12,width:"100%"}}/>
                            </td>
                            <td style={{padding:"4px 8px"}}>
                              <input type="number" value={li.amount} min="0" step="0.01" placeholder="0.00"
                                onChange={e=>setDispatchRows(rs=>rs.map((r,j)=>j!==i?r:{...r,lineItems:r.lineItems.map((l,k)=>k===li_i?{...l,amount:e.target.value}:l)}))}
                                style={{background:"#111827",border:"1px solid #374151",borderRadius:6,padding:"3px 8px",color:"#34d399",fontSize:12,width:80,fontWeight:600}}/>
                            </td>
                            <td style={{padding:"4px 8px"}}>
                              <button onClick={()=>setDispatchRows(rs=>rs.map((r,j)=>j!==i?r:{...r,lineItems:r.lineItems.filter((_,k)=>k!==li_i)}))}
                                style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:14}}>✕</button>
                            </td>
                          </tr>
                        ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{marginTop:14,display:"flex",alignItems:"center",gap:16}}>
                  <button onClick={applyDispatchBills} disabled={dispatchLoading} style={{background:"#059669",color:"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontSize:14,fontWeight:600,cursor:"pointer"}}>
                    {dispatchLoading?"Applying…":`✅ Create ${dispatchRows.filter(r=>!r.skip&&!r.error).length} Expenses`}
                  </button>
                  {dispatchRows.filter(r=>!r.matched&&!r.error).length>0&&<span style={{fontSize:12,color:"#6b7280"}}>{dispatchRows.filter(r=>!r.matched).length} unmatched — enter ref or uncheck to skip</span>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Container results ── */}
        {(containerMsg || containerResults.length > 0) && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #374151" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#ec4899", marginBottom: 10 }}>📦 Container Results</div>
            {containerMsg && <div style={{ marginBottom: 10, fontSize: 13, color: containerMsg.startsWith("✅") ? "#34d399" : containerMsg.startsWith("❌") ? "#f87171" : "#fbbf24" }}>{containerMsg}</div>}
            {containerResults.map((inv, ii) => (
              <div key={ii} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>
                  Invoice <strong style={{ color: "#f1f5f9" }}>{inv.invoiceNumber}</strong>
                  {inv.container && <> · Container <strong style={{ color: "#f1f5f9" }}>{inv.container}</strong></>}
                  {inv.booking && <> · Booking {inv.booking}</>}
                  {" · "}{inv.vendor} · <strong style={{ color: "#34d399" }}>${inv.total?.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong> ÷ {inv.rows?.length} VINs = <strong style={{ color: "#34d399" }}>${(inv.rows?.[0]?.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong> each
                </div>
                {inv.error ? <div style={{ color: "#f87171", fontSize: 13 }}>❌ {inv.error}</div> : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead><tr>{["✓","VIN","Vehicle","Booking #","Order Ref","Customer","Amount","Status"].map(h => <th key={h} style={{ padding:"8px 10px", textAlign:"left", color:"#6b7280", fontSize:11, fontWeight:600, borderBottom:"1px solid #374151", whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {inv.rows?.map((row, i) => (
                          <tr key={i} style={{ opacity: row.skip ? 0.4 : 1 }}>
                            <td style={{ padding:"8px 10px", borderBottom:"1px solid #1a2030" }}><input type="checkbox" checked={!row.skip} onChange={e => setContainerResults(rs => rs.map((r, ri) => ri !== ii ? r : { ...r, rows: r.rows.map((rr, j) => j === i ? { ...rr, skip: !e.target.checked } : rr) }))}/></td>
                            <td style={{ padding:"8px 10px", borderBottom:"1px solid #1a2030", fontFamily:"monospace", fontSize:12, color:"#94a3b8" }}>{row.vin}</td>
                            <td style={{ padding:"8px 10px", borderBottom:"1px solid #1a2030", color:"#e2e8f0", whiteSpace:"nowrap" }}>{row.ymm || "—"}</td>
                            <td style={{ padding:"8px 10px", borderBottom:"1px solid #1a2030", color:"#a78bfa", fontWeight:600, fontSize:12 }}>{inv.booking || "—"}</td>
                            <td style={{ padding:"8px 10px", borderBottom:"1px solid #1a2030" }}>
                              {row.matched ? <span style={{ color:"#60a5fa", fontWeight:600 }}>{row.orderRef}</span>
                                : <input value={row.orderRef} placeholder="Enter ref…"
                                    onChange={e => setContainerResults(rs => rs.map((r, ri) => ri !== ii ? r : { ...r, rows: r.rows.map((rr, j) => j === i ? { ...rr, orderRef: e.target.value } : rr) }))}
                                    style={{ background:"#111827", border:"1px solid #f59e0b", borderRadius:6, padding:"3px 8px", color:"#fbbf24", fontSize:12, width:100 }}/>}
                            </td>
                            <td style={{ padding:"8px 10px", borderBottom:"1px solid #1a2030", color:"#9ca3af", fontSize:12 }}>{row.customerName || "—"}</td>
                            <td style={{ padding:"8px 10px", borderBottom:"1px solid #1a2030" }}>
                              <input type="number" value={row.total} min="0" step="0.01"
                                onChange={e => setContainerResults(rs => rs.map((r, ri) => ri !== ii ? r : { ...r, rows: r.rows.map((rr, j) => j === i ? { ...rr, total: parseFloat(e.target.value)||0 } : rr) }))}
                                style={{ background:"#111827", border:"1px solid #374151", borderRadius:6, padding:"3px 8px", color:"#34d399", fontSize:13, width:80, fontWeight:600 }}/>
                            </td>
                            <td style={{ padding:"8px 10px", borderBottom:"1px solid #1a2030" }}>
                              {row.matched ? <span style={{ color:"#34d399", fontSize:12 }}>✅ Matched</span> : <span style={{ color:"#f59e0b", fontSize:12 }}>⚠ No match</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
            {containerResults.length > 0 && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 16 }}>
                <button onClick={applyContainerBills} disabled={containerLoading}
                  style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  {containerLoading ? "Applying…" : `✅ Create ${containerResults.flatMap(r => r.rows||[]).filter(r => !r.skip).length} Expenses`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Misc / Other results ── */}
        {(miscMsg || miscResults.length > 0) && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #374151" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#10b981", marginBottom: 10 }}>📋 Other / Misc Results</div>
            {miscMsg && <div style={{ marginBottom: 10, fontSize: 13, color: miscMsg.startsWith("✅") ? "#34d399" : miscMsg.startsWith("❌") ? "#f87171" : "#fbbf24" }}>{miscMsg}</div>}
            {miscResults.length > 0 && (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr>{["✓","File","Vendor","Invoice #","VIN","Category","Order Ref","Amount","Notes","Status"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",color:"#6b7280",fontSize:11,fontWeight:600,borderBottom:"1px solid #374151",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {miscResults.map((row, i) => (
                        <tr key={i} style={{ opacity: row.skip ? 0.4 : 1 }}>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}><input type="checkbox" checked={!row.skip} onChange={e=>setMiscResults(rs=>rs.map((r,j)=>j===i?{...r,skip:!e.target.checked}:r))}/></td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#6b7280",fontSize:11,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.fileName}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#e2e8f0",whiteSpace:"nowrap"}}>{row.vendor||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#a78bfa",fontSize:12}}>{row.invoiceNumber||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",fontFamily:"monospace",fontSize:11,color:"#94a3b8"}}>{row.vin||"—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>
                            <select value={row.category||"Port / Terminal Fees"} onChange={e=>setMiscResults(rs=>rs.map((r,j)=>j===i?{...r,category:e.target.value}:r))}
                              style={{background:"#111827",border:"1px solid #374151",borderRadius:6,padding:"3px 8px",color:"#f1f5f9",fontSize:11}}>
                              {["Towing / Transport","Ocean Freight","Port / Terminal Fees","Loaders & Warehouses","Software","Legal Fees","Office & Admin","General Overhead"].map(c=><option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>
                            {row.matched
                              ? <span style={{color:"#60a5fa",fontWeight:600}}>{row.orderRef}</span>
                              : <input value={row.orderRef} placeholder="Enter ref…" onChange={e=>setMiscResults(rs=>rs.map((r,j)=>j===i?{...r,orderRef:e.target.value}:r))}
                                  style={{background:"#111827",border:"1px solid #f59e0b",borderRadius:6,padding:"3px 8px",color:"#fbbf24",fontSize:12,width:100}}/>}
                          </td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>
                            <input type="number" value={row.total} min="0" step="0.01" onChange={e=>setMiscResults(rs=>rs.map((r,j)=>j===i?{...r,total:parseFloat(e.target.value)||0}:r))}
                              style={{background:"#111827",border:"1px solid #374151",borderRadius:6,padding:"3px 8px",color:"#34d399",fontSize:13,width:80,fontWeight:600}}/>
                          </td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>
                            <input value={row.notes} placeholder="notes…" onChange={e=>setMiscResults(rs=>rs.map((r,j)=>j===i?{...r,notes:e.target.value}:r))}
                              style={{background:"#111827",border:"1px solid #374151",borderRadius:6,padding:"3px 8px",color:"#e2e8f0",fontSize:12,width:130}}/>
                          </td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>
                            {row.error ? <span style={{color:"#f87171",fontSize:11}}>❌ Error</span>
                              : <div style={{display:"flex",flexDirection:"column",gap:3}}>
                                  <span style={{color:row.matched?"#34d399":"#f59e0b",fontSize:12}}>{row.matched?"✅ Matched":"⚠ No match"}</span>
                                  {row.isPaid && <span style={{color:"#60a5fa",fontSize:11}}>💳 Auto-paid</span>}
                                </div>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{marginTop:14,display:"flex",alignItems:"center",gap:16}}>
                  <button onClick={applyMiscBills} disabled={miscLoading}
                    style={{background:"#059669",color:"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontSize:14,fontWeight:600,cursor:"pointer"}}>
                    {miscLoading?"Applying…":`✅ Create ${miscResults.filter(r=>!r.skip&&!r.error).length} Expenses`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Payment Proof results ── */}
        {(proofMsg || proofRows.length > 0) && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #374151" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#06b6d4", marginBottom: 10 }}>🏦 Payment Proof Results</div>
            {proofMsg && <div style={{ marginBottom: 10, fontSize: 13, color: proofMsg.startsWith("✅") ? "#34d399" : proofMsg.startsWith("❌") ? "#f87171" : "#fbbf24" }}>{proofMsg}</div>}
            {proofRows.length > 0 && (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr>{["✓","Payee (Bank)","Order Ref","Note","Amount","Matched Bill(s)","Status"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",color:"#6b7280",fontSize:11,fontWeight:600,borderBottom:"1px solid #374151",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {proofRows.map((row, i) => (
                        <tr key={i} style={{ opacity: row.selected ? 1 : 0.5 }}>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>
                            <input type="checkbox" checked={row.selected} disabled={!row.matchedIds?.length}
                              onChange={e=>setProofRows(rs=>rs.map((r,j)=>j===i?{...r,selected:e.target.checked}:r))}/>
                          </td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#e2e8f0",whiteSpace:"nowrap"}}>{row.payeeName}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#60a5fa",fontWeight:600}}>{row.orderRef || "—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#9ca3af",fontSize:12}}>{row.note || "—"}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",color:"#34d399",fontWeight:600}}>${row.amount.toFixed(2)}</td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030",fontSize:12,color:"#9ca3af"}}>
                            {row.matchedIds?.length
                              ? row.candidates.filter(c=>row.matchedIds.includes(c._id)).map(c=>c.description).join(", ")
                              : row.candidates?.length
                                ? <span style={{color:"#fbbf24"}}>⚠ {row.candidates.length} candidate(s), amounts don't sum to ${row.amount.toFixed(2)}</span>
                                : <span style={{color:"#f87171"}}>No unpaid bill found for order #{row.orderRef}</span>}
                          </td>
                          <td style={{padding:"8px 10px",borderBottom:"1px solid #1a2030"}}>
                            {row.matchType === "exact" && <span style={{color:"#34d399",fontSize:12}}>✅ Exact match</span>}
                            {row.matchType === "combined" && <span style={{color:"#34d399",fontSize:12}}>✅ Combined match</span>}
                            {row.matchType === "review" && <span style={{color:"#fbbf24",fontSize:12}}>⚠ Review</span>}
                            {row.matchType === "none" && <span style={{color:"#f87171",fontSize:12}}>❌ No match</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{marginTop:14,display:"flex",alignItems:"center",gap:16}}>
                  <button onClick={applyProofRows} disabled={proofLoading}
                    style={{background:"#059669",color:"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontSize:14,fontWeight:600,cursor:"pointer"}}>
                    {proofLoading?"Applying…":`✅ Mark ${proofRows.filter(r=>r.selected).length} Bill(s) Paid`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
          {/* Unpaid */}
          <div
            onClick={() => setActiveFilter(a => a === "unpaid" ? null : "unpaid")}
            style={{
              background: "#1e2433", borderRadius: 12, padding: "18px 22px", cursor: "pointer",
              border: `2px solid ${activeFilter === "unpaid" ? "#f87171" : "transparent"}`,
              opacity: activeFilter && activeFilter !== "unpaid" ? 0.45 : 1,
              transition: "all 0.15s",
            }}>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Unpaid</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#f87171" }}>{fmt$(summary.totalUnpaid)}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>Outstanding</div>
          </div>

          {/* Paid this month */}
          <div
            onClick={() => setActiveFilter(a => a === "paid" ? null : "paid")}
            style={{
              background: "#1e2433", borderRadius: 12, padding: "18px 22px", cursor: "pointer",
              border: `2px solid ${activeFilter === "paid" ? "#34d399" : "transparent"}`,
              opacity: activeFilter && activeFilter !== "paid" ? 0.45 : 1,
              transition: "all 0.15s",
            }}>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Paid This Month</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#34d399" }}>{fmt$(summary.totalPaidMonth)}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
              {new Date().toLocaleString("default", { month: "long", year: "numeric" })}
            </div>
          </div>

          {/* All time total */}
          <div style={{
            background: "#1e2433", borderRadius: 12, padding: "18px 22px",
            opacity: activeFilter ? 0.45 : 1, transition: "all 0.15s",
          }}>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total All Time</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#f1f5f9" }}>{fmt$(summary.totalAllTime)}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{summary.count} expenses recorded</div>
          </div>
        </div>
      )}

      {/* Category breakdown mini-bar */}
      {summary?.byCategory && Object.keys(summary.byCategory).length > 0 && (
        <div style={{ background: "#1e2433", borderRadius: 12, padding: "16px 20px", marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>By Category</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {Object.entries(summary.byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, amt]) => (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: CAT_COLORS[cat] || "#9ca3af", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "#e2e8f0" }}>{cat}</span>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{fmt$(amt)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search description, vendor, order…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            background: "#1e2433", border: "1px solid #374151", borderRadius: 7,
            color: "#f1f5f9", padding: "8px 12px", fontSize: 13, width: 260,
          }}
        />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{
          background: "#1e2433", border: "1px solid #374151", borderRadius: 7,
          color: filterCat ? "#f1f5f9" : "#9ca3af", padding: "8px 12px", fontSize: 13,
        }}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{
          background: "#1e2433", border: "1px solid #374151", borderRadius: 7,
          color: filterStatus ? "#f1f5f9" : "#9ca3af", padding: "8px 12px", fontSize: 13,
        }}>
          <option value="">All Statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          style={{ background: "#1e2433", border: "1px solid #374151", borderRadius: 7, color: "#f1f5f9", padding: "8px 12px", fontSize: 13 }}
        />
        <span style={{ color: "#6b7280", fontSize: 13 }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          style={{ background: "#1e2433", border: "1px solid #374151", borderRadius: 7, color: "#f1f5f9", padding: "8px 12px", fontSize: 13 }}
        />
        {(search || filterCat || filterStatus || dateFrom || dateTo || activeFilter) && (
          <button onClick={() => { setSearch(""); setFilterCat(""); setFilterStatus(""); setDateFrom(""); setDateTo(""); setActiveFilter(null); }}
            style={{ background: "none", border: "1px solid #374151", borderRadius: 7, color: "#9ca3af", padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>
            Clear filters
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
          {displayList.length} expense{displayList.length !== 1 ? "s" : ""}
          {activeFilter ? ` (${activeFilter})` : ""}
        </span>
      </div>

      {/* Table */}
      <div style={{ background: "#161d2c", borderRadius: 12, overflow: "hidden", border: "1px solid #1e2433" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>Loading…</div>
        ) : displayList.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💸</div>
            <div style={{ color: "#9ca3af", fontSize: 14 }}>No expenses found</div>
            <button onClick={openAdd} style={{ marginTop: 16, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 7, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>
              Add your first expense
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#1a2235" }}>
                  <th style={{ ...th, width: 40 }}>
                    <input type="checkbox"
                      checked={displayList.length > 0 && displayList.every(x => selected[x._id])}
                      onChange={e => { const ids = {}; displayList.forEach(x => { ids[x._id] = e.target.checked; }); setSelected(s => ({...s,...ids})); }}
                      title="Select / deselect all"
                    />
                  </th>
                  <th style={th} onClick={() => toggleSort("date")}>Date <SortArrow k="date" /></th>
                  <th style={th} onClick={() => toggleSort("category")}>Category <SortArrow k="category" /></th>
                  <th style={th}>VIN</th>
                  <th style={th} onClick={() => toggleSort("vendor")}>Vendor <SortArrow k="vendor" /></th>
                  <th style={{ ...th, textAlign: "right" }} onClick={() => toggleSort("amount")}>Amount <SortArrow k="amount" /></th>
                  <th style={th}>Order #</th>
                  <th style={th} onClick={() => toggleSort("status")}>Status <SortArrow k="status" /></th>
                  <th style={th}>Docs</th>
                  <th style={{ ...th, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayList.map(exp => (
                  <tr key={exp._id}
                    style={{ background: selected[exp._id] ? "#1a2f1a" : "#161d2c", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = selected[exp._id] ? "#1a2f1a" : "#1a2235"}
                    onMouseLeave={e => e.currentTarget.style.background = selected[exp._id] ? "#1a2f1a" : "#161d2c"}
                    onClick={() => toggleSelect(exp._id)}>

                    <td style={{ ...td, width: 40 }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={!!selected[exp._id]} onChange={() => toggleSelect(exp._id)} />
                    </td>

                    {/* Date */}
                    <td style={td}>{fmtDate(exp.date)}</td>

                    {/* Category */}
                    <td style={td}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "3px 8px", borderRadius: 5, fontSize: 11, fontWeight: 600,
                        background: (CAT_COLORS[exp.category] || "#9ca3af") + "22",
                        color: CAT_COLORS[exp.category] || "#9ca3af",
                        whiteSpace: "nowrap",
                      }}>
                        {exp.category}
                      </span>
                    </td>

                    {/* VIN */}
                    <td style={{ ...td }}>
                      <div style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8", letterSpacing: "0.03em" }}
                        title={exp.description}>
                        {exp.vin || (exp.description?.match(/[A-HJ-NPR-Z0-9]{17}/) || [])[0] || "—"}
                      </div>
                      {exp.notes && (
                        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {exp.notes}
                        </div>
                      )}
                    </td>

                    {/* Vendor */}
                    <td style={{ ...td, color: "#9ca3af", fontSize: 12, whiteSpace: "nowrap" }}>
                      {exp.vendor || "—"}
                      {exp.invoiceNumber && <div style={{ fontSize: 11, color: "#6b7280" }}>#{exp.invoiceNumber}</div>}
                    </td>

                    {/* Amount */}
                    <td style={{ ...td, textAlign: "right", fontWeight: 600, color: "#f1f5f9", fontVariantNumeric: "tabular-nums" }}>
                      {fmt$(exp.amount)}
                    </td>

                    {/* Order */}
                    <td style={{ ...td, color: "#60a5fa" }}>
                      {exp.orderRef ? `#${exp.orderRef}` : "—"}
                    </td>

                    {/* Status */}
                    <td style={td}>
                      {exp.status === "paid" ? (
                        <div>
                          <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: "#34d39922", color: "#34d399" }}>
                            Paid
                          </span>
                          {exp.paidDate && (
                            <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>{fmtDate(exp.paidDate)}</div>
                          )}
                          {exp.paymentMethod && (
                            <div style={{ fontSize: 10, color: "#60a5fa", marginTop: 1 }}>{exp.paymentMethod}</div>
                          )}
                        </div>
                      ) : (
                        <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: "#f8717122", color: "#f87171" }}>
                          Unpaid
                        </span>
                      )}
                    </td>

                    {/* Docs — bill + receipt combined */}
                    <td style={{ ...td, whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
                      {exp.billFileName
                        ? <a href={`${API}/api/expenses/${exp._id}/bill`} target="_blank" rel="noopener noreferrer" title="View bill" style={{ color: "#a78bfa", fontSize: 16, textDecoration: "none", marginRight: 6 }}>📄</a>
                        : <span style={{ color: "#2d3748", marginRight: 6 }}>📄</span>}
                      {exp.receiptFileName
                        ? <a href={`${API}/api/expenses/${exp._id}/receipt`} target="_blank" rel="noopener noreferrer" title="View receipt" style={{ color: "#60a5fa", fontSize: 16, textDecoration: "none" }}>📎</a>
                        : <span style={{ color: "#2d3748" }}>📎</span>}
                    </td>

                    {/* Actions */}
                    <td style={{ ...td, textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        {exp.status === "unpaid" && (
                          <button onClick={() => markPaid(exp)} title="Mark as paid" style={{
                            background: "#34d39920", color: "#34d399", border: "none", borderRadius: 5,
                            padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                          }}>
                            Mark Paid
                          </button>
                        )}
                        <button onClick={() => openEdit(exp)} title="Edit" style={{
                          background: "#3b82f620", color: "#60a5fa", border: "none", borderRadius: 5,
                          padding: "4px 10px", fontSize: 11, cursor: "pointer",
                        }}>
                          Edit
                        </button>
                        {exp.status === "paid"
                          ? <span title="Mark as unpaid first to delete" style={{ color: "#374151", fontSize: 11, padding: "4px 8px", cursor: "not-allowed" }}>🔒</span>
                          : <button onClick={() => setConfirmDelete(exp)} title="Delete" style={{
                              background: "#f8717120", color: "#f87171", border: "none", borderRadius: 5,
                              padding: "4px 8px", fontSize: 11, cursor: "pointer",
                            }}>✕</button>
                        }
                      </div>
                    </td>

                  </tr>
                ))}
              </tbody>

              {/* Totals row */}
              {displayList.length > 1 && (
                <tfoot>
                  <tr style={{ background: "#1a2235", borderTop: "2px solid #2d3748" }}>
                    <td colSpan={4} style={{ ...td, color: "#9ca3af", fontWeight: 600 }}>
                      Total ({displayList.length} items)
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "#f1f5f9", fontSize: 14 }}>
                      {fmt$(displayList.reduce((s, e) => s + (e.amount || 0), 0))}
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <Modal title={editing ? "Edit Expense" : "Add Expense"} onClose={() => setShowModal(false)}>
          <ExpenseForm
            form={form}
            setForm={setForm}
            onSubmit={handleSubmit}
            saving={saving}
            billFile={billFile}       setBillFile={setBillFile}
            existingBill={editing?.billFileName ? editing : null}
            onRemoveBill={removeBill}
            receiptFile={receiptFile} setReceiptFile={setReceiptFile}
            existingReceipt={editing?.receiptFileName ? editing : null}
            onRemoveReceipt={removeReceipt}
            vendors={vendors}
          />
        </Modal>
      )}

      {/* ── Sticky Pay Bills Bar ── */}
      {selectedIds.length > 0 && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
          background: "#0f1623", borderTop: "2px solid #f59e0b",
          padding: "14px 32px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.5)",
        }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "#9ca3af" }}>Selected: <strong style={{ color: "#f1f5f9" }}>{selectedIds.length} bill{selectedIds.length !== 1 ? "s" : ""}</strong></span>
              <span style={{ fontSize: 13, color: "#9ca3af" }}>Total: <strong style={{ color: "#34d399", fontSize: 18 }}>{fmt$(selectedTotal)}</strong></span>
            </div>
            {Object.keys(selectedByVendor).length > 1 && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {Object.entries(selectedByVendor).map(([vendor, amt]) => (
                  <span key={vendor} style={{ fontSize: 11, color: "#9ca3af", background: "#1e2433", borderRadius: 5, padding: "2px 8px", border: "1px solid #374151" }}>
                    <span style={{ color: "#f1f5f9" }}>{vendor}</span>
                    <span style={{ color: "#f59e0b", marginLeft: 6, fontWeight: 600 }}>{fmt$(amt)}</span>
                  </span>
                ))}
              </div>
            )}
            {Object.keys(selectedByVendor).length === 1 && (
              <div style={{ fontSize: 11, color: "#9ca3af" }}>
                Vendor: <span style={{ color: "#f1f5f9" }}>{Object.keys(selectedByVendor)[0]}</span>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: "#9ca3af" }}>Date Paid</label>
            <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
              style={{ background: "#1e2433", border: "1px solid #374151", borderRadius: 7, padding: "7px 10px", color: "#f1f5f9", fontSize: 13 }} />

            <label style={{ fontSize: 12, color: "#9ca3af" }}>Method</label>
            <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
              style={{ background: "#1e2433", border: "1px solid #374151", borderRadius: 7, padding: "7px 12px", color: "#f1f5f9", fontSize: 13, minWidth: 130 }}>
              <option>Bank ACH</option>
              <option>Zelle</option>
              <option>Venmo</option>
              <option>Check</option>
              <option>Wire</option>
              <option>Cash</option>
              <option>Other</option>
            </select>

            {(allSelectedUnpaid || mixedSelection) && (
              <button onClick={() => bulkAction("pay")} disabled={paying}
                style={{ background: "#059669", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                {paying ? "Saving…" : `✅ Mark ${selectedIds.length} as Paid`}
              </button>
            )}
            {(allSelectedPaid || mixedSelection) && (
              <button onClick={() => bulkAction("unpay")} disabled={paying}
                style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                {paying ? "Saving…" : `↩ Mark ${selectedIds.length} as Unpaid`}
              </button>
            )}

            <button onClick={bulkDelete}
              style={{ background: "#7f1d1d", color: "#fca5a5", border: "1px solid #991b1b", borderRadius: 8, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              🗑 Delete Unpaid
            </button>
            <button onClick={() => setSelected({})}
              style={{ background: "transparent", color: "#9ca3af", border: "1px solid #374151", borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" }}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Confirm Delete */}
      {confirmDelete && (
        <Modal title="Delete Expense" onClose={() => setConfirmDelete(null)}>
          <p style={{ color: "#e2e8f0", fontSize: 14, marginTop: 0 }}>
            Delete <strong>{confirmDelete.description}</strong> ({fmt$(confirmDelete.amount)})?
            This cannot be undone.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setConfirmDelete(null)} style={{
              background: "#374151", color: "#9ca3af", border: "none", borderRadius: 7,
              padding: "8px 18px", fontSize: 13, cursor: "pointer",
            }}>Cancel</button>
            <button onClick={() => doDelete(confirmDelete._id)} style={{
              background: "#ef4444", color: "#fff", border: "none", borderRadius: 7,
              padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
