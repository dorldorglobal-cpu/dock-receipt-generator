import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const LOAD_STATUS_COLORS = {
  "Pending": { bg:"rgba(251,191,36,0.12)",  border:"rgba(251,191,36,0.35)",  text:"#fbbf24" },
  "Booked":  { bg:"rgba(37,99,235,0.12)",   border:"rgba(37,99,235,0.35)",   text:"#60a5fa" },
  "Loaded":  { bg:"rgba(124,58,237,0.12)",  border:"rgba(124,58,237,0.35)",  text:"#a78bfa" },
  "Sailed":  { bg:"rgba(52,211,153,0.12)",  border:"rgba(52,211,153,0.35)",  text:"#34d399" },
  "Arrived": { bg:"rgba(74,222,128,0.12)",  border:"rgba(74,222,128,0.35)",  text:"#4ade80" },
};
const ORDER_STATUS_COLORS = {
  "New Order":       { bg:"rgba(96,165,250,0.12)",  border:"rgba(96,165,250,0.35)",  text:"#60a5fa" },
  "Waiting to Sail": { bg:"rgba(251,191,36,0.12)",  border:"rgba(251,191,36,0.35)",  text:"#fbbf24" },
  "Sailed":          { bg:"rgba(52,211,153,0.12)",  border:"rgba(52,211,153,0.35)",  text:"#34d399" },
  "Arrived":         { bg:"rgba(74,222,128,0.12)",  border:"rgba(74,222,128,0.35)",  text:"#4ade80" },
  "Completed":       { bg:"rgba(148,163,184,0.12)", border:"rgba(148,163,184,0.35)", text:"#94a3b8" },
};
function loadSC(s) { return LOAD_STATUS_COLORS[s] || LOAD_STATUS_COLORS["Pending"]; }
function orderSC(s) { return ORDER_STATUS_COLORS[s] || { bg:"rgba(99,102,241,0.1)", border:"rgba(99,102,241,0.3)", text:"#818cf8" }; }

// Styles
const inp  = { padding:"8px 12px", borderRadius:8, border:"1px solid var(--border)",
  background:"var(--bg-input)", color:"var(--text-primary)", fontSize:13, width:"100%", boxSizing:"border-box" };
const lbl  = { fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4, fontWeight:600, letterSpacing:"0.04em" };
const sec  = (color="#a78bfa") => ({
  fontSize:11, fontWeight:700, color, margin:"18px 0 10px",
  textTransform:"uppercase", letterSpacing:"0.07em", borderBottom:`1px solid var(--border)`, paddingBottom:6,
});

function F({ label, value, onChange, placeholder, type="text", full }) {
  return (
    <div style={full ? { gridColumn:"1/-1" } : {}}>
      <label style={lbl}>{label}</label>
      <input type={type} value={value||""} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder||""} style={inp} />
    </div>
  );
}

// Defined at module level (not inside the component) so React never recreates it
// as a new component type on re-render — that was causing inputs to lose focus
// after every keystroke.
function ConsigneeSection({ vals, set }) {
  return (
    <>
      <div style={sec()}>Consignee Info</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <F label="NAME" value={vals.consigneeName} onChange={set("consigneeName")} full />
        <F label="ADDRESS / CITY / COUNTRY" value={vals.consigneeAddress} onChange={set("consigneeAddress")} placeholder="Street, City, Country" full />
        <F label="PHONE" value={vals.consigneePhone} onChange={set("consigneePhone")} placeholder="+1 000 000 0000" />
        <F label="EMAIL" value={vals.consigneeEmail} onChange={set("consigneeEmail")} type="email" />
        <F label="TIN #" value={vals.consigneeTin} onChange={set("consigneeTin")} full />
      </div>
      <div style={sec()}>Notify Party Info</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <F label="NAME" value={vals.notifyName} onChange={set("notifyName")} full />
        <F label="ADDRESS / CITY / COUNTRY" value={vals.notifyAddress} onChange={set("notifyAddress")} placeholder="Street, City, Country" full />
        <F label="PHONE" value={vals.notifyPhone} onChange={set("notifyPhone")} placeholder="+1 000 000 0000" />
        <F label="EMAIL" value={vals.notifyEmail} onChange={set("notifyEmail")} type="email" />
        <F label="TIN #" value={vals.notifyTin} onChange={set("notifyTin")} full />
      </div>
    </>
  );
}

const BLANK = {
  name:"", vessel:"", pol:"NJ", pod:"", loaderEmail:"", notes:"",
  consigneeName:"", consigneeAddress:"", consigneePhone:"", consigneeEmail:"", consigneeTin:"",
  notifyName:"", notifyAddress:"", notifyPhone:"", notifyEmail:"", notifyTin:"",
};

// Build email draft on frontend (mirrors backend logic)
function buildDraft(form, orders) {
  const dest    = (form.pod || "DESTINATION").toUpperCase();
  const cust    = orders[0]?.customerName || "";
  const subject = `${form.name} CONTAINER TO ${dest} - ${cust}`.trim();

  const cBlock = [
    "CONSIGNEE INFO",
    form.consigneeName    || "—",
    form.consigneeAddress || "—",
    form.consigneePhone   ? `TEL: ${form.consigneePhone}`   : null,
    form.consigneeEmail   ? `EMAIL: ${form.consigneeEmail}` : null,
    form.consigneeTin     ? `TIN#: ${form.consigneeTin}`    : null,
  ].filter(Boolean).join("\n");

  const nBlock = [
    "NOTIFY PARTY INFO",
    form.notifyName    || "—",
    form.notifyAddress || "—",
    form.notifyPhone   ? `TEL: ${form.notifyPhone}`   : null,
    form.notifyEmail   ? `EMAIL: ${form.notifyEmail}` : null,
    form.notifyTin     ? `TIN#: ${form.notifyTin}`    : null,
  ].filter(Boolean).join("\n");

  const unitLines = orders.map(o => {
    const ymm = [o.year, o.make, o.model].filter(Boolean).join(" ") || "—";
    return `${ymm}   ${o.vin || "—"}`;
  }).join("\n");

  const body = [
    `SEE ATTACHED LOAD LIST FOR CONTAINER TO ${dest}`,
    `PLEASE CONFIRM THIS UNIT AND ITS TITLE`,
    ``,
    cBlock,
    ``,
    nBlock,
    ``,
    unitLines,
    ``,
    `Thank you,`,
    `Dor Ldor Global`,
  ].join("\n");

  return { to:"info@e-zcargo.com", cc:"shipping@e-zcargo.com", subject, body };
}

