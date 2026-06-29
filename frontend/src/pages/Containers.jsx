import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const LOAD_STATUS_COLORS = {
  "Pending": { bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.35)",  text: "#fbbf24" },
  "Booked":  { bg: "rgba(37,99,235,0.12)",   border: "rgba(37,99,235,0.35)",   text: "#60a5fa" },
  "Loaded":  { bg: "rgba(124,58,237,0.12)",  border: "rgba(124,58,237,0.35)",  text: "#a78bfa" },
  "Sailed":  { bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.35)",  text: "#34d399" },
  "Arrived": { bg: "rgba(74,222,128,0.12)",  border: "rgba(74,222,128,0.35)",  text: "#4ade80" },
};
const ORDER_STATUS_COLORS = {
  "New Order":       { bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.35)",  text: "#60a5fa" },
  "Waiting to Sail": { bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.35)",  text: "#fbbf24" },
  "Sailed":          { bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.35)",  text: "#34d399" },
  "Arrived":         { bg: "rgba(74,222,128,0.12)",  border: "rgba(74,222,128,0.35)",  text: "#4ade80" },
  "Completed":       { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.35)", text: "#94a3b8" },
};
function loadSC(s) { return LOAD_STATUS_COLORS[s] || LOAD_STATUS_COLORS["Pending"]; }
function orderSC(s) { return ORDER_STATUS_COLORS[s] || { bg:"rgba(99,102,241,0.1)", border:"rgba(99,102,241,0.3)", text:"#818cf8" }; }

const inp = { padding:"8px 12px", borderRadius:8, border:"1px solid var(--border)",
  background:"var(--bg-input)", color:"var(--text-primary)", fontSize:13, width:"100%", boxSizing:"border-box" };
const lbl = { fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4, fontWeight:600, letterSpacing:"0.04em" };
const sec = { fontSize:12, fontWeight:700, color:"#a78bfa", margin:"20px 0 10px", textTransform:"uppercase", letterSpacing:"0.06em" };

function Field({ label, value, onChange, placeholder, type="text" }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder||""} style={inp} />
    </div>
  );
}

const BLANK_FORM = {
  name:"", vessel:"", pol:"NJ", pod:"", loaderEmail:"", notes:"",
  consigneeName:"", consigneeAddress:"", consigneePhone:"", consigneeEmail:"", consigneeTin:"",
  notifyName:"", notifyAddress:"", notifyPhone:"", notifyEmail:"", notifyTin:"",
};

