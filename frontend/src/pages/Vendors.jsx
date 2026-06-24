const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

import { useEffect, useState, useRef } from "react";


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
  if (!n) return "$0.00";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

// ── Modal shell ───────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16 }}
      onClick={onClose}>
      <div style={{ background:"var(--bg-panel)",borderRadius:12,padding:28,width:"100%",maxWidth:wide?780:600,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.5)" }}
        onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <h2 style={{ margin:0,fontSize:18,color:"var(--text-primary)" }}>{title}</h2>
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#9ca3af",fontSize:22,cursor:"pointer",lineHeight:1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width:"100%",padding:"8px 10px",background:"var(--bg-elevated)",border:"1px solid var(--border)",borderRadius:6,color:"var(--text-primary)",fontSize:13,boxSizing:"border-box",marginTop:4 };
const labelStyle = { display:"block",fontSize:12,color:"#9ca3af",marginBottom:2 };

// ── Vendor Form ───────────────────────────────────────────────────────────────
const EMPTY_VENDOR = { name:"",contactName:"",phone:"",email:"",address:"",city:"",state:"",zip:"",category:"",notes:"" };

function VendorForm({ form, setForm, onSubmit, saving, submitLabel="Save Vendor" }) {
  const inp = k => ({ value: form[k]||"", onChange: e => setForm(f=>({...f,[k]:e.target.value})) });
  return (
    <form onSubmit={onSubmit}>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <label style={{ ...labelStyle, gridColumn:"1/-1" }}>
          Vendor Name *
          <input {...inp("name")} required style={inputStyle} placeholder="Company or individual name" />
        </label>
        <label style={labelStyle}>
          Contact Name
          <input {...inp("contactName")} style={inputStyle} placeholder="Primary contact" />
        </label>
        <label style={labelStyle}>
          Phone
          <input {...inp("phone")} style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, gridColumn:"1/-1" }}>
          Email
          <input {...inp("email")} type="email" style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, gridColumn:"1/-1" }}>
          Address
          <input {...inp("address")} style={inputStyle} />
        </label>
        <label style={labelStyle}>City <input {...inp("city")} style={inputStyle} /></label>
        <label style={labelStyle}>State <input {...inp("state")} style={inputStyle} /></label>
        <label style={labelStyle}>Zip <input {...inp("zip")} style={inputStyle} /></label>
        <label style={labelStyle}>
          Category
          <select {...inp("category")} style={inputStyle}>
            <option value="">Select…</option>
            {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ ...labelStyle, gridColumn:"1/-1" }}>
          Notes
          <textarea {...inp("notes")} rows={2} style={{ ...inputStyle,resize:"vertical" }} />
        </label>
      </div>
      <div style={{ display:"flex",justifyContent:"flex-end",marginTop:20 }}>
        <button type="submit" disabled={saving} style={{ background:"#3b82f6",color:"#fff",border:"none",borderRadius:7,padding:"9px 22px",fontSize:13,fontWeight:600,cursor:saving?"not-allowed":"pointer",opacity:saving?0.6:1 }}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ── Expense Form (pre-filled from document parse) ─────────────────────────────
const EMPTY_EXPENSE = { category:"", description:"", vendor:"", amount:"", date:todayISO(), orderRef:"", status:"unpaid", paidDate:"", notes:"" };