export default function Containers() {
  const navigate = useNavigate();
  const [loads,     setLoads]     = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [search,    setSearch]    = useState("");
  const [expanded,  setExpanded]  = useState({});
  const [msg,       setMsg]       = useState("");

  // New load modal
  const [showNew,     setShowNew]     = useState(false);
  const [form,        setForm]        = useState(BLANK);
  const [orderSearch, setOrderSearch] = useState("");
  const [picked,      setPicked]      = useState([]);
  const [creating,    setCreating]    = useState(false);

  // Email preview modal
  const [emailModal,  setEmailModal]  = useState(null); // { loadId, to, cc, subject, body }
  const [sendingEmail,setSendingEmail]= useState(false);

  // Billing summary modal
  const [billingLoad,   setBillingLoad]   = useState(null);
  const [billingRows,   setBillingRows]   = useState([]);
  const [billingLoading,setBillingLoading]= useState(false);
  const [sendingAll,    setSendingAll]    = useState(false);
  const [sendResults,   setSendResults]   = useState(null);
  const [sendPreview,   setSendPreview]   = useState(null); // { to, subject, body }

  // Edit modal
  const [editLoad,    setEditLoad]    = useState(null);
  const [editForm,    setEditForm]    = useState({});
  const [editTab,     setEditTab]     = useState("details"); // details | consignee | orders | docs
  const [savingEdit,  setSavingEdit]  = useState(false);
  const [loadFiles,   setLoadFiles]   = useState([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [parsedBL,    setParsedBL]    = useState(null);
  const [dragOver,    setDragOver]    = useState(false);
  const [renamingFile, setRenamingFile] = useState(null); // { id, name }
  const [draftBlEmail, setDraftBlEmail] = useState(null); // { to, subject, body }
  const [sendingDraftBl, setSendingDraftBl] = useState(false);


  const refresh = () => {
    fetch(`${API}/api/container-loads`).then(r=>r.json()).then(d=>setLoads(Array.isArray(d)?d:[])).catch(()=>{});
    fetch(`${API}/api/orders`).then(r=>r.json())
      .then(d => setAllOrders(Array.isArray(d)?d:[]))
      .catch(()=>{});
  };
  useEffect(refresh, []);

  const flash = (m) => { setMsg(m); setTimeout(()=>setMsg(""),4000); };
  const setF  = k => v => setForm(f=>({...f,[k]:v}));
  const setEF = k => v => setEditForm(f=>({...f,[k]:v}));

  // Available orders: Container type, NOT Canceled, NO existing booking number, NOT already in a load
  const loadedIds = new Set(loads.flatMap(l=>(l.orderIds||[]).map(o=>o._id||o)));
  const availableOrders = allOrders.filter(o =>
    o.requestType === "Container" &&
    o.status !== "Canceled" &&
    !o.bookingNumber &&
    !loadedIds.has(o._id)
  );
  const filteredAvail = availableOrders.filter(o => {
    const s = orderSearch.toLowerCase();
    return !s || `${o.refNumber} ${o.vin} ${o.customerName} ${o.make} ${o.model}`.toLowerCase().includes(s);
  });

  const togglePick = id => {
    setPicked(p => {
      const isAdding = !p.includes(id);
      const next = isAdding ? [...p, id] : p.filter(x=>x!==id);
      if (isAdding && p.length === 0) {
        const o = availableOrders.find(x=>x._id===id);
        if (o) {
          const addr = [o.consigneeAddress, o.consigneeCity, o.consigneeCountry].filter(Boolean).join(", ");
          setForm(f=>({
            ...f,
            consigneeName:    f.consigneeName    || o.consigneeName || "",
            consigneeAddress: f.consigneeAddress || addr            || "",
            pod:              f.pod              || o.pod           || "",
            vessel:           f.vessel           || o.vessel        || "",
          }));
        }
      }
      return next;
    });
  };

  const openNew = () => {
    const d = new Date();
    const name = `LOAD-${d.toLocaleString("en-US",{month:"short"}).toUpperCase()}${d.getDate()}`;
    setForm({ ...BLANK, name });
    setPicked([]); setOrderSearch(""); setShowNew(true);
  };

  const createLoad = async () => {
    if (!picked.length) return alert("Select at least one order");
    setCreating(true);
    try {
      const res  = await fetch(`${API}/api/container-loads`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ ...form, orderIds: picked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||"Failed");

      setShowNew(false);
      refresh();

      // Build email draft and open preview modal
      const pickedOrders = availableOrders.filter(o=>picked.includes(o._id));
      const draft = buildDraft(form, pickedOrders);
      setEmailModal({ loadId: data._id, ...draft });
    } catch(e) { flash("❌ "+e.message); }
    setCreating(false);
  };

  const sendEmail = async () => {
    setSendingEmail(true);
    try {
      const { loadId, to, cc, subject, body } = emailModal;
      const res = await fetch(`${API}/api/container-loads/${loadId}/send-email`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ to, cc, subject, body }),
      });
      if (!res.ok) { const d=await res.json(); throw new Error(d.error||"Failed"); }
      flash("✅ Email sent to "+to);
      setEmailModal(null);
      refresh();
    } catch(e) { flash("❌ "+e.message); }
    setSendingEmail(false);
  };

  const openEdit = l => {
    setEditLoad(l);
    setEditForm({
      bookingNumber:    l.bookingNumber    || "",
      containerNumber:  l.containerNumber  || "",
      sealNumber:       l.sealNumber       || "",
      sailCutoff:       l.sailCutoff       || "",
      arrivalDate:      l.arrivalDate      || "",
      status:           l.status           || "Pending",
      vessel:           l.vessel           || "",
      pol:              l.pol              || "",
      pod:              l.pod              || "",
      loaderEmail:      l.loaderEmail      || "",
      notes:            l.notes            || "",
      consigneeName:    l.consigneeName    || "",
      consigneeAddress: l.consigneeAddress || "",
      consigneePhone:   l.consigneePhone   || "",
      consigneeEmail:   l.consigneeEmail   || "",
      consigneeTin:     l.consigneeTin     || "",
      notifyName:       l.notifyName       || "",
      notifyAddress:    l.notifyAddress    || "",
      notifyPhone:      l.notifyPhone      || "",
      notifyEmail:      l.notifyEmail      || "",
      notifyTin:        l.notifyTin        || "",
    });
    setEditTab("details");
    setLoadFiles([]);
    setParsedBL(null);
    fetchLoadFiles(l._id);
  };

  const saveEdit = async () => {
    setSavingEdit(true);
    try {
      const res = await fetch(`${API}/api/container-loads/${editLoad._id}`, {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(editForm),
      });
      if (!res.ok) { const d=await res.json(); throw new Error(d.error||"Failed"); }
      flash("✅ Load updated");
      setEditLoad(null);
      refresh();
    } catch(e) { flash("❌ "+e.message); }
    setSavingEdit(false);
  };

  const openEmailFromLoad = l => {
    const orders = l.orderIds || [];
    const draft  = buildDraft(l, orders);
    setEmailModal({ loadId: l._id, ...draft });
  };

  const deleteLoad = async l => {
    if (!window.confirm(`Delete load "${l.name}"?`)) return;
    await fetch(`${API}/api/container-loads/${l._id}`, { method:"DELETE" });
    refresh();
  };

  const filtered = loads.filter(l => {
    const s = search.toLowerCase();
    if (!s) return true;
    return `${l.name} ${l.bookingNumber} ${l.vessel} ${l.containerNumber}`
      .toLowerCase().includes(s)
      || (l.orderIds||[]).some(o=>
          `${o.vin||""} ${o.customerName||""} ${o.refNumber||""}`.toLowerCase().includes(s));
  });

  const TABS = [
    { id:"details",   label:"📋 Details" },
    { id:"consignee", label:"👤 Consignee & Notify" },
    { id:"orders",    label:`📦 Orders (${editLoad ? (editLoad.orderIds||[]).length : 0})` },
    { id:"docs",      label:`📄 Docs${loadFiles.length ? ` (${loadFiles.length})` : ""}` },
  ];

  const fetchLoadFiles = async (loadId) => {
    try {
      const r = await fetch(`${API}/api/container-loads/${loadId}/files`);
      const d = await r.json();
      setLoadFiles(Array.isArray(d) ? d : []);
    } catch (_) { setLoadFiles([]); }
  };

  const uploadDocFile = async (file, label = "Document") => {
    if (!editLoad) return;
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("label", label);
      const r = await fetch(`${API}/api/container-loads/${editLoad._id}/upload`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed");
      setEditLoad(d);
      await fetchLoadFiles(editLoad._id);
      if (d.parsed && Object.values(d.parsed).some(v => v && (typeof v === "string" ? v.length : v.length))) {
        setParsedBL(d.parsed);
        flash("✅ Uploaded and parsed — review fields below");
      } else {
        flash("✅ File uploaded");
      }
    } catch (e) {
      flash("❌ " + e.message);
    } finally {
      setUploadingDoc(false);
    }
  };

  const openDraftBlEmail = (load) => {
    const orders = (load.orderIds || []);
    const booking = load.bookingNumber || "";
    const vessel  = load.vessel || "";
    const pol     = load.pol || "";
    const pod     = load.pod || "";
    const customerEmail = orders[0]?.customerEmail || "";
    const to = customerEmail ? customerEmail.split(",")[0].trim() : "";
    const subject = `Draft BL — ${load.name}${booking ? " / Booking " + booking : ""}${vessel ? " / " + vessel : ""}`;
    const vehicleLines = orders.map(o => {
      const ymm = [o.year, o.make, o.model].filter(Boolean).join(" ") || "—";
      return `  • ${ymm}${o.vin ? " | VIN: " + o.vin : ""}${o.refNumber ? " (Ref #" + o.refNumber + ")" : ""}`;
    }).join("\n");
    const body = `Dear Customer,\n\nPlease see attached Draft Bill of Lading for the following vehicles:\n\n${vehicleLines}\n\nVessel: ${vessel || "—"}\nBooking #: ${booking || "—"}\nPOL: ${pol || "—"}\nPOD: ${pod || "—"}\n\nPlease review and confirm all details. Let us know if any corrections are needed before the final BL is issued.\n\nThank you,\nEli Levy\nDor Ldor Global\n9172003998\nDorLdorGlobal@gmail.com`;
    setDraftBlEmail({ to, subject, body, loadId: load._id });
  };

  const parseBLFile = async (file) => {
    if (!editLoad) return;
    setUploadingDoc(true);
    setParsedBL(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API}/api/container-loads/${editLoad._id}/parse-bl-file`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Parse failed");
      setParsedBL(d);
    } catch (e) {
      flash("❌ Parse failed: " + e.message);
    } finally {
      setUploadingDoc(false);
    }
  };

  const applyParsedBL = () => {
    if (!parsedBL) return;
    const updates = {};
    if (parsedBL.bookingNumber)   updates.bookingNumber   = parsedBL.bookingNumber;
    if (parsedBL.containerNumber) updates.containerNumber = parsedBL.containerNumber;
    if (parsedBL.sealNumber)      updates.sealNumber      = parsedBL.sealNumber;
    if (parsedBL.vessel)          updates.vessel          = parsedBL.vessel;
    if (parsedBL.pol)             updates.pol             = parsedBL.pol;
    if (parsedBL.pod)             updates.pod             = parsedBL.pod;
    setEditForm(f => ({ ...f, ...updates }));
    setParsedBL(null);
    flash("✅ Fields updated from BL — save to confirm");
  };

  return (
    <div>
      {msg && (
        <div style={{ position:"fixed", top:20, right:24, zIndex:9999, padding:"10px 20px",
          borderRadius:10, background: msg.startsWith("✅") ? "var(--success)" : "var(--danger)",
          color:"#fff", fontWeight:600, fontSize:14, boxShadow:"0 4px 16px rgba(0,0,0,0.3)" }}>
          {msg}
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>📦 Container Loads</h1>
          <p>Group orders into container loads, send loader emails, and track booking numbers.</p>
        </div>
        <button onClick={openNew}
          style={{ padding:"10px 18px", borderRadius:10, border:"none",
            background:"linear-gradient(135deg,#7c3aed,#5b21b6)", color:"#fff",
            cursor:"pointer", fontWeight:600, fontSize:14 }}>
          + New Container Load
        </button>
      </div>

      <div style={{ marginBottom:18, display:"flex", alignItems:"center", gap:12 }}>
        <input placeholder="Search load name, booking #, VIN, customer…"
          value={search} onChange={e=>setSearch(e.target.value)}
          style={{ ...inp, maxWidth:420 }} />
        <span style={{ fontSize:13, color:"var(--text-secondary)" }}>
          {filtered.length} load{filtered.length!==1?"s":""}
        </span>
      </div>

      {/* ── Load cards ── */}
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign:"center", padding:"60px 0", color:"var(--text-muted)" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📦</div>
            <p style={{ fontSize:15 }}>No container loads yet.</p>
          </div>
        )}

        {filtered.map(l => {
          const sc    = loadSC(l.status);
          const open  = !!expanded[l._id];
          const orders = l.orderIds || [];
          return (
            <div key={l._id} style={{ background:"var(--bg-panel)", border:"1px solid var(--border)",
              borderRadius:12, overflow:"hidden" }}>

              {/* Header row */}
              <div style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 20px",
                borderBottom: open ? "1px solid var(--border)" : "none" }}>

                <div onClick={()=>setExpanded(p=>({...p,[l._id]:!p[l._id]}))}
                  style={{ cursor:"pointer", color:"var(--text-secondary)", fontSize:15, minWidth:18 }}>
                  {open ? "▲" : "▼"}
                </div>

                <div style={{ minWidth:150 }}>
                  <div style={{ fontWeight:700, fontSize:15 }}>{l.name}</div>
                  <span style={{ fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:20,
                    background:sc.bg, border:`1px solid ${sc.border}`, color:sc.text }}>
                    {l.status}
                  </span>
                </div>

                <div style={{ flex:1, display:"flex", gap:24, minWidth:0 }}>
                  {/* Booking + Container */}
                  <div style={{ minWidth:170 }}>
                    {l.bookingNumber
                      ? <div style={{ fontWeight:600, color:"#60a5fa", fontSize:13 }}>📋 {l.bookingNumber}</div>
                      : <div style={{ color:"var(--text-muted)", fontSize:12, fontStyle:"italic" }}>No booking # yet</div>}
                    {l.containerNumber && (
                      <div style={{ fontSize:11, color:"var(--text-secondary)" }}>
                        CTR: <strong>{l.containerNumber}</strong>
                        {l.sealNumber && <> · Seal: <strong>{l.sealNumber}</strong></>}
                      </div>
                    )}
                    {(l.sailCutoff || l.arrivalDate) && (
                      <div style={{ fontSize:11, color:"var(--text-secondary)", marginTop:2 }}>
                        {l.sailCutoff && <>✂️ Cutoff: <strong>{new Date(l.sailCutoff).toLocaleDateString("en-US")}</strong></>}
                        {l.sailCutoff && l.arrivalDate && <> · </>}
                        {l.arrivalDate && <>🛬 Arrival: <strong>{new Date(l.arrivalDate).toLocaleDateString("en-US")}</strong></>}
                      </div>
                    )}
                  </div>

                  {/* Consignee / loader */}
                  <div style={{ flex:1, minWidth:0 }}>
                    {l.consigneeName
                      ? <div style={{ fontWeight:600, fontSize:13, color:"var(--text-primary)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          👤 {l.consigneeName}
                        </div>
                      : <div style={{ color:"var(--text-muted)", fontSize:12, fontStyle:"italic" }}>No consignee</div>}
                    {l.loaderEmail
                      ? <div style={{ fontSize:11, color:"var(--text-secondary)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          ✉ {l.loaderEmail}
                        </div>
                      : null}
                    {!l.loaderEmail && l.notes
                      ? <div style={{ fontSize:11, color:"var(--text-muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          {l.notes}
                        </div>
                      : null}
                  </div>
                </div>

                <div style={{ minWidth:150, fontSize:12 }}>
                  <div style={{ color:"var(--text-primary)" }}>{l.vessel || "—"}</div>
                  <div style={{ color:"var(--text-secondary)", fontSize:11 }}>
                    {[l.pol, l.pod].filter(Boolean).join(" → ") || "—"}
                  </div>
                </div>

                <div style={{ textAlign:"center", minWidth:44 }}>
                  <div style={{ fontSize:20, fontWeight:700, color:"#a78bfa" }}>{orders.length}</div>
                  <div style={{ fontSize:9, color:"var(--text-secondary)" }}>UNIT{orders.length!==1?"S":""}</div>
                </div>

                <div style={{ fontSize:11, color:"var(--text-muted)", minWidth:110, textAlign:"center" }}>
                  {l.emailSentAt
                    ? <><span style={{ color:"#34d399" }}>✉️ Sent</span><br/>{new Date(l.emailSentAt).toLocaleDateString()}</>
                    : <span style={{ color:"#fbbf24" }}>Not sent</span>}
                </div>

                <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                  <button onClick={()=>openEdit(l)}
                    style={{ padding:"6px 12px", fontSize:12, fontWeight:600, borderRadius:8,
                      background:"rgba(37,99,235,0.15)", border:"1px solid rgba(37,99,235,0.4)",
                      color:"#60a5fa", cursor:"pointer", whiteSpace:"nowrap" }}>
                    ✏️ Edit
                  </button>
                  <button onClick={async()=>{
                      setBillingLoad(l); setBillingRows([]); setSendResults(null); setBillingLoading(true);
                      try {
                        const r = await fetch(`${API}/api/container-loads/${l._id}/billing-summary`);
                        const d = await r.json();
                        setBillingRows(d.rows || []);
                      } catch(e) { flash("❌ "+e.message); setBillingLoad(null); }
                      setBillingLoading(false);
                    }}
                    style={{ padding:"6px 12px", fontSize:12, fontWeight:600, borderRadius:8,
                      background:"rgba(124,58,237,0.15)", border:"1px solid rgba(124,58,237,0.4)",
                      color:"#a78bfa", cursor:"pointer", whiteSpace:"nowrap" }}>
                    💰 Billing
                  </button>
                  <button onClick={()=>openEmailFromLoad(l)}
                    style={{ padding:"6px 12px", fontSize:12, fontWeight:600, borderRadius:8,
                      background:"rgba(5,150,105,0.15)", border:"1px solid rgba(5,150,105,0.4)",
                      color:"#34d399", cursor:"pointer", whiteSpace:"nowrap" }}>
                    ✉️ Email
                  </button>
                  <button onClick={()=>deleteLoad(l)}
                    style={{ padding:"6px 10px", fontSize:12, borderRadius:8,
                      background:"rgba(220,38,38,0.12)", border:"1px solid rgba(220,38,38,0.3)",
                      color:"#f87171", cursor:"pointer" }}>
                    🗑
                  </button>
                </div>
              </div>

              {/* Collapsed: VIN chips */}
              {!open && (
                <div style={{ padding:"8px 20px 12px", display:"flex", gap:6, flexWrap:"wrap" }}>
                  {orders.map(o=>(
                    <span key={o._id} onClick={()=>navigate(`/orders/${o._id}`)}
                      style={{ fontSize:11, padding:"3px 10px", borderRadius:20, cursor:"pointer",
                        background:"var(--bg-elevated)", border:"1px solid var(--border)",
                        color:"var(--text-secondary)", fontFamily:"monospace" }}>
                      {o.vin ? o.vin.slice(-6) : o.refNumber}
                    </span>
                  ))}
                </div>
              )}

              {/* Expanded: order rows */}
              {open && (
                <div>
                  {orders.map((o,idx) => {
                    const osc = orderSC(o.status);
                    return (
                      <div key={o._id} onClick={()=>navigate(`/orders/${o._id}`)}
                        style={{ display:"grid", gridTemplateColumns:"1fr 2fr 1.5fr 1.2fr 1fr",
                          gap:16, padding:"12px 20px", cursor:"pointer", alignItems:"center",
                          background:idx%2===0?"var(--bg-elevated)":"transparent",
                          borderBottom:idx<orders.length-1?"1px solid var(--border)":"none" }}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(99,102,241,0.06)"}
                        onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?"var(--bg-elevated)":"transparent"}>
                        <div>
                          <div style={{ fontWeight:600, fontSize:13 }}>{o.refNumber}</div>
                          <div style={{ fontSize:11, color:"var(--text-secondary)" }}>{o.customerName}</div>
                        </div>
                        <div>
                          <div style={{ fontSize:13 }}>{o.year} {o.make} {o.model}</div>
                          <div style={{ fontSize:11, color:"var(--text-secondary)", fontFamily:"monospace" }}>{o.vin||"—"}</div>
                        </div>
                        <div style={{ fontSize:12, color:"var(--text-secondary)" }}>
                          {o.consigneeName && <div>{o.consigneeName}</div>}
                          {o.pod && <div>→ {o.pod}</div>}
                        </div>
                        <div style={{ fontSize:11, color:"var(--text-secondary)" }}>
                          <div>{o.condition||"—"}</div>
                          <div>{o.titleStatus||"—"}</div>
                        </div>
                        <div>
                          <span style={{ fontSize:11, fontWeight:600, padding:"3px 10px", borderRadius:20,
                            background:osc.bg, border:`1px solid ${osc.border}`, color:osc.text }}>
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

      {/* ══════════════════════════════════════════
          NEW LOAD MODAL
      ══════════════════════════════════════════ */}
      {showNew && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:1000,
          display:"flex", alignItems:"flex-start", justifyContent:"center", padding:20, overflowY:"auto" }}>
          <div style={{ background:"var(--bg-panel)", borderRadius:16, padding:28, width:"100%",
            maxWidth:860, margin:"20px auto", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>

            <h3 style={{ margin:"0 0 4px", fontSize:17 }}>📦 New Container Load</h3>
            <p style={{ fontSize:12, color:"var(--text-muted)", margin:"0 0 16px" }}>
              After creating, you'll review the email before it's sent.
            </p>

            {/* Load info */}
            <div style={sec("#60a5fa")}>Load Details</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:4 }}>
              <F label="LOAD NAME / REFERENCE" value={form.name} onChange={setF("name")} placeholder="LOAD-JUN29" />
              <F label="VESSEL (optional)" value={form.vessel} onChange={setF("vessel")} />
              <F label="PORT OF LOADING" value={form.pol} onChange={setF("pol")} placeholder="NJ" />
              <F label="PORT OF DISCHARGE" value={form.pod} onChange={setF("pod")} placeholder="Tema, Lagos…" />
              <F label="LOADER EMAIL (for email preview)" value={form.loaderEmail} onChange={setF("loaderEmail")} type="email" placeholder="info@e-zcargo.com" full />
              <div style={{ gridColumn:"1/-1" }}>
                <label style={lbl}>NOTES (optional)</label>
                <textarea value={form.notes||""} onChange={e=>setF("notes")(e.target.value)} rows={2}
                  style={{ ...inp, resize:"vertical" }} />
              </div>
            </div>

            {/* Consignee + Notify */}
            <ConsigneeSection vals={form} set={setF} />

            {/* Order picker */}
            <div style={sec("#fbbf24")}>
              Select Orders to Include
              {picked.length > 0 && <span style={{ marginLeft:10, color:"#a78bfa" }}>({picked.length} selected)</span>}
            </div>
            <input placeholder="Search by ref #, VIN, customer, make…"
              value={orderSearch} onChange={e=>setOrderSearch(e.target.value)}
              style={{ ...inp, marginBottom:8 }} />
            <div style={{ maxHeight:260, overflowY:"auto", border:"1px solid var(--border)", borderRadius:8, marginBottom:20 }}>
              {filteredAvail.length === 0 && (
                <div style={{ padding:16, color:"var(--text-muted)", fontSize:13, textAlign:"center" }}>
                  No eligible container orders — Canceled orders and orders with booking numbers are excluded.
                </div>
              )}
              {filteredAvail.map((o,idx) => {
                const sel = picked.includes(o._id);
                return (
                  <div key={o._id} onClick={()=>togglePick(o._id)}
                    style={{ display:"grid", gridTemplateColumns:"32px 1fr 2fr 1.2fr 1fr",
                      gap:12, padding:"10px 14px", cursor:"pointer", alignItems:"center",
                      background:sel?"rgba(124,58,237,0.12)":idx%2===0?"var(--bg-elevated)":"transparent",
                      borderBottom:"1px solid var(--border)" }}>
                    <div style={{ width:18, height:18, borderRadius:4,
                      border:`2px solid ${sel?"#a78bfa":"var(--border)"}`,
                      background:sel?"#7c3aed":"transparent",
                      display:"flex", alignItems:"center", justifyContent:"center" }}>
                      {sel && <span style={{ color:"#fff", fontSize:11, fontWeight:700 }}>✓</span>}
                    </div>
                    <div>
                      <div style={{ fontWeight:600, fontSize:12 }}>{o.refNumber}</div>
                      <div style={{ fontSize:11, color:"var(--text-secondary)" }}>{o.customerName}</div>
                    </div>
                    <div>
                      <div style={{ fontSize:12 }}>{o.year} {o.make} {o.model}</div>
                      <div style={{ fontSize:11, color:"var(--text-secondary)", fontFamily:"monospace" }}>{o.vin||"—"}</div>
                    </div>
                    <div style={{ fontSize:11, color:"var(--text-secondary)" }}>{o.consigneeName||"—"}</div>
                    <div style={{ fontSize:11, color:"var(--text-secondary)" }}>→ {o.pod||"—"}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={()=>setShowNew(false)}
                style={{ padding:"8px 20px", background:"none", border:"1px solid var(--border)",
                  borderRadius:8, color:"var(--text-secondary)", cursor:"pointer" }}>
                Cancel
              </button>
              <button onClick={createLoad} disabled={creating||!picked.length}
                style={{ padding:"8px 24px",
                  background:picked.length?"linear-gradient(135deg,#7c3aed,#5b21b6)":"var(--bg-elevated)",
                  color:picked.length?"#fff":"var(--text-muted)",
                  border:"none", borderRadius:8, fontWeight:600,
                  cursor:picked.length?"pointer":"not-allowed" }}>
                {creating ? "Creating…" : `Create Load (${picked.length} unit${picked.length!==1?"s":""})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          EMAIL PREVIEW MODAL
      ══════════════════════════════════════════ */}
      {emailModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1100,
          display:"flex", alignItems:"flex-start", justifyContent:"center", padding:20, overflowY:"auto" }}>
          <div style={{ background:"var(--bg-panel)", borderRadius:16, padding:28, width:"100%",
            maxWidth:680, margin:"20px auto", boxShadow:"0 20px 60px rgba(0,0,0,0.6)" }}>

            <h3 style={{ margin:"0 0 4px", fontSize:17 }}>✉️ Review Email Before Sending</h3>
            <p style={{ fontSize:12, color:"var(--text-muted)", margin:"0 0 20px" }}>
              Edit any field below, then click Send.
            </p>

            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  <label style={lbl}>TO</label>
                  <input value={emailModal.to} onChange={e=>setEmailModal(m=>({...m,to:e.target.value}))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>CC</label>
                  <input value={emailModal.cc} onChange={e=>setEmailModal(m=>({...m,cc:e.target.value}))} style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>SUBJECT</label>
                <input value={emailModal.subject} onChange={e=>setEmailModal(m=>({...m,subject:e.target.value}))} style={inp} />
              </div>
              <div>
                <label style={lbl}>BODY</label>
                <textarea value={emailModal.body}
                  onChange={e=>setEmailModal(m=>({...m,body:e.target.value}))}
                  rows={18}
                  style={{ ...inp, resize:"vertical", fontFamily:"monospace", fontSize:12, lineHeight:1.6 }} />
              </div>
            </div>

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:20 }}>
              <button onClick={()=>setEmailModal(null)}
                style={{ padding:"8px 20px", background:"none", border:"1px solid var(--border)",
                  borderRadius:8, color:"var(--text-secondary)", cursor:"pointer" }}>
                Skip — Don't Send
              </button>
              <button onClick={sendEmail} disabled={sendingEmail}
                style={{ padding:"8px 28px", background:"linear-gradient(135deg,#059669,#047857)",
                  color:"#fff", border:"none", borderRadius:8, fontWeight:600, cursor:"pointer" }}>
                {sendingEmail ? "Sending…" : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          EDIT LOAD MODAL (tabbed)
      ══════════════════════════════════════════ */}
      {editLoad && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:1000,
          display:"flex", alignItems:"flex-start", justifyContent:"center", padding:20, overflowY:"auto" }}>
          <div style={{ background:"var(--bg-panel)", borderRadius:16, padding:0, width:"100%",
            maxWidth:760, margin:"20px auto", boxShadow:"0 20px 60px rgba(0,0,0,0.5)", overflow:"hidden" }}>

            {/* Header */}
            <div style={{ padding:"20px 24px 0", borderBottom:"1px solid var(--border)" }}>
              <h3 style={{ margin:"0 0 14px", fontSize:17 }}>✏️ Edit Load — {editLoad.name}</h3>
              <div style={{ display:"flex", gap:0 }}>
                {TABS.map(t=>(
                  <button key={t.id} onClick={()=>setEditTab(t.id)}
                    style={{ padding:"8px 16px", fontSize:12, fontWeight:600, border:"none", cursor:"pointer",
                      background: editTab===t.id ? "var(--bg-panel)" : "transparent",
                      color: editTab===t.id ? "var(--text-primary)" : "var(--text-muted)",
                      borderBottom: editTab===t.id ? "2px solid #7c3aed" : "2px solid transparent",
                      marginBottom:-1 }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div style={{ padding:"20px 24px" }}>

              {/* ─ Details tab ─ */}
              {editTab === "details" && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <F label="BOOKING NUMBER" value={editForm.bookingNumber} onChange={setEF("bookingNumber")} placeholder="From loader" full />
                  <F label="CONTAINER NUMBER" value={editForm.containerNumber} onChange={setEF("containerNumber")} placeholder="XXXX0000000" />
                  <F label="SEAL NUMBER" value={editForm.sealNumber} onChange={setEF("sealNumber")} />
                  <F label="SAIL CUTOFF DATE" value={editForm.sailCutoff} onChange={setEF("sailCutoff")} type="date" />
                  <F label="ARRIVAL DATE" value={editForm.arrivalDate} onChange={setEF("arrivalDate")} type="date" />
                  <div style={{ gridColumn:"1/-1" }}>
                    <label style={lbl}>STATUS</label>
                    <select value={editForm.status} onChange={e=>setEF("status")(e.target.value)} style={inp}>
                      {["Pending","Booked","Loaded","Sailed","Arrived"].map(s=><option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <F label="VESSEL" value={editForm.vessel} onChange={setEF("vessel")} />
                  <F label="PORT OF LOADING" value={editForm.pol} onChange={setEF("pol")} />
                  <F label="PORT OF DISCHARGE" value={editForm.pod} onChange={setEF("pod")} full />
                  <F label="LOADER EMAIL" value={editForm.loaderEmail} onChange={setEF("loaderEmail")} type="email" full />
                  <div style={{ gridColumn:"1/-1" }}>
                    <label style={lbl}>NOTES</label>
                    <textarea value={editForm.notes||""} onChange={e=>setEF("notes")(e.target.value)} rows={3}
                      style={{ ...inp, resize:"vertical" }} />
                  </div>
                  <div style={{ gridColumn:"1/-1", fontSize:12, color:"var(--text-muted)", padding:"8px 12px",
                    background:"rgba(96,165,250,0.08)", borderRadius:8, border:"1px solid rgba(96,165,250,0.2)" }}>
                    💡 Saving a booking number will automatically update all {(editLoad.orderIds||[]).length} linked orders.
                  </div>
                </div>
              )}

              {/* ─ Consignee tab ─ */}
              {editTab === "consignee" && (
                <ConsigneeSection vals={editForm} set={setEF} />
              )}

              {/* ─ Orders tab ─ */}
              {editTab === "orders" && (
                <div>
                  <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:0 }}>
                    Click an order to open its full detail page.
                  </p>
                  {(editLoad.orderIds||[]).length === 0 && (
                    <div style={{ textAlign:"center", padding:40, color:"var(--text-muted)" }}>No orders in this load</div>
                  )}
                  {(editLoad.orderIds||[]).map((o,idx)=>{
                    const osc = orderSC(o.status);
                    return (
                      <div key={o._id}
                        style={{ display:"grid", gridTemplateColumns:"auto 1fr 2fr 1.2fr 1fr 1fr",
                          gap:14, padding:"12px 4px", alignItems:"center",
                          borderBottom: idx < (editLoad.orderIds||[]).length-1 ? "1px solid var(--border)" : "none" }}>
                        <span style={{ fontSize:13, color:"var(--text-muted)", fontWeight:600, minWidth:20 }}>{idx+1}.</span>
                        <div>
                          <div style={{ fontWeight:700, fontSize:13 }}>{o.refNumber}</div>
                          <div style={{ fontSize:11, color:"var(--text-secondary)" }}>{o.customerName}</div>
                        </div>
                        <div>
                          <div style={{ fontSize:13 }}>{o.year} {o.make} {o.model}</div>
                          <div style={{ fontSize:11, color:"var(--text-secondary)", fontFamily:"monospace" }}>{o.vin||"—"}</div>
                        </div>
                        <div style={{ fontSize:11, color:"var(--text-secondary)" }}>
                          <div>{o.consigneeName||"—"}</div>
                          <div>→ {o.pod||"—"}</div>
                        </div>
                        <div style={{ fontSize:11, color:"var(--text-secondary)" }}>
                          <div>{o.condition||"—"}</div>
                          <div>{o.titleStatus||"—"}</div>
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                          <span style={{ fontSize:11, fontWeight:600, padding:"3px 8px", borderRadius:20,
                            background:osc.bg, border:`1px solid ${osc.border}`, color:osc.text }}>
                            {o.status}
                          </span>
                          <button onClick={()=>navigate(`/orders/${o._id}`)}
                            style={{ fontSize:11, padding:"3px 10px", borderRadius:6,
                              background:"rgba(99,102,241,0.12)", border:"1px solid rgba(99,102,241,0.3)",
                              color:"#818cf8", cursor:"pointer" }}>
                            Open →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* ─ Docs tab ─ */}
              {editTab === "docs" && (
                <div>
                  {/* Parsed BL results banner */}
                  {parsedBL && (
                    <div style={{ background:"rgba(124,58,237,0.12)", border:"1px solid rgba(124,58,237,0.35)",
                      borderRadius:10, padding:16, marginBottom:16 }}>
                      <div style={{ fontWeight:700, fontSize:13, color:"#a78bfa", marginBottom:10 }}>📋 Parsed from document — edit if needed, then Apply</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px 16px", fontSize:12 }}>
                        {[
                          ["bookingNumber",   "Booking #"],
                          ["containerNumber", "Container #"],
                          ["sealNumber",      "Seal #"],
                          ["vessel",          "Vessel"],
                          ["pol",             "POL"],
                          ["pod",             "POD"],
                          ["aesItn",          "AES ITN"],
                        ].map(([field, label]) => (
                          <div key={field} style={{ display:"flex", flexDirection:"column", gap:2 }}>
                            <span style={{ color:"var(--text-muted)", fontSize:11 }}>{label}</span>
                            <input
                              value={parsedBL[field] || ""}
                              onChange={e => setParsedBL(prev => ({ ...prev, [field]: e.target.value }))}
                              style={{ padding:"4px 8px", border:"1px solid rgba(124,58,237,0.4)",
                                borderRadius:5, background:"rgba(124,58,237,0.08)", color:"var(--text-primary)",
                                fontSize:12, outline:"none", width:"100%", boxSizing:"border-box" }}
                            />
                          </div>
                        ))}
                        {parsedBL.vins?.length > 0 && (
                          <div style={{ gridColumn:"1/-1" }}>
                            <span style={{ color:"var(--text-muted)" }}>VINs: </span>
                            <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-primary)" }}>
                              {parsedBL.vins.join(" · ")}
                            </span>
                          </div>
                        )}
                      </div>
                      {parsedBL._rawLines && (
                        <details style={{ marginTop:8, fontSize:10, color:"var(--text-muted)" }}>
                          <summary style={{ cursor:"pointer" }}>🔍 Raw extracted lines (debug)</summary>
                          <pre style={{ whiteSpace:"pre-wrap", maxHeight:200, overflowY:"auto", background:"rgba(0,0,0,0.2)", padding:8, borderRadius:4, marginTop:4 }}>
                            {parsedBL._rawLines.join("\n")}
                          </pre>
                        </details>
                      )}
                      <div style={{ display:"flex", gap:8, marginTop:12 }}>
                        <button onClick={applyParsedBL}
                          style={{ padding:"7px 20px", background:"#7c3aed", color:"#fff",
                            border:"none", borderRadius:7, fontWeight:600, cursor:"pointer", fontSize:13 }}>
                          ✅ Apply to Load
                        </button>
                        <button onClick={() => setParsedBL(null)}
                          style={{ padding:"7px 14px", background:"none", border:"1px solid var(--border)",
                            borderRadius:7, color:"var(--text-secondary)", cursor:"pointer", fontSize:13 }}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Drag & drop upload zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={async e => {
                      e.preventDefault(); setDragOver(false);
                      const file = e.dataTransfer.files[0];
                      if (!file) return;
                      await uploadDocFile(file);
                    }}
                    style={{ border:`2px dashed ${dragOver ? "#7c3aed" : "var(--border)"}`,
                      borderRadius:10, padding:"28px 20px", textAlign:"center", marginBottom:16,
                      background: dragOver ? "rgba(124,58,237,0.08)" : "var(--bg-base)",
                      transition:"all 0.15s", cursor:"pointer" }}
                    onClick={() => document.getElementById("cl-doc-upload").click()}>
                    <input id="cl-doc-upload" type="file" style={{ display:"none" }}
                      onChange={async e => {
                        const file = e.target.files[0];
                        if (!file) return;
                        e.target.value = "";
                        await uploadDocFile(file);
                      }} />
                    {uploadingDoc
                      ? <div style={{ color:"var(--text-muted)", fontSize:13 }}>⏳ Uploading…</div>
                      : <>
                          <div style={{ fontSize:28, marginBottom:6 }}>📎</div>
                          <div style={{ fontSize:13, color:"var(--text-muted)" }}>Drag & drop or click to upload</div>
                          <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:4 }}>BL · Draft · Invoice · Any document</div>
                        </>
                    }
                  </div>

                  {/* Labeled upload zones */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(130px, 1fr))", gap:8, marginBottom:16 }}>
                    {[
                      { label:"Draft BL",            icon:"📝" },
                      { label:"Stamped BL",          icon:"📌" },
                      { label:"Booking Confirmation",icon:"📋" },
                      { label:"Invoice",             icon:"🧾" },
                      { label:"Other",               icon:"📎" },
                    ].map(({ label, icon }) => (
                      <label key={label} style={{ display:"flex", flexDirection:"column", alignItems:"center",
                        gap:4, padding:"10px 8px", borderRadius:8, border:"2px dashed var(--border)",
                        cursor:"pointer", fontSize:11, color:"var(--text-muted)", textAlign:"center",
                        background:"var(--bg-panel)", transition:"border-color .15s" }}
                        onMouseEnter={e=>e.currentTarget.style.borderColor="#60a5fa"}
                        onMouseLeave={e=>e.currentTarget.style.borderColor=""}>
                        <span style={{ fontSize:20 }}>{icon}</span>
                        {label}
                        <input type="file" hidden onChange={e => {
                          Array.from(e.target.files).forEach(f => uploadDocFile(f, label));
                          e.target.value = "";
                        }} />
                      </label>
                    ))}
                  </div>

                  {/* File list */}
                  {loadFiles.length === 0 && !uploadingDoc && (
                    <div style={{ textAlign:"center", padding:24, color:"var(--text-muted)", fontSize:13 }}>
                      No documents uploaded yet
                    </div>
                  )}
                  {loadFiles.map((f, idx) => {
                    const isDraftBL = /^draft/i.test(f.label || "");
                    return (
                    <div key={f.id || idx} style={{ display:"flex", alignItems:"center", gap:8,
                      padding:"10px 12px", borderRadius:8, border:"1px solid var(--border)",
                      marginBottom:8, background:"var(--bg-base)" }}>
                      <span style={{ fontSize:20 }}>
                        {/pdf/i.test(f.mimeType) ? "📄" : /image/i.test(f.mimeType) ? "🖼" : "📎"}
                      </span>
                      <div style={{ flex:1, minWidth:0 }}>
                        {renamingFile?.id === f.id ? (
                          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                            <input
                              autoFocus
                              value={renamingFile.name}
                              onChange={e => setRenamingFile(r => ({ ...r, name: e.target.value }))}
                              onKeyDown={async e => {
                                if (e.key === "Enter") {
                                  await fetch(`${API}/api/container-loads/${editLoad._id}/files/${f.id}/rename`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ name: renamingFile.name }),
                                  }).catch(() => {});
                                  setLoadFiles(prev => prev.map(x => x.id === f.id ? { ...x, name: renamingFile.name } : x));
                                  setRenamingFile(null);
                                }
                                if (e.key === "Escape") setRenamingFile(null);
                              }}
                              style={{ ...inp, fontSize:12, padding:"4px 8px", flex:1 }}
                            />
                            <button onClick={async () => {
                              await fetch(`${API}/api/container-loads/${editLoad._id}/files/${f.id}/rename`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ name: renamingFile.name }),
                              }).catch(() => {});
                              setLoadFiles(prev => prev.map(x => x.id === f.id ? { ...x, name: renamingFile.name } : x));
                              setRenamingFile(null);
                            }} style={{ padding:"4px 10px", fontSize:11, background:"#2563eb", color:"#fff",
                              border:"none", borderRadius:6, cursor:"pointer" }}>Save</button>
                            <button onClick={() => setRenamingFile(null)}
                              style={{ padding:"4px 8px", fontSize:11, background:"none",
                                border:"1px solid var(--border)", borderRadius:6, color:"var(--text-muted)", cursor:"pointer" }}>✕</button>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontSize:13, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {f.name}
                            </div>
                            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2 }}>
                              {/* Label badge + dropdown */}
                              <select
                                value={f.label || "Document"}
                                onChange={async e => {
                                  const newLabel = e.target.value;
                                  await fetch(`${API}/api/container-loads/${editLoad._id}/files/${f.id}/label`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ label: newLabel }),
                                  }).catch(() => {});
                                  setLoadFiles(prev => prev.map(x => x.id === f.id ? { ...x, label: newLabel } : x));
                                }}
                                style={{ fontSize:10, padding:"2px 4px", borderRadius:4, border:"1px solid var(--border)",
                                  background:"var(--bg-panel)", color:"var(--text-secondary)", cursor:"pointer" }}>
                                {["Draft BL","Stamped BL","Booking Confirmation","Invoice","Other","Document"]
                                  .map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                              <span style={{ fontSize:10, color:"var(--text-muted)" }}>
                                {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ""}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                      {/* Email Draft BL */}
                      {isDraftBL && (
                        <button
                          onClick={() => openDraftBlEmail(editLoad)}
                          title="Email Draft BL to customer"
                          style={{ padding:"5px 10px", fontSize:11, background:"rgba(52,211,153,0.12)",
                            border:"1px solid rgba(52,211,153,0.3)", borderRadius:6,
                            color:"#34d399", cursor:"pointer", whiteSpace:"nowrap" }}>
                          📧 Email
                        </button>
                      )}
                      {/* Parse */}
                      <button
                        onClick={async () => {
                          setUploadingDoc(true);
                          try {
                            const proxyUrl = `${API}/api/drive-proxy/${f.id}`;
                            const blob = await fetch(proxyUrl).then(r => r.blob());
                            const file = new File([blob], f.name, { type: f.mimeType });
                            await parseBLFile(file);
                          } catch (e) {
                            flash("❌ Could not parse: " + e.message);
                          } finally {
                            setUploadingDoc(false);
                          }
                        }}
                        title="Parse for BL info"
                        style={{ padding:"5px 10px", fontSize:11, background:"rgba(124,58,237,0.12)",
                          border:"1px solid rgba(124,58,237,0.3)", borderRadius:6,
                          color:"#a78bfa", cursor:"pointer", whiteSpace:"nowrap" }}>
                        🔍 Parse
                      </button>
                      {/* Open */}
                      <a href={f.webViewLink} target="_blank" rel="noreferrer"
                        style={{ padding:"5px 10px", fontSize:11, background:"var(--bg-panel)",
                          border:"1px solid var(--border)", borderRadius:6,
                          color:"var(--text-secondary)", cursor:"pointer", textDecoration:"none", whiteSpace:"nowrap" }}>
                        ↗ Open
                      </a>
                      {/* Rename */}
                      <button
                        onClick={() => setRenamingFile({ id: f.id, name: f.name })}
                        title="Rename file"
                        style={{ padding:"5px 10px", fontSize:11, background:"rgba(251,191,36,0.12)",
                          border:"1px solid rgba(251,191,36,0.3)", borderRadius:6,
                          color:"#fbbf24", cursor:"pointer", whiteSpace:"nowrap" }}>
                        ✏️ Edit
                      </button>
                      {/* Delete */}
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete "${f.name}"?`)) return;
                          try {
                            const r = await fetch(`${API}/api/container-loads/${editLoad._id}/files/${f.id}`, { method: "DELETE" });
                            const d = await r.json();
                            if (!r.ok) throw new Error(d.error);
                            setEditLoad(d);
                            setLoadFiles(prev => prev.filter(x => x.id !== f.id));
                            flash("🗑 File removed");
                          } catch (e) { flash("❌ " + e.message); }
                        }}
                        title="Delete file"
                        style={{ padding:"5px 10px", fontSize:11, background:"rgba(248,113,113,0.12)",
                          border:"1px solid rgba(248,113,113,0.3)", borderRadius:6,
                          color:"#f87171", cursor:"pointer", whiteSpace:"nowrap" }}>
                        🗑 Delete
                      </button>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            {editTab !== "orders" && editTab !== "docs" && (
              <div style={{ display:"flex", gap:10, justifyContent:"flex-end",
                padding:"14px 24px", borderTop:"1px solid var(--border)" }}>
                <button onClick={()=>setEditLoad(null)}
                  style={{ padding:"8px 20px", background:"none", border:"1px solid var(--border)",
                    borderRadius:8, color:"var(--text-secondary)", cursor:"pointer" }}>
                  Cancel
                </button>
                <button onClick={saveEdit} disabled={savingEdit}
                  style={{ padding:"8px 28px", background:"#2563eb", color:"#fff",
                    border:"none", borderRadius:8, fontWeight:600, cursor:"pointer" }}>
                  {savingEdit ? "Saving…" : "Save Changes"}
                </button>
              </div>
            )}
            {(editTab === "orders" || editTab === "docs") && (
              <div style={{ display:"flex", justifyContent:"flex-end",
                padding:"14px 24px", borderTop:"1px solid var(--border)" }}>
                <button onClick={()=>setEditLoad(null)}
                  style={{ padding:"8px 20px", background:"none", border:"1px solid var(--border)",
                    borderRadius:8, color:"var(--text-secondary)", cursor:"pointer" }}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Billing Summary Modal ─────────────────────────────────────────── */}
      {billingLoad && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:1000,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"var(--bg-card)", borderRadius:14, width:"100%", maxWidth:920,
            maxHeight:"90vh", display:"flex", flexDirection:"column", border:"1px solid var(--border)" }}>

            <div style={{ padding:"18px 24px", borderBottom:"1px solid var(--border)",
              display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <h3 style={{ margin:0, fontSize:16 }}>💰 Billing — {billingLoad.name}</h3>
                <div style={{ fontSize:12, color:"var(--text-muted)", marginTop:2 }}>
                  {billingLoad.vessel}{billingLoad.pol ? ` · ${billingLoad.pol} → ${billingLoad.pod}` : ""}
                </div>
              </div>
              <button onClick={()=>{ setBillingLoad(null); setSendResults(null); }}
                style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"var(--text-muted)" }}>✕</button>
            </div>

            <div style={{ overflowY:"auto", flex:1, padding:"16px 24px" }}>
              {billingLoading ? (
                <div style={{ textAlign:"center", padding:40, color:"var(--text-muted)" }}>Loading…</div>
              ) : sendResults ? (
                <div>
                  <div style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>Send Results:</div>
                  {sendResults.map((r,i) => (
                    <div key={i} style={{ padding:"8px 12px", borderRadius:8, marginBottom:6,
                      background: r.sent ? "rgba(52,211,153,0.1)" : "rgba(251,191,36,0.1)",
                      border:`1px solid ${r.sent ? "rgba(52,211,153,0.3)" : "rgba(251,191,36,0.3)"}`, fontSize:13 }}>
                      {r.sent ? "✅" : "⚠️"} Invoice {r.invoiceNumber}
                      {r.sent && <span style={{ color:"var(--text-muted)" }}> → {r.to}</span>}
                      {r.skipped && <span style={{ color:"#fbbf24" }}> — Skipped: {r.reason}</span>}
                      {r.error && <span style={{ color:"#f87171" }}> — Error: {r.error}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                    <thead>
                      <tr style={{ borderBottom:"2px solid var(--border)", color:"var(--text-muted)", fontSize:11, textAlign:"left" }}>
                        <th style={{ padding:"6px 8px" }}>Order</th>
                        <th style={{ padding:"6px 8px" }}>Vehicle</th>
                        <th style={{ padding:"6px 8px" }}>Customer</th>
                        <th style={{ padding:"6px 8px", textAlign:"right" }}>Expenses</th>
                        <th style={{ padding:"6px 8px", textAlign:"right" }}>Invoice</th>
                        <th style={{ padding:"6px 8px", textAlign:"right" }}>Profit</th>
                        <th style={{ padding:"6px 8px", textAlign:"center" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billingRows.map(row => (
                        <tr key={row.refNumber} style={{ borderBottom:"1px solid var(--border)" }}>
                          <td style={{ padding:"10px 8px", fontWeight:600 }}>
                            <a href={`/orders/${row.orderId}`} target="_blank" rel="noreferrer"
                              style={{ color:"#60a5fa", textDecoration:"none" }}>#{row.refNumber}</a>
                          </td>
                          <td style={{ padding:"10px 8px" }}>
                            <div>{row.vehicle}</div>
                            <div style={{ fontSize:11, color:"var(--text-muted)" }}>{row.vin}</div>
                          </td>
                          <td style={{ padding:"10px 8px", maxWidth:160 }}>
                            <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{row.customerName}</div>
                            <div style={{ fontSize:11, color:"var(--text-muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                              {row.customerEmail || <span style={{color:"#f87171"}}>No email</span>}
                            </div>
                          </td>
                          <td style={{ padding:"10px 8px", textAlign:"right" }}>
                            <div style={{ fontWeight:600, color:"#f87171" }}>${row.totalExpenses.toFixed(2)}</div>
                            {row.expenses.map((e,i) => (
                              <div key={i} style={{ fontSize:10, color:"var(--text-muted)" }}>{e.vendor}: ${e.amount.toFixed(2)}</div>
                            ))}
                          </td>
                          <td style={{ padding:"10px 8px", textAlign:"right", fontWeight:600, color:"#34d399" }}>
                            {row.invoice ? `$${row.invoiceTotal.toFixed(2)}` : <span style={{ color:"var(--text-muted)" }}>No invoice</span>}
                          </td>
                          <td style={{ padding:"10px 8px", textAlign:"right", fontWeight:700,
                            color: row.profit > 0 ? "#34d399" : row.profit < 0 ? "#f87171" : "var(--text-muted)" }}>
                            {row.invoice ? `$${row.profit.toFixed(2)}` : "—"}
                          </td>
                          <td style={{ padding:"10px 8px", textAlign:"center" }}>
                            {row.invoice ? (
                              <span style={{ padding:"3px 8px", borderRadius:6, fontSize:11, fontWeight:600,
                                background: row.invoice.status==="paid" ? "rgba(52,211,153,0.15)" : row.invoice.status==="sent" ? "rgba(96,165,250,0.15)" : "rgba(251,191,36,0.15)",
                                color: row.invoice.status==="paid" ? "#34d399" : row.invoice.status==="sent" ? "#60a5fa" : "#fbbf24" }}>
                                {row.invoice.status.toUpperCase()}
                              </span>
                            ) : <span style={{ color:"var(--text-muted)", fontSize:11 }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {billingRows.length > 0 && (
                      <tfoot>
                        <tr style={{ borderTop:"2px solid var(--border)", fontWeight:700 }}>
                          <td colSpan={3} style={{ padding:"10px 8px", color:"var(--text-muted)", fontSize:12 }}>TOTALS</td>
                          <td style={{ padding:"10px 8px", textAlign:"right", color:"#f87171" }}>
                            ${billingRows.reduce((s,r)=>s+r.totalExpenses,0).toFixed(2)}
                          </td>
                          <td style={{ padding:"10px 8px", textAlign:"right", color:"#34d399" }}>
                            ${billingRows.reduce((s,r)=>s+r.invoiceTotal,0).toFixed(2)}
                          </td>
                          <td style={{ padding:"10px 8px", textAlign:"right",
                            color: billingRows.reduce((s,r)=>s+r.profit,0)>=0 ? "#34d399" : "#f87171" }}>
                            ${billingRows.reduce((s,r)=>s+r.profit,0).toFixed(2)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>

            {/* Email preview panel */}
            {sendPreview && !sendResults && (
              <div style={{ padding:"16px 24px", borderTop:"2px solid var(--border)", background:"rgba(124,58,237,0.06)" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#a78bfa", marginBottom:10, textTransform:"uppercase", letterSpacing:"0.05em" }}>
                  📧 Preview — confirm before sending
                </div>
                <div style={{ display:"grid", gap:8 }}>
                  <div>
                    <label style={lbl}>TO</label>
                    <input value={sendPreview.to} onChange={e=>setSendPreview(p=>({...p,to:e.target.value}))} style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>SUBJECT</label>
                    <input value={sendPreview.subject} onChange={e=>setSendPreview(p=>({...p,subject:e.target.value}))} style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>BODY</label>
                    <textarea value={sendPreview.body} onChange={e=>setSendPreview(p=>({...p,body:e.target.value}))}
                      rows={6} style={{...inp, resize:"vertical", fontFamily:"inherit"}} />
                  </div>
                  <div style={{ fontSize:11, color:"var(--text-muted)" }}>
                    {billingRows.filter(r=>r.invoice&&r.invoice.status!=="paid").length} invoice PDF(s) will be attached
                  </div>
                </div>
              </div>
            )}

            {!sendResults && !billingLoading && (
              <div style={{ padding:"14px 24px", borderTop:"1px solid var(--border)",
                display:"flex", gap:10, justifyContent:"flex-end" }}>
                <button onClick={()=>{ setBillingLoad(null); setSendPreview(null); setSendResults(null); }}
                  style={{ padding:"8px 20px", background:"none", border:"1px solid var(--border)",
                    borderRadius:8, color:"var(--text-secondary)", cursor:"pointer" }}>Close</button>
                {!sendPreview ? (
                  <button disabled={billingRows.every(r=>!r.invoice||r.invoice.status==="paid")}
                    onClick={()=>{
                      const to = billingRows.find(r=>r.customerEmail)?.customerEmail || "";
                      const vessel = billingLoad.vessel || "";
                      const booking = billingLoad.bookingNumber || "";
                      const shippingLine = vessel.split(" ")[0] || "";
                      const subject = `Invoices — Load ${billingLoad.name}${booking ? " / Booking "+booking : ""}${vessel ? " / "+vessel : ""}`;
                      const names = billingRows.filter(r=>r.invoice&&r.invoice.status!=="paid").map(r=>`  • ${r.vehicle}${r.vin ? ` | VIN: ${r.vin}` : ""} (Ref #${r.refNumber}) — $${r.invoiceTotal.toFixed(2)}`).join("\n");
                      const body = `Dear Customer,\n\nPlease find your invoices attached for the following vehicles:\n\n${names}\n\nVessel: ${vessel}\nBooking #: ${booking}\n\nThank you,\nEli Levy\nDor Ldor Global\n9172003998\nDorLdorGlobal@gmail.com`;
                      setSendPreview({ to, subject, body });
                    }}
                    style={{ padding:"8px 20px", background:"rgba(124,58,237,0.85)", border:"none",
                      borderRadius:8, color:"#fff", fontWeight:600, cursor:"pointer" }}>
                    📧 Send All Invoices
                  </button>
                ) : (
                  <button disabled={sendingAll || !sendPreview.to}
                    onClick={async()=>{
                      setSendingAll(true);
                      try {
                        const r = await fetch(`${API}/api/container-loads/${billingLoad._id}/send-all-invoices`, {
                          method:"POST", headers:{"Content-Type":"application/json"},
                          body: JSON.stringify({ to: sendPreview.to, subject: sendPreview.subject, body: sendPreview.body }),
                        });
                        const d = await r.json();
                        if (!r.ok) throw new Error(d.error);
                        setSendResults([{ sent: true, to: sendPreview.to, count: d.sent, attachments: d.attachments }]);
                        setSendPreview(null);
                      } catch(e) { flash("❌ "+e.message); }
                      setSendingAll(false);
                    }}
                    style={{ padding:"8px 20px", background:"rgba(52,211,153,0.85)", border:"none",
                      borderRadius:8, color:"#fff", fontWeight:600, cursor:"pointer", opacity:sendingAll?0.6:1 }}>
                    {sendingAll ? "Sending…" : "✅ Confirm & Send"}
                  </button>
                )}
              </div>
            )}
            {sendResults && (
              <div style={{ padding:"14px 24px", borderTop:"1px solid var(--border)" }}>
                {sendResults.map((r,i) => (
                  <div key={i} style={{ fontSize:13, color:"#34d399", marginBottom:4 }}>
                    ✅ {r.count} invoice(s) sent to {r.to}
                    {r.attachments && <div style={{ fontSize:11, color:"var(--text-muted)" }}>{r.attachments.join(", ")}</div>}
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"flex-end", marginTop:10 }}>
                  <button onClick={()=>{ setBillingLoad(null); setSendResults(null); setSendPreview(null); }}
                    style={{ padding:"8px 20px", background:"rgba(52,211,153,0.15)", border:"1px solid rgba(52,211,153,0.3)",
                      borderRadius:8, color:"#34d399", fontWeight:600, cursor:"pointer" }}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Draft BL Email Modal ──────────────────────────────────────────── */}
      {draftBlEmail && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:1200,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"var(--bg-panel)", borderRadius:14, width:"100%", maxWidth:560,
            border:"1px solid var(--border)", boxShadow:"0 25px 60px rgba(0,0,0,0.5)" }}>
            <div style={{ padding:"18px 24px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontWeight:700, fontSize:15 }}>📧 Email Draft BL</div>
              <button onClick={() => setDraftBlEmail(null)}
                style={{ background:"none", border:"none", color:"var(--text-muted)", fontSize:18, cursor:"pointer" }}>✕</button>
            </div>
            <div style={{ padding:"20px 24px", display:"grid", gap:12 }}>
              <div>
                <label style={lbl}>TO</label>
                <input value={draftBlEmail.to} onChange={e => setDraftBlEmail(p=>({...p,to:e.target.value}))} style={inp} />
              </div>
              <div>
                <label style={lbl}>SUBJECT</label>
                <input value={draftBlEmail.subject} onChange={e => setDraftBlEmail(p=>({...p,subject:e.target.value}))} style={inp} />
              </div>
              <div>
                <label style={lbl}>BODY</label>
                <textarea value={draftBlEmail.body} onChange={e => setDraftBlEmail(p=>({...p,body:e.target.value}))}
                  rows={10} style={{...inp, resize:"vertical", fontFamily:"inherit", fontSize:12}} />
              </div>
              <div style={{ fontSize:11, color:"var(--text-muted)" }}>
                The Draft BL PDF will be attached automatically.
              </div>
            </div>
            <div style={{ padding:"14px 24px", borderTop:"1px solid var(--border)", display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => setDraftBlEmail(null)}
                style={{ padding:"8px 20px", background:"none", border:"1px solid var(--border)",
                  borderRadius:8, color:"var(--text-secondary)", cursor:"pointer" }}>Cancel</button>
              <button disabled={sendingDraftBl || !draftBlEmail.to} onClick={async () => {
                setSendingDraftBl(true);
                try {
                  const r = await fetch(`${API}/api/container-loads/${draftBlEmail.loadId}/email-draft-bl`, {
                    method:"POST", headers:{"Content-Type":"application/json"},
                    body: JSON.stringify({ to: draftBlEmail.to, subject: draftBlEmail.subject, body: draftBlEmail.body }),
                  });
                  const d = await r.json();
                  if (!r.ok) throw new Error(d.error);
                  setDraftBlEmail(null);
                  flash("✅ Draft BL sent to " + draftBlEmail.to);
                } catch(e) { flash("❌ " + e.message); }
                setSendingDraftBl(false);
              }} style={{ padding:"8px 20px", background:"rgba(52,211,153,0.85)", border:"none",
                borderRadius:8, color:"#fff", fontWeight:600, cursor:"pointer", opacity: sendingDraftBl ? 0.6 : 1 }}>
                {sendingDraftBl ? "Sending…" : "✉️ Send Draft BL"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