export default function Containers() {
  const navigate = useNavigate();
  const [loads,     setLoads]     = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [search,    setSearch]    = useState("");
  const [expanded,  setExpanded]  = useState({});
  const [msg,       setMsg]       = useState("");

  // New load modal
  const [showNew,     setShowNew]     = useState(false);
  const [form,        setForm]        = useState(BLANK_FORM);
  const [orderSearch, setOrderSearch] = useState("");
  const [picked,      setPicked]      = useState([]);
  const [creating,    setCreating]    = useState(false);

  // Edit modal
  const [editModal,   setEditModal]   = useState(null);
  const [editForm,    setEditForm]    = useState({});
  const [savingEdit,  setSavingEdit]  = useState(false);

  const loadData = () => {
    fetch(`${API}/api/container-loads`).then(r=>r.json()).then(setLoads).catch(()=>{});
    fetch(`${API}/api/orders`).then(r=>r.json())
      .then(d => setAllOrders((Array.isArray(d)?d:[]).filter(o=>o.requestType==="Container")))
      .catch(()=>{});
  };
  useEffect(loadData, []);

  const flash = (m) => { setMsg(m); setTimeout(()=>setMsg(""),4000); };
  const setF   = (k) => (v) => setForm(f => ({ ...f, [k]: v }));
  const setEF  = (k) => (v) => setEditForm(f => ({ ...f, [k]: v }));

  const loadedOrderIds = new Set(loads.flatMap(l=>(l.orderIds||[]).map(o=>o._id||o)));
  const availableOrders = allOrders.filter(o => !loadedOrderIds.has(o._id));
  const filteredAvailable = availableOrders.filter(o => {
    const s = orderSearch.toLowerCase();
    return !s || `${o.refNumber} ${o.vin} ${o.customerName} ${o.make} ${o.model}`.toLowerCase().includes(s);
  });

  const togglePick = (id) => {
    setPicked(p => {
      const next = p.includes(id) ? p.filter(x=>x!==id) : [...p, id];
      // Auto-fill consignee from first picked order
      if (!p.includes(id) && p.length === 0) {
        const o = availableOrders.find(x => x._id === id);
        if (o) {
          const addr = [o.consigneeAddress, o.consigneeCity, o.consigneeCountry].filter(Boolean).join(", ");
          setForm(f => ({
            ...f,
            consigneeName:    f.consigneeName    || o.consigneeName    || "",
            consigneeAddress: f.consigneeAddress || addr || "",
            pod:              f.pod              || o.pod               || "",
            vessel:           f.vessel           || o.vessel            || "",
          }));
        }
      }
      return next;
    });
  };

  const openNew = () => {
    const d = new Date();
    const name = `LOAD-${d.toLocaleString("en-US",{month:"short"}).toUpperCase()}${d.getDate()}`;
    setForm({ ...BLANK_FORM, name });
    setPicked([]); setOrderSearch(""); setShowNew(true);
  };

  const createLoad = async () => {
    if (!picked.length) return alert("Select at least one order");
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/container-loads`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ ...form, orderIds: picked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||"Failed");
      flash(form.loaderEmail
        ? `✅ Load created & email sent to ${form.loaderEmail}`
        : "✅ Load created");
      setShowNew(false);
      loadData();
    } catch(e) { flash("❌ "+e.message); }
    setCreating(false);
  };

  const openEdit = (l) => {
    setEditModal(l);
    setEditForm({
      bookingNumber:   l.bookingNumber   || "",
      containerNumber: l.containerNumber || "",
      sealNumber:      l.sealNumber      || "",
      status:          l.status          || "Pending",
      vessel:          l.vessel          || "",
      pol:             l.pol             || "",
      pod:             l.pod             || "",
      loaderEmail:     l.loaderEmail     || "",
      consigneeName:   l.consigneeName   || "",
      consigneeAddress:l.consigneeAddress|| "",
      consigneePhone:  l.consigneePhone  || "",
      consigneeEmail:  l.consigneeEmail  || "",
      consigneeTin:    l.consigneeTin    || "",
      notifyName:      l.notifyName      || "",
      notifyAddress:   l.notifyAddress   || "",
      notifyPhone:     l.notifyPhone     || "",
      notifyEmail:     l.notifyEmail     || "",
      notifyTin:       l.notifyTin       || "",
    });
  };

  const saveEdit = async () => {
    setSavingEdit(true);
    try {
      const res = await fetch(`${API}/api/container-loads/${editModal._id}`, {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(editForm),
      });
      if (!res.ok) { const d=await res.json(); throw new Error(d.error||"Failed"); }
      flash("✅ Load updated");
      setEditModal(null);
      loadData();
    } catch(e) { flash("❌ "+e.message); }
    setSavingEdit(false);
  };

  const deleteLoad = async (l) => {
    if (!window.confirm(`Delete load "${l.name}"?`)) return;
    await fetch(`${API}/api/container-loads/${l._id}`, { method:"DELETE" });
    loadData();
  };

  const resendEmail = async (l) => {
    try {
      const res = await fetch(`${API}/api/container-loads/${l._id}/resend-email`, {
        method:"POST", headers:{"Content-Type":"application/json"}, body:"{}",
      });
      if (!res.ok) { const d=await res.json(); throw new Error(d.error||"Failed"); }
      flash("✅ Email resent to info@e-zcargo.com");
      loadData();
    } catch(e) { flash("❌ "+e.message); }
  };

  const filtered = loads.filter(l => {
    const s = search.toLowerCase();
    if (!s) return true;
    return `${l.name} ${l.bookingNumber} ${l.vessel} ${l.containerNumber}`
      .toLowerCase().includes(s)
      || (l.orderIds||[]).some(o =>
          `${o.vin||""} ${o.customerName||""} ${o.refNumber||""}`.toLowerCase().includes(s));
  });

  // ── Shared consignee/notify form sections ────────────────────────────────
  const ConsigneeFields = ({ vals, set }) => (
    <>
      <div style={sec}>Consignee Info</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <div style={{ gridColumn:"1/-1" }}>
          <Field label="CONSIGNEE NAME" value={vals.consigneeName} onChange={set("consigneeName")} />
        </div>
        <div style={{ gridColumn:"1/-1" }}>
          <Field label="ADDRESS" value={vals.consigneeAddress} onChange={set("consigneeAddress")} placeholder="Street, City, Country" />
        </div>
        <Field label="PHONE" value={vals.consigneePhone} onChange={set("consigneePhone")} placeholder="+1 000 000 0000" />
        <Field label="EMAIL" value={vals.consigneeEmail} onChange={set("consigneeEmail")} type="email" />
        <div style={{ gridColumn:"1/-1" }}>
          <Field label="TIN #" value={vals.consigneeTin} onChange={set("consigneeTin")} />
        </div>
      </div>
      <div style={sec}>Notify Party Info</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <div style={{ gridColumn:"1/-1" }}>
          <Field label="NOTIFY PARTY NAME" value={vals.notifyName} onChange={set("notifyName")} />
        </div>
        <div style={{ gridColumn:"1/-1" }}>
          <Field label="ADDRESS" value={vals.notifyAddress} onChange={set("notifyAddress")} placeholder="Street, City, Country" />
        </div>
        <Field label="PHONE" value={vals.notifyPhone} onChange={set("notifyPhone")} placeholder="+1 000 000 0000" />
        <Field label="EMAIL" value={vals.notifyEmail} onChange={set("notifyEmail")} type="email" />
        <div style={{ gridColumn:"1/-1" }}>
          <Field label="TIN #" value={vals.notifyTin} onChange={set("notifyTin")} />
        </div>
      </div>
    </>
  );

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

      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign:"center", padding:"60px 0", color:"var(--text-muted)" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📦</div>
            <p style={{ fontSize:15 }}>No container loads yet.</p>
            <p style={{ fontSize:13 }}>Click "+ New Container Load" to group orders and send a loader email.</p>
          </div>
        )}

        {filtered.map(l => {
          const sc   = loadSC(l.status);
          const open = !!expanded[l._id];
          const orders = l.orderIds || [];

          return (
            <div key={l._id} style={{ background:"var(--bg-panel)", border:"1px solid var(--border)",
              borderRadius:12, overflow:"hidden" }}>

              <div style={{ display:"flex", alignItems:"center", gap:16, padding:"14px 20px",
                borderBottom: open ? "1px solid var(--border)" : "none" }}>

                <div onClick={()=>setExpanded(p=>({...p,[l._id]:!p[l._id]}))}
                  style={{ cursor:"pointer", color:"var(--text-secondary)", fontSize:16, minWidth:18 }}>
                  {open ? "▲" : "▼"}
                </div>

                <div style={{ minWidth:140 }}>
                  <div style={{ fontWeight:700, fontSize:15, color:"var(--text-primary)" }}>{l.name}</div>
                  <span style={{ fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:20,
                    background:sc.bg, border:`1px solid ${sc.border}`, color:sc.text }}>
                    {l.status}
                  </span>
                </div>

                <div style={{ flex:1 }}>
                  {l.bookingNumber
                    ? <div style={{ fontWeight:600, color:"#60a5fa", fontSize:14 }}>📋 {l.bookingNumber}</div>
                    : <div style={{ color:"var(--text-muted)", fontSize:13, fontStyle:"italic" }}>No booking # yet</div>}
                  {l.containerNumber && (
                    <div style={{ fontSize:12, color:"var(--text-secondary)" }}>
                      Container: <strong>{l.containerNumber}</strong>
                      {l.sealNumber && <> · Seal: <strong>{l.sealNumber}</strong></>}
                    </div>
                  )}
                </div>

                <div style={{ minWidth:160 }}>
                  <div style={{ fontSize:13, color:"var(--text-primary)" }}>{l.vessel || "—"}</div>
                  <div style={{ fontSize:11, color:"var(--text-secondary)" }}>
                    {[l.pol, l.pod].filter(Boolean).join(" → ") || "—"}
                  </div>
                </div>

                <div style={{ textAlign:"center", minWidth:50 }}>
                  <div style={{ fontSize:22, fontWeight:700, color:"#a78bfa" }}>{orders.length}</div>
                  <div style={{ fontSize:10, color:"var(--text-secondary)" }}>UNIT{orders.length!==1?"S":""}</div>
                </div>

                <div style={{ fontSize:11, color:"var(--text-muted)", minWidth:120 }}>
                  {l.emailSentAt
                    ? <><span style={{ color:"#34d399" }}>✉️ Sent</span><br/>{new Date(l.emailSentAt).toLocaleDateString()}</>
                    : <span style={{ color:"var(--warning)" }}>No email sent</span>}
                </div>

                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={()=>openEdit(l)}
                    style={{ padding:"6px 12px", fontSize:12, fontWeight:600, borderRadius:8,
                      background:"rgba(37,99,235,0.15)", border:"1px solid rgba(37,99,235,0.4)",
                      color:"#60a5fa", cursor:"pointer" }}>
                    ✏️ Edit
                  </button>
                  <button onClick={()=>resendEmail(l)}
                    style={{ padding:"6px 12px", fontSize:12, fontWeight:600, borderRadius:8,
                      background:"rgba(5,150,105,0.15)", border:"1px solid rgba(5,150,105,0.4)",
                      color:"#34d399", cursor:"pointer" }}>
                    ✉️ Resend
                  </button>
                  <button onClick={()=>deleteLoad(l)}
                    style={{ padding:"6px 10px", fontSize:12, borderRadius:8,
                      background:"rgba(220,38,38,0.12)", border:"1px solid rgba(220,38,38,0.3)",
                      color:"#f87171", cursor:"pointer" }}>
                    🗑
                  </button>
                </div>
              </div>

              {!open && (
                <div style={{ padding:"8px 20px 12px", display:"flex", gap:6, flexWrap:"wrap" }}>
                  {orders.map(o=>(
                    <span key={o._id}
                      onClick={()=>navigate(`/orders/${o._id}`)}
                      style={{ fontSize:11, padding:"3px 10px", borderRadius:20, cursor:"pointer",
                        background:"var(--bg-elevated)", border:"1px solid var(--border)",
                        color:"var(--text-secondary)", fontFamily:"monospace" }}>
                      {o.vin ? o.vin.slice(-6) : o.refNumber}
                    </span>
                  ))}
                </div>
              )}

              {open && (
                <div>
                  {orders.map((o, idx) => {
                    const osc = orderSC(o.status);
                    return (
                      <div key={o._id} onClick={()=>navigate(`/orders/${o._id}`)}
                        style={{ display:"grid", gridTemplateColumns:"1fr 2fr 1.5fr 1.2fr 1fr",
                          gap:16, padding:"12px 20px", cursor:"pointer", alignItems:"center",
                          background: idx%2===0 ? "var(--bg-elevated)" : "transparent",
                          borderBottom: idx<orders.length-1 ? "1px solid var(--border)" : "none" }}
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

      {/* ── New Load Modal ── */}
      {showNew && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:1000,
          display:"flex", alignItems:"flex-start", justifyContent:"center", padding:20, overflowY:"auto" }}>
          <div style={{ background:"var(--bg-panel)", borderRadius:16, padding:28, width:"100%",
            maxWidth:860, margin:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>

            <h3 style={{ margin:"0 0 20px", color:"var(--text-primary)", fontSize:17 }}>📦 New Container Load</h3>

            {/* Load Info */}
            <div style={sec}>Load Details</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:4 }}>
              <Field label="LOAD NAME / REFERENCE" value={form.name} onChange={setF("name")} placeholder="e.g. LOAD-JUN29" />
              <Field label="VESSEL (optional)" value={form.vessel} onChange={setF("vessel")} placeholder="Vessel name" />
              <Field label="PORT OF LOADING" value={form.pol} onChange={setF("pol")} placeholder="NJ" />
              <Field label="PORT OF DISCHARGE" value={form.pod} onChange={setF("pod")} placeholder="e.g. Tema" />
              <div style={{ gridColumn:"1/-1" }}>
                <Field label="LOADER EMAIL (auto-sends on create)" value={form.loaderEmail} onChange={setF("loaderEmail")} type="email" placeholder="info@e-zcargo.com" />
                <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:4 }}>
                  Email goes to info@e-zcargo.com · CC: shipping@e-zcargo.com
                </div>
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={lbl}>NOTES (optional)</label>
                <textarea value={form.notes} onChange={e=>setF("notes")(e.target.value)} rows={2}
                  style={{ ...inp, resize:"vertical" }} placeholder="Any special instructions…" />
              </div>
            </div>

            {/* Consignee + Notify */}
            <ConsigneeFields vals={form} set={setF} />

            {/* Order picker */}
            <div style={sec}>Select Orders to Include</div>
            {picked.length > 0 && (
              <div style={{ fontSize:12, color:"#a78bfa", fontWeight:700, marginBottom:6 }}>
                {picked.length} order{picked.length!==1?"s":""} selected
              </div>
            )}
            <input placeholder="Search orders by ref, VIN, customer, make…"
              value={orderSearch} onChange={e=>setOrderSearch(e.target.value)}
              style={{ ...inp, marginBottom:8 }} />
            <div style={{ maxHeight:260, overflowY:"auto", border:"1px solid var(--border)", borderRadius:8, marginBottom:20 }}>
              {filteredAvailable.length === 0 && (
                <div style={{ padding:16, color:"var(--text-muted)", fontSize:13, textAlign:"center" }}>
                  No container orders available
                </div>
              )}
              {filteredAvailable.map((o, idx) => {
                const sel = picked.includes(o._id);
                return (
                  <div key={o._id} onClick={()=>togglePick(o._id)}
                    style={{ display:"grid", gridTemplateColumns:"32px 1fr 2fr 1.2fr 1fr",
                      gap:12, padding:"10px 14px", cursor:"pointer", alignItems:"center",
                      background: sel ? "rgba(124,58,237,0.12)" : idx%2===0 ? "var(--bg-elevated)" : "transparent",
                      borderBottom:"1px solid var(--border)" }}>
                    <div style={{ width:18, height:18, borderRadius:4, border:`2px solid ${sel?"#a78bfa":"var(--border)"}`,
                      background: sel ? "#7c3aed" : "transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>
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
                    <div style={{ fontSize:11, color:"var(--text-secondary)" }}>{o.consigneeName || "—"}</div>
                    <div style={{ fontSize:11, color:"var(--text-secondary)" }}>→ {o.pod || "—"}</div>
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
                  background: picked.length ? "linear-gradient(135deg,#7c3aed,#5b21b6)" : "var(--bg-elevated)",
                  color: picked.length ? "#fff" : "var(--text-muted)",
                  border:"none", borderRadius:8, fontWeight:600, cursor: picked.length?"pointer":"not-allowed" }}>
                {creating ? "Creating…" : form.loaderEmail
                  ? `Create & Send Email (${picked.length} units)`
                  : `Create Load (${picked.length} units)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:1000,
          display:"flex", alignItems:"flex-start", justifyContent:"center", padding:20, overflowY:"auto" }}>
          <div style={{ background:"var(--bg-panel)", borderRadius:16, padding:28, width:"100%",
            maxWidth:620, margin:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>

            <h3 style={{ margin:"0 0 4px", color:"var(--text-primary)", fontSize:17 }}>
              ✏️ Edit Load — {editModal.name}
            </h3>
            <p style={{ fontSize:12, color:"var(--text-muted)", margin:"0 0 16px" }}>
              Saving a booking number will update all {(editModal.orderIds||[]).length} linked orders.
            </p>

            <div style={sec}>Booking & Status</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div style={{ gridColumn:"1/-1" }}>
                <Field label="BOOKING NUMBER" value={editForm.bookingNumber} onChange={setEF("bookingNumber")} placeholder="From loader" />
              </div>
              <Field label="CONTAINER NUMBER" value={editForm.containerNumber} onChange={setEF("containerNumber")} placeholder="XXXX0000000" />
              <Field label="SEAL NUMBER" value={editForm.sealNumber} onChange={setEF("sealNumber")} />
              <div style={{ gridColumn:"1/-1" }}>
                <label style={lbl}>STATUS</label>
                <select value={editForm.status} onChange={e=>setEF("status")(e.target.value)} style={inp}>
                  {["Pending","Booked","Loaded","Sailed","Arrived"].map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div style={sec}>Load Details</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Field label="VESSEL" value={editForm.vessel} onChange={setEF("vessel")} />
              <Field label="PORT OF LOADING" value={editForm.pol} onChange={setEF("pol")} />
              <div style={{ gridColumn:"1/-1" }}>
                <Field label="PORT OF DISCHARGE" value={editForm.pod} onChange={setEF("pod")} />
              </div>
            </div>

            <ConsigneeFields vals={editForm} set={setEF} />

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:24 }}>
              <button onClick={()=>setEditModal(null)}
                style={{ padding:"8px 20px", background:"none", border:"1px solid var(--border)",
                  borderRadius:8, color:"var(--text-secondary)", cursor:"pointer" }}>
                Cancel
              </button>
              <button onClick={saveEdit} disabled={savingEdit}
                style={{ padding:"8px 24px", background:"#2563eb", color:"#fff",
                  border:"none", borderRadius:8, fontWeight:600, cursor:"pointer" }}>
                {savingEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