function ExpenseForm({ form, setForm, onSubmit, saving, receiptFile, setReceiptFile }) {
  const inp = k => ({ value: form[k]||"", onChange: e => setForm(f=>({...f,[k]:e.target.value})) });
  return (
    <form onSubmit={onSubmit}>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <label style={{ ...labelStyle, gridColumn:"1/-1" }}>
          Category *
          <select {...inp("category")} required style={inputStyle}>
            <option value="">Select…</option>
            {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ ...labelStyle, gridColumn:"1/-1" }}>
          Description *
          <input {...inp("description")} required style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Vendor *
          <input {...inp("vendor")} required style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Amount ($) *
          <input type="number" min="0" step="0.01" required {...inp("amount")} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Date *
          <input type="date" {...inp("date")} required style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Order # (optional)
          <input {...inp("orderRef")} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Status
          <select {...inp("status")} style={inputStyle}>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        {form.status === "paid" && (
          <label style={labelStyle}>
            Date Paid
            <input type="date" {...inp("paidDate")} style={inputStyle} />
          </label>
        )}
        <label style={{ ...labelStyle, gridColumn:"1/-1" }}>
          Notes
          <textarea {...inp("notes")} rows={2} style={{ ...inputStyle,resize:"vertical" }} />
        </label>
        <div style={{ gridColumn:"1/-1" }}>
          <div style={labelStyle}>Attach Receipt (optional)</div>
          <input type="file" accept="image/*,.pdf"
            onChange={e=>setReceiptFile(e.target.files[0]||null)}
            style={{ ...inputStyle,padding:"6px 10px",cursor:"pointer" }} />
          {receiptFile && <div style={{ fontSize:11,color:"#9ca3af",marginTop:4 }}>{receiptFile.name}</div>}
        </div>
      </div>
      <div style={{ display:"flex",justifyContent:"flex-end",marginTop:20 }}>
        <button type="submit" disabled={saving} style={{ background:"#3b82f6",color:"#fff",border:"none",borderRadius:7,padding:"9px 22px",fontSize:13,fontWeight:600,cursor:saving?"not-allowed":"pointer",opacity:saving?0.6:1 }}>
          {saving?"Saving…":"Save Expense"}
        </button>
      </div>
    </form>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Vendors() {
  const [vendors, setVendors]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [filterCat, setFilterCat]   = useState("");

  // Modals
  const [showAdd, setShowAdd]       = useState(false);
  const [editVendor, setEditVendor] = useState(null);
  const [showWave, setShowWave]     = useState(false);
  const [showDoc, setShowDoc]       = useState(false);
  const [detailVendor, setDetailVendor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Wave paste import
  const [wavePaste, setWavePaste]   = useState("");
  const [importing, setImporting]   = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Document parse
  const [docPaste, setDocPaste]     = useState("");
  const [parsing, setParsing]       = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [vendorForm, setVendorForm] = useState(EMPTY_VENDOR);
  const [expForm, setExpForm]       = useState(EMPTY_EXPENSE);
  const [receiptFile, setReceiptFile] = useState(null);
  const [saving, setSaving]         = useState(false);
  const [parseStep, setParseStep]   = useState("paste"); // "paste" | "confirm"

  // Vendor form (add/edit)
  const [vForm, setVForm]           = useState(EMPTY_VENDOR);
  const [vSaving, setVSaving]       = useState(false);

  // Detail panel
  const [detailExpenses, setDetailExpenses] = useState([]);
  const [detailLoading, setDetailLoading]   = useState(false);

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)    params.set("search", search);
      if (filterCat) params.set("category", filterCat);
      const res  = await fetch(`${API}/api/vendors?${params}`);
      const data = await res.json();
      setVendors(Array.isArray(data) ? data : []);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchVendors(); }, [search, filterCat]);

  // ── Wave import ─────────────────────────────────────────────────────────────
  const doWaveImport = async () => {
    if (!wavePaste.trim()) return;
    setImporting(true);
    try {
      const res  = await fetch(`${API}/api/vendors/import-wave`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ text: wavePaste }),
      });
      const data = await res.json();
      setImportResult(data);
      fetchVendors();
    } catch(e) { alert("Import failed"); }
    setImporting(false);
  };

  const closeWave = () => { setShowWave(false); setWavePaste(""); setImportResult(null); };

  // ── Document parse ──────────────────────────────────────────────────────────
  const doParse = async () => {
    if (!docPaste.trim()) return;
    setParsing(true);
    try {
      const res  = await fetch(`${API}/api/vendors/parse-document`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ text: docPaste }),
      });
      const data = await res.json();
      setParsedData(data);
      setVendorForm({ ...EMPTY_VENDOR, name: data.vendor||"", contactName: data.contactName||"", phone: data.phone||"", category: data.category||"" });
      setExpForm({ ...EMPTY_EXPENSE, vendor: data.vendor||"", amount: data.amount||"", date: data.date||todayISO(), description: data.description||"", category: data.category||"", orderRef: data.orderRef||"" });
      setParseStep("confirm");
    } catch(e) { alert("Parse failed"); }
    setParsing(false);
  };

  const doSaveVendorAndExpense = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // 1. Create/find vendor
      if (vendorForm.name.trim()) {
        const checkRes = await fetch(`${API}/api/vendors?search=${encodeURIComponent(vendorForm.name)}`);
        const existing = await checkRes.json();
        const match = existing.find(v => v.name.toLowerCase() === vendorForm.name.toLowerCase());
        if (!match) {
          await fetch(`${API}/api/vendors`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(vendorForm) });
        }
      }

      // 2. Create expense
      const fd = new FormData();
      Object.entries(expForm).forEach(([k,v]) => v!=null && fd.append(k,v));
      if (receiptFile) fd.append("receipt", receiptFile);
      const expRes = await fetch(`${API}/api/expenses`, { method:"POST", body: fd });
      if (!expRes.ok) { const err=await expRes.json(); alert(err.error||"Expense save failed"); setSaving(false); return; }

      setShowDoc(false);
      setDocPaste(""); setParsedData(null); setParseStep("paste");
      setVendorForm(EMPTY_VENDOR); setExpForm(EMPTY_EXPENSE); setReceiptFile(null);
      fetchVendors();
    } catch(err) { alert("Error: "+err.message); }
    setSaving(false);
  };

  const closeDoc = () => { setShowDoc(false); setDocPaste(""); setParsedData(null); setParseStep("paste"); setVendorForm(EMPTY_VENDOR); setExpForm(EMPTY_EXPENSE); };

  // ── Add / Edit vendor ───────────────────────────────────────────────────────
  const openAdd = () => { setVForm(EMPTY_VENDOR); setShowAdd(true); };
  const openEdit = (v) => { setEditVendor(v); setVForm({ name:v.name||"",contactName:v.contactName||"",phone:v.phone||"",email:v.email||"",address:v.address||"",city:v.city||"",state:v.state||"",zip:v.zip||"",category:v.category||"",notes:v.notes||"" }); };

  const saveVendor = async (e) => {
    e.preventDefault(); setVSaving(true);
    try {
      const url    = editVendor ? `${API}/api/vendors/${editVendor._id}` : `${API}/api/vendors`;
      const method = editVendor ? "PUT" : "POST";
      const res    = await fetch(url, { method, headers:{"Content-Type":"application/json"}, body: JSON.stringify(vForm) });
      if (!res.ok) { const err=await res.json(); alert(err.error||"Save failed"); setVSaving(false); return; }
      setShowAdd(false); setEditVendor(null); fetchVendors();
    } catch(err) { alert("Error"); }
    setVSaving(false);
  };

  // ── Detail panel ────────────────────────────────────────────────────────────
  const openDetail = async (v) => {
    setDetailVendor(v); setDetailLoading(true);
    try {
      const res  = await fetch(`${API}/api/vendors/${v._id}/expenses`);
      const data = await res.json();
      setDetailExpenses(Array.isArray(data) ? data : []);
    } catch(e) { setDetailExpenses([]); }
    setDetailLoading(false);
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const doDelete = async (id) => {
    const res = await fetch(`${API}/api/vendors/${id}`, { method:"DELETE" });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    setConfirmDelete(null);
    if (detailVendor?._id === id) setDetailVendor(null);
    fetchVendors();
  };

  const td = { padding:"11px 14px",fontSize:13,color:"var(--text-primary)",borderTop:"1px solid var(--bg-panel)" };
  const th = { padding:"10px 14px",textAlign:"left",color:"#9ca3af",fontSize:12,fontWeight:600,whiteSpace:"nowrap" };

  return (
    <div style={{ padding:"28px 32px",maxWidth:1300,margin:"0 auto" }}>

      {/* Header */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24 }}>
        <div>
          <h1 style={{ margin:0,fontSize:24,fontWeight:700,color:"var(--text-primary)" }}>Vendors</h1>
          <p style={{ margin:"4px 0 0",color:"#9ca3af",fontSize:13 }}>
            {vendors.length} vendor{vendors.length!==1?"s":""} · manage contacts &amp; track spending
          </p>
        </div>
        <div style={{ display:"flex",gap:10 }}>
          <button onClick={() => { setParseStep("paste"); setShowDoc(true); }} style={{ background:"#7c3aed",color:"#fff",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer" }}>
            📄 Add from Invoice / Dispatch
          </button>
          <button onClick={() => setShowWave(true)} style={{ background:"#0f766e",color:"#fff",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer" }}>
            🌊 Import from Wave
          </button>
          <button onClick={openAdd} style={{ background:"#3b82f6",color:"#fff",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer" }}>
            + Add Vendor
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display:"flex",gap:10,marginBottom:18 }}>
        <input placeholder="Search vendors…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{ background:"var(--bg-panel)",border:"1px solid var(--border)",borderRadius:7,color:"var(--text-primary)",padding:"8px 12px",fontSize:13,width:260 }} />
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{ background:"var(--bg-panel)",border:"1px solid var(--border)",borderRadius:7,color:filterCat?"var(--text-primary)":"#9ca3af",padding:"8px 12px",fontSize:13 }}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        {(search||filterCat) && (
          <button onClick={()=>{setSearch("");setFilterCat("");}} style={{ background:"none",border:"1px solid var(--border)",borderRadius:7,color:"#9ca3af",padding:"8px 12px",fontSize:12,cursor:"pointer" }}>Clear</button>
        )}
      </div>

      <div style={{ display:"flex",gap:20 }}>
        {/* Vendor Table */}
        <div style={{ flex:1,background:"#161d2c",borderRadius:12,overflow:"hidden",border:"1px solid var(--bg-panel)" }}>
          {loading ? (
            <div style={{ padding:40,textAlign:"center",color:"#6b7280" }}>Loading…</div>
          ) : vendors.length === 0 ? (
            <div style={{ padding:60,textAlign:"center" }}>
              <div style={{ fontSize:40,marginBottom:12 }}>🏢</div>
              <div style={{ color:"#9ca3af",fontSize:14,marginBottom:16 }}>No vendors yet</div>
              <div style={{ display:"flex",gap:10,justifyContent:"center" }}>
                <button onClick={()=>setShowWave(true)} style={{ background:"#0f766e",color:"#fff",border:"none",borderRadius:7,padding:"9px 16px",fontSize:13,cursor:"pointer" }}>Import from Wave</button>
                <button onClick={openAdd} style={{ background:"#3b82f6",color:"#fff",border:"none",borderRadius:7,padding:"9px 16px",fontSize:13,cursor:"pointer" }}>Add manually</button>
              </div>
            </div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%",borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"var(--bg-hover)" }}>
                    <th style={th}>Vendor</th>
                    <th style={th}>Category</th>
                    <th style={th}>Contact</th>
                    <th style={th}>Phone</th>
                    <th style={{ ...th,textAlign:"right" }}>Total Spent</th>
                    <th style={{ ...th,textAlign:"right" }}>Unpaid</th>
                    <th style={th}># Bills</th>
                    <th style={{ ...th,textAlign:"right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map(v => (
                    <tr key={v._id}
                      style={{ background: detailVendor?._id===v._id ? "var(--bg-hover)" : "#161d2c", cursor:"pointer" }}
                      onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover)"}
                      onMouseLeave={e=>e.currentTarget.style.background=detailVendor?._id===v._id?"var(--bg-hover)":"#161d2c"}
                      onClick={()=>openDetail(v)}>
                      <td style={td}>
                        <div style={{ fontWeight:600,color:"var(--text-primary)" }}>{v.name}</div>
                      </td>
                      <td style={td}>
                        {v.category ? (
                          <span style={{ display:"inline-block",padding:"2px 8px",borderRadius:5,fontSize:11,fontWeight:600,background:(CAT_COLORS[v.category]||"#9ca3af")+"22",color:CAT_COLORS[v.category]||"#9ca3af",whiteSpace:"nowrap" }}>
                            {v.category}
                          </span>
                        ) : <span style={{ color:"#4b5563",fontSize:12 }}>—</span>}
                      </td>
                      <td style={{ ...td,color:"#9ca3af" }}>{v.contactName||"—"}</td>
                      <td style={{ ...td,color:"#9ca3af" }}>{v.phone||"—"}</td>
                      <td style={{ ...td,textAlign:"right",fontWeight:600,color:"var(--text-primary)" }}>{fmt$(v.totalPaid)}</td>
                      <td style={{ ...td,textAlign:"right" }}>
                        {v.unpaidAmount > 0 ? (
                          <span style={{ color:"#f87171",fontWeight:600 }}>{fmt$(v.unpaidAmount)}</span>
                        ) : <span style={{ color:"#4b5563" }}>—</span>}
                      </td>
                      <td style={{ ...td,color:"#9ca3af" }}>{v.expenseCount||0}</td>
                      <td style={{ ...td,textAlign:"right" }}>
                        <div style={{ display:"flex",gap:6,justifyContent:"flex-end" }} onClick={e=>e.stopPropagation()}>
                          <button onClick={()=>openEdit(v)} style={{ background:"#3b82f620",color:"#60a5fa",border:"none",borderRadius:5,padding:"4px 10px",fontSize:11,cursor:"pointer" }}>Edit</button>
                          <button onClick={()=>setConfirmDelete(v)} style={{ background:"#f8717120",color:"#f87171",border:"none",borderRadius:5,padding:"4px 8px",fontSize:11,cursor:"pointer" }}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {detailVendor && (
          <div style={{ width:360,background:"#161d2c",borderRadius:12,border:"1px solid var(--bg-panel)",padding:20,flexShrink:0,maxHeight:"75vh",overflowY:"auto" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16 }}>
              <div>
                <div style={{ fontWeight:700,fontSize:16,color:"var(--text-primary)" }}>{detailVendor.name}</div>
                {detailVendor.contactName && <div style={{ fontSize:12,color:"#9ca3af",marginTop:3 }}>{detailVendor.contactName}</div>}
                {detailVendor.phone && <div style={{ fontSize:12,color:"#9ca3af" }}>{detailVendor.phone}</div>}
                {detailVendor.email && <div style={{ fontSize:12,color:"#60a5fa" }}>{detailVendor.email}</div>}
              </div>
              <button onClick={()=>setDetailVendor(null)} style={{ background:"none",border:"none",color:"#9ca3af",fontSize:18,cursor:"pointer" }}>✕</button>
            </div>

            {/* Summary */}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16 }}>
              <div style={{ background:"var(--bg-hover)",borderRadius:8,padding:"10px 12px" }}>
                <div style={{ fontSize:11,color:"#9ca3af",marginBottom:4 }}>TOTAL SPENT</div>
                <div style={{ fontSize:18,fontWeight:700,color:"var(--text-primary)" }}>{fmt$(detailVendor.totalPaid)}</div>
              </div>
              <div style={{ background:"var(--bg-hover)",borderRadius:8,padding:"10px 12px" }}>
                <div style={{ fontSize:11,color:"#9ca3af",marginBottom:4 }}>UNPAID</div>
                <div style={{ fontSize:18,fontWeight:700,color: detailVendor.unpaidAmount>0?"#f87171":"#34d399" }}>
                  {fmt$(detailVendor.unpaidAmount)}
                </div>
              </div>
            </div>

            <div style={{ fontSize:12,color:"#9ca3af",marginBottom:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em" }}>
              Expense History
            </div>

            {detailLoading ? (
              <div style={{ color:"#6b7280",fontSize:13,padding:"20px 0",textAlign:"center" }}>Loading…</div>
            ) : detailExpenses.length === 0 ? (
              <div style={{ color:"#4b5563",fontSize:13,textAlign:"center",padding:"20px 0" }}>No expenses recorded yet</div>
            ) : (
              <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                {detailExpenses.map(e => (
                  <div key={e._id} style={{ background:"var(--bg-hover)",borderRadius:8,padding:"10px 12px" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                      <div style={{ fontSize:12,color:"var(--text-primary)",fontWeight:500 }}>{e.description}</div>
                      <div style={{ fontSize:13,fontWeight:700,color:"var(--text-primary)",marginLeft:8,flexShrink:0 }}>{fmt$(e.amount)}</div>
                    </div>
                    <div style={{ display:"flex",justifyContent:"space-between",marginTop:5 }}>
                      <span style={{ fontSize:11,color:"#6b7280" }}>
                        {new Date(e.date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                        {e.orderRef ? ` · #${e.orderRef}` : ""}
                      </span>
                      <span style={{ fontSize:11,padding:"1px 6px",borderRadius:4,fontWeight:600,
                        background: e.status==="paid"?"#34d39922":"#f8717122",
                        color: e.status==="paid"?"#34d399":"#f87171" }}>
                        {e.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Wave Import Modal ─────────────────────────────────────────────────── */}
      {showWave && (
        <Modal title="🌊 Import Vendors from Wave" onClose={closeWave} wide>
          {!importResult ? (
            <>
              <div style={{ background:"var(--bg-elevated)",border:"1px solid var(--border)",borderRadius:8,padding:14,marginBottom:16 }}>
                <div style={{ fontSize:13,color:"#9ca3af",lineHeight:1.6 }}>
                  <strong style={{ color:"var(--text-primary)" }}>How to export from Wave:</strong><br/>
                  1. Go to <strong>Purchases → Vendors</strong> in Wave<br/>
                  2. Press <code style={{ background:"var(--bg-panel)",padding:"1px 5px",borderRadius:3,color:"#60a5fa" }}>Ctrl+A</code> to select all, then <code style={{ background:"var(--bg-panel)",padding:"1px 5px",borderRadius:3,color:"#60a5fa" }}>Ctrl+C</code> to copy<br/>
                  3. Paste below — the app will extract all vendor names automatically
                </div>
              </div>
              <label style={labelStyle}>
                Paste Wave vendors page text here:
                <textarea
                  value={wavePaste}
                  onChange={e=>setWavePaste(e.target.value)}
                  rows={12}
                  placeholder={"Paste the copied text from your Wave Vendors page here…\n\nExample:\nVendor\n10 AUTO TRANSPORT LLC\nTony Taiwo\nNot available\nCreate bill\n\nVendor\n1Burgos Transport LLC\n..."}
                  style={{ ...inputStyle,resize:"vertical",fontFamily:"monospace",fontSize:12 }}
                />
              </label>
              <div style={{ display:"flex",justifyContent:"flex-end",marginTop:16,gap:10 }}>
                <button onClick={closeWave} style={{ background:"var(--border)",color:"#9ca3af",border:"none",borderRadius:7,padding:"9px 18px",fontSize:13,cursor:"pointer" }}>Cancel</button>
                <button onClick={doWaveImport} disabled={importing||!wavePaste.trim()} style={{ background:"#0f766e",color:"#fff",border:"none",borderRadius:7,padding:"9px 22px",fontSize:13,fontWeight:600,cursor:"pointer",opacity:importing||!wavePaste.trim()?0.5:1 }}>
                  {importing ? "Importing…" : "Import Vendors"}
                </button>
              </div>
            </>
          ) : (
            <div style={{ textAlign:"center",padding:"20px 0" }}>
              <div style={{ fontSize:48,marginBottom:12 }}>✅</div>
              <div style={{ fontSize:20,fontWeight:700,color:"var(--text-primary)",marginBottom:8 }}>Import Complete</div>
              <div style={{ display:"flex",justifyContent:"center",gap:24,marginBottom:20 }}>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:28,fontWeight:700,color:"#34d399" }}>{importResult.created}</div>
                  <div style={{ fontSize:12,color:"#9ca3af" }}>Created</div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:28,fontWeight:700,color:"#9ca3af" }}>{importResult.skipped}</div>
                  <div style={{ fontSize:12,color:"#9ca3af" }}>Already existed</div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:28,fontWeight:700,color:"var(--text-primary)" }}>{importResult.total}</div>
                  <div style={{ fontSize:12,color:"#9ca3af" }}>Total parsed</div>
                </div>
              </div>
              <button onClick={closeWave} style={{ background:"#3b82f6",color:"#fff",border:"none",borderRadius:7,padding:"10px 28px",fontSize:14,fontWeight:600,cursor:"pointer" }}>Done</button>
            </div>
          )}
        </Modal>
      )}

      {/* ── Document Parse Modal ───────────────────────────────────────────────── */}
      {showDoc && (
        <Modal title="📄 Add from Invoice / Dispatch" onClose={closeDoc} wide>
          {parseStep === "paste" ? (
            <>
              <div style={{ background:"var(--bg-elevated)",border:"1px solid var(--border)",borderRadius:8,padding:12,marginBottom:14,fontSize:13,color:"#9ca3af",lineHeight:1.6 }}>
                Paste the text from any <strong style={{ color:"var(--text-primary)" }}>invoice, dispatch sheet, or bill</strong> below.
                The app will automatically extract the vendor, amount, date, and description — then let you confirm before saving.
              </div>
              <label style={labelStyle}>
                Paste document text:
                <textarea
                  value={docPaste}
                  onChange={e=>setDocPaste(e.target.value)}
                  rows={14}
                  placeholder={"Paste the full text of an invoice, Central Dispatch confirmation, bill, etc.\n\nWorks with:\n• Central Dispatch carrier confirmations\n• Invoices / bills\n• Towing receipts\n• Port / terminal charge sheets"}
                  style={{ ...inputStyle,resize:"vertical",fontFamily:"monospace",fontSize:12 }}
                />
              </label>
              <div style={{ display:"flex",justifyContent:"flex-end",marginTop:16,gap:10 }}>
                <button onClick={closeDoc} style={{ background:"var(--border)",color:"#9ca3af",border:"none",borderRadius:7,padding:"9px 18px",fontSize:13,cursor:"pointer" }}>Cancel</button>
                <button onClick={doParse} disabled={parsing||!docPaste.trim()} style={{ background:"#7c3aed",color:"#fff",border:"none",borderRadius:7,padding:"9px 22px",fontSize:13,fontWeight:600,cursor:"pointer",opacity:parsing||!docPaste.trim()?0.5:1 }}>
                  {parsing ? "Parsing…" : "Parse Document →"}
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={doSaveVendorAndExpense}>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:20 }}>

                {/* Vendor section */}
                <div>
                  <div style={{ fontSize:13,fontWeight:600,color:"var(--text-primary)",marginBottom:12,paddingBottom:8,borderBottom:"1px solid var(--border)" }}>
                    Vendor {vendorForm.name ? <span style={{ fontSize:11,color:"#34d399",fontWeight:400 }}>— will be created if new</span> : ""}
                  </div>
                  <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                    <label style={labelStyle}>
                      Vendor Name *
                      <input value={vendorForm.name||""} onChange={e=>setVendorForm(f=>({...f,name:e.target.value}))} required style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Contact Name
                      <input value={vendorForm.contactName||""} onChange={e=>setVendorForm(f=>({...f,contactName:e.target.value}))} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Phone
                      <input value={vendorForm.phone||""} onChange={e=>setVendorForm(f=>({...f,phone:e.target.value}))} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Category
                      <select value={vendorForm.category||""} onChange={e=>setVendorForm(f=>({...f,category:e.target.value}))} style={inputStyle}>
                        <option value="">Select…</option>
                        {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                  </div>
                </div>

                {/* Expense section */}
                <div>
                  <div style={{ fontSize:13,fontWeight:600,color:"var(--text-primary)",marginBottom:12,paddingBottom:8,borderBottom:"1px solid var(--border)" }}>
                    Expense / Bill
                  </div>
                  <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                    <label style={labelStyle}>
                      Category *
                      <select value={expForm.category||""} onChange={e=>setExpForm(f=>({...f,category:e.target.value}))} required style={inputStyle}>
                        <option value="">Select…</option>
                        {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                    <label style={labelStyle}>
                      Description *
                      <input value={expForm.description||""} onChange={e=>setExpForm(f=>({...f,description:e.target.value}))} required style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Amount ($) *
                      <input type="number" min="0" step="0.01" required value={expForm.amount||""} onChange={e=>setExpForm(f=>({...f,amount:e.target.value}))} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Date *
                      <input type="date" required value={expForm.date||todayISO()} onChange={e=>setExpForm(f=>({...f,date:e.target.value}))} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      Order # (optional)
                      <input value={expForm.orderRef||""} onChange={e=>setExpForm(f=>({...f,orderRef:e.target.value}))} style={inputStyle} placeholder="Link to order" />
                    </label>
                    <label style={labelStyle}>
                      Status
                      <select value={expForm.status||"unpaid"} onChange={e=>setExpForm(f=>({...f,status:e.target.value}))} style={inputStyle}>
                        <option value="unpaid">Unpaid</option>
                        <option value="paid">Paid</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              {/* Receipt upload */}
              <div style={{ marginTop:16 }}>
                <label style={labelStyle}>
                  Attach Receipt (optional)
                  <input type="file" accept="image/*,.pdf" onChange={e=>setReceiptFile(e.target.files[0]||null)}
                    style={{ ...inputStyle,padding:"6px 10px",cursor:"pointer" }} />
                </label>
              </div>

              <div style={{ display:"flex",justifyContent:"space-between",marginTop:20 }}>
                <button type="button" onClick={()=>setParseStep("paste")} style={{ background:"none",border:"1px solid var(--border)",borderRadius:7,color:"#9ca3af",padding:"9px 16px",fontSize:13,cursor:"pointer" }}>
                  ← Back
                </button>
                <button type="submit" disabled={saving} style={{ background:"#7c3aed",color:"#fff",border:"none",borderRadius:7,padding:"9px 22px",fontSize:13,fontWeight:600,cursor:saving?"not-allowed":"pointer",opacity:saving?0.6:1 }}>
                  {saving ? "Saving…" : "✓ Create Vendor + Save Expense"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* ── Add / Edit Vendor Modal ───────────────────────────────────────────── */}
      {(showAdd || editVendor) && (
        <Modal title={editVendor ? "Edit Vendor" : "Add Vendor"} onClose={()=>{setShowAdd(false);setEditVendor(null);}}>
          <VendorForm form={vForm} setForm={setVForm} onSubmit={saveVendor} saving={vSaving} />
        </Modal>
      )}

      {/* ── Confirm Delete ───────────────────────────────────────────────────── */}
      {confirmDelete && (
        <Modal title="Delete Vendor" onClose={()=>setConfirmDelete(null)}>
          <p style={{ color:"var(--text-primary)",fontSize:14,marginTop:0 }}>
            Delete <strong>{confirmDelete.name}</strong>? This cannot be undone.
          </p>
          <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
            <button onClick={()=>setConfirmDelete(null)} style={{ background:"var(--border)",color:"#9ca3af",border:"none",borderRadius:7,padding:"8px 18px",fontSize:13,cursor:"pointer" }}>Cancel</button>
            <button onClick={()=>doDelete(confirmDelete._id)} style={{ background:"#ef4444",color:"#fff",border:"none",borderRadius:7,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer" }}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
