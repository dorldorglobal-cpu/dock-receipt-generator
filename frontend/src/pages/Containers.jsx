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
  background:"var(--bg-input)", color:"var(--text-primary)", fontSize:13, width:"100%" };

export default function Containers() {
  const navigate = useNavigate();
  const [loads,    setLoads]    = useState([]);
  const [allOrders,setAllOrders]= useState([]);
  const [search,   setSearch]   = useState("");
  const [expanded, setExpanded] = useState({});
  const [msg,      setMsg]      = useState("");

  // New load modal
  const [showNew,     setShowNew]     = useState(false);
  const [newName,     setNewName]     = useState("");
  const [newVessel,   setNewVessel]   = useState("");
  const [newPol,      setNewPol]      = useState("");
  const [newPod,      setNewPod]      = useState("");
  const [newEmail,    setNewEmail]    = useState("");
  const [newNotes,    setNewNotes]    = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [picked,      setPicked]      = useState([]); // selected order _ids
  const [creating,    setCreating]    = useState(false);

  // Edit booking# modal
  const [bookingModal, setBookingModal] = useState(null); // load object
  const [bookingInput, setBookingInput] = useState("");
  const [containerInput,setContainerInput]=useState("");
  const [sealInput,    setSealInput]   = useState("");
  const [statusInput,  setStatusInput] = useState("");
  const [savingBooking,setSavingBooking]= useState(false);

  const load = () => {
    fetch(`${API}/api/container-loads`).then(r=>r.json()).then(setLoads).catch(()=>{});
    fetch(`${API}/api/orders`).then(r=>r.json())
      .then(d => setAllOrders((Array.isArray(d)?d:[]).filter(o=>o.requestType==="Container")))
      .catch(()=>{});
  };
  useEffect(load, []);

  const flash = (m) => { setMsg(m); setTimeout(()=>setMsg(""),4000); };

  // Orders not yet in any load (for picker)
  const loadedOrderIds = new Set(loads.flatMap(l=>(l.orderIds||[]).map(o=>o._id||o)));
  const availableOrders = allOrders.filter(o => !loadedOrderIds.has(o._id));
  const filteredAvailable = availableOrders.filter(o => {
    const s = orderSearch.toLowerCase();
    return !s || `${o.refNumber} ${o.vin} ${o.customerName} ${o.make} ${o.model}`.toLowerCase().includes(s);
  });

  const togglePick = (id) => setPicked(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]);

  const openNew = () => {
    const d = new Date();
    setNewName(`LOAD-${d.toLocaleString("en-US",{month:"short"}).toUpperCase()}${d.getDate()}`);
    setNewVessel(""); setNewPol(""); setNewPod(""); setNewEmail(""); setNewNotes("");
    setPicked([]); setOrderSearch(""); setShowNew(true);
  };

  const createLoad = async () => {
    if (!picked.length) return alert("Select at least one order");
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/container-loads`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ name:newName, orderIds:picked, vessel:newVessel,
          pol:newPol, pod:newPod, loaderEmail:newEmail, notes:newNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||"Failed");
      flash(newEmail ? `✅ Load created & email sent to ${newEmail}` : "✅ Load created");
      setShowNew(false);
      load();
    } catch(e) { flash("❌ "+e.message); }
    setCreating(false);
  };

  const saveBooking = async () => {
    setSavingBooking(true);
    try {
      const res = await fetch(`${API}/api/container-loads/${bookingModal._id}`, {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ bookingNumber:bookingInput, containerNumber:containerInput,
          sealNumber:sealInput, status:statusInput }),
      });
      if (!res.ok) { const d=await res.json(); throw new Error(d.error||"Failed"); }
      flash("✅ Booking info saved");
      setBookingModal(null);
      load();
    } catch(e) { flash("❌ "+e.message); }
    setSavingBooking(false);
  };

  const deleteLoad = async (l) => {
    if (!window.confirm(`Delete load "${l.name}"?`)) return;
    await fetch(`${API}/api/container-loads/${l._id}`, { method:"DELETE" });
    load();
  };

  const resendEmail = async (l) => {
    const email = prompt("Resend to:", l.loaderEmail||"");
    if (!email) return;
    try {
      const res = await fetch(`${API}/api/container-loads/${l._id}/resend-email`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ loaderEmail:email }),
      });
      if (!res.ok) { const d=await res.json(); throw new Error(d.error||"Failed"); }
      flash("✅ Email resent");
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

      {/* Search */}
      <div style={{ marginBottom:18, display:"flex", alignItems:"center", gap:12 }}>
        <input placeholder="Search load name, booking #, VIN, customer…"
          value={search} onChange={e=>setSearch(e.target.value)}
          style={{ ...inp, maxWidth:420 }} />
        <span style={{ fontSize:13, color:"var(--text-secondary)" }}>
          {filtered.length} load{filtered.length!==1?"s":""}
        </span>
      </div>

      {/* Load cards */}
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

              {/* Header */}
              <div style={{ display:"flex", alignItems:"center", gap:16, padding:"14px 20px",
                borderBottom: open ? "1px solid var(--border)" : "none" }}>

                {/* Expand toggle */}
                <div onClick={()=>setExpanded(p=>({...p,[l._id]:!p[l._id]}))}
                  style={{ cursor:"pointer", color:"var(--text-secondary)", fontSize:16, minWidth:18 }}>
                  {open ? "▲" : "▼"}
                </div>

                {/* Name + status */}
                <div style={{ minWidth:140 }}>
                  <div style={{ fontWeight:700, fontSize:15, color:"var(--text-primary)" }}>{l.name}</div>
                  <span style={{ fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:20,
                    background:sc.bg, border:`1px solid ${sc.border}`, color:sc.text }}>
                    {l.status}
                  </span>
                </div>

                {/* Booking # */}
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

                {/* Vessel + route */}
                <div style={{ minWidth:160 }}>
                  <div style={{ fontSize:13, color:"var(--text-primary)" }}>{l.vessel || "—"}</div>
                  <div style={{ fontSize:11, color:"var(--text-secondary)" }}>
                    {[l.pol, l.pod].filter(Boolean).join(" → ") || "—"}
                  </div>
                </div>

                {/* Unit count */}
                <div style={{ textAlign:"center", minWidth:50 }}>
                  <div style={{ fontSize:22, fontWeight:700, color:"#a78bfa" }}>{orders.length}</div>
                  <div style={{ fontSize:10, color:"var(--text-secondary)" }}>UNIT{orders.length!==1?"S":""}</div>
                </div>

                {/* Email sent */}
                <div style={{ fontSize:11, color:"var(--text-muted)", minWidth:100 }}>
                  {l.emailSentAt
                    ? <>✉️ Sent<br/>{new Date(l.emailSentAt).toLocaleDateString()}</>
                    : <span style={{ color:"var(--warning)" }}>No email sent</span>}
                </div>

                {/* Actions */}
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={()=>{ setBookingModal(l); setBookingInput(l.bookingNumber||"");
                    setContainerInput(l.containerNumber||""); setSealInput(l.sealNumber||"");
                    setStatusInput(l.status||"Pending"); }}
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

              {/* VIN chips (collapsed) */}
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

              {/* Expanded order rows */}
              {open && (
                <div>
                  {orders.map((o, idx) => {
                    const osc = orderSC(o.status);
                    return (
                      <div key={o._id} onClick={()=>navigate(`/orders/${o._id}`)}
                        style={{ display:"grid", gridTemplateColumns:"1fr 2fr 1.5fr 1.2fr 1fr",
                          gap:16, padding:"12px 20px", cursor:"pointer", alignItems:"center",
                          background: idx%2===0 ? "var(--bg-elevated)" : "transparent",
                          borderBottom: idx<orders.length-1 ? "1px solid var(--border)" : "none",
                          transition:"background 0.1s" }}
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
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1000,
          display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"var(--bg-panel)", borderRadius:16, padding:28, width:"100%",
            maxWidth:780, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>

            <h3 style={{ margin:"0 0 20px", color:"var(--text-primary)", fontSize:17 }}>📦 New Container Load</h3>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:16 }}>
              <div>
                <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4 }}>LOAD NAME / REFERENCE</label>
                <input value={newName} onChange={e=>setNewName(e.target.value)} style={inp} placeholder="e.g. LOAD-JUN29" />
              </div>
              <div>
                <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4 }}>VESSEL (optional)</label>
                <input value={newVessel} onChange={e=>setNewVessel(e.target.value)} style={inp} placeholder="Vessel name" />
              </div>
              <div>
                <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4 }}>PORT OF LOADING</label>
                <input value={newPol} onChange={e=>setNewPol(e.target.value)} style={inp} placeholder="e.g. Baltimore" />
              </div>
              <div>
                <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4 }}>PORT OF DISCHARGE</label>
                <input value={newPod} onChange={e=>setNewPod(e.target.value)} style={inp} placeholder="e.g. Lagos" />
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4 }}>LOADER EMAIL (auto-sends on create)</label>
                <input value={newEmail} onChange={e=>setNewEmail(e.target.value)} style={inp} placeholder="loader@company.com" />
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4 }}>NOTES (optional)</label>
                <textarea value={newNotes} onChange={e=>setNewNotes(e.target.value)} rows={2}
                  style={{ ...inp, resize:"vertical" }} placeholder="Any special instructions…" />
              </div>
            </div>

            {/* Order picker */}
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:6 }}>
                SELECT ORDERS TO INCLUDE
                {picked.length > 0 && <span style={{ marginLeft:8, color:"#a78bfa", fontWeight:700 }}>({picked.length} selected)</span>}
              </label>
              <input placeholder="Search orders by ref, VIN, customer, make…"
                value={orderSearch} onChange={e=>setOrderSearch(e.target.value)}
                style={{ ...inp, marginBottom:8 }} />
              <div style={{ maxHeight:260, overflowY:"auto", border:"1px solid var(--border)", borderRadius:8 }}>
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
                        borderBottom:"1px solid var(--border)", transition:"background 0.1s" }}>
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
                      <div style={{ fontSize:11, color:"var(--text-secondary)" }}>
                        {o.consigneeName || "—"}
                      </div>
                      <div style={{ fontSize:11, color:"var(--text-secondary)" }}>
                        → {o.pod || "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={()=>setShowNew(false)}
                style={{ padding:"8px 20px", background:"none", border:"1px solid var(--border)",
                  borderRadius:8, color:"var(--text-secondary)", cursor:"pointer" }}>
                Cancel
              </button>
              <button onClick={createLoad} disabled={creating||!picked.length}
                style={{ padding:"8px 24px", background: picked.length?"#7c3aed":"var(--bg-elevated)",
                  color: picked.length?"#fff":"var(--text-muted)",
                  border:"none", borderRadius:8, fontWeight:600, cursor: picked.length?"pointer":"not-allowed" }}>
                {creating ? "Creating…" : newEmail ? `Create & Send Email (${picked.length} units)` : `Create Load (${picked.length} units)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Booking Modal ── */}
      {bookingModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1000,
          display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"var(--bg-panel)", borderRadius:16, padding:28, width:"100%",
            maxWidth:480, boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>

            <h3 style={{ margin:"0 0 20px", color:"var(--text-primary)", fontSize:17 }}>
              ✏️ Update Load — {bookingModal.name}
            </h3>

            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4 }}>BOOKING NUMBER</label>
                <input value={bookingInput} onChange={e=>setBookingInput(e.target.value)} style={inp}
                  placeholder="Enter booking # from loader" autoFocus />
              </div>
              <div>
                <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4 }}>CONTAINER NUMBER</label>
                <input value={containerInput} onChange={e=>setContainerInput(e.target.value)} style={inp} placeholder="XXXX0000000" />
              </div>
              <div>
                <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4 }}>SEAL NUMBER</label>
                <input value={sealInput} onChange={e=>setSealInput(e.target.value)} style={inp} placeholder="Seal #" />
              </div>
              <div>
                <label style={{ fontSize:11, color:"var(--text-muted)", display:"block", marginBottom:4 }}>STATUS</label>
                <select value={statusInput} onChange={e=>setStatusInput(e.target.value)} style={inp}>
                  {["Pending","Booked","Loaded","Sailed","Arrived"].map(s=>(
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:12 }}>
              Saving a booking number will automatically update all {(bookingModal.orderIds||[]).length} orders in this load.
            </p>

            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:20 }}>
              <button onClick={()=>setBookingModal(null)}
                style={{ padding:"8px 20px", background:"none", border:"1px solid var(--border)",
                  borderRadius:8, color:"var(--text-secondary)", cursor:"pointer" }}>
                Cancel
              </button>
              <button onClick={saveBooking} disabled={savingBooking}
                style={{ padding:"8px 24px", background:"#2563eb", color:"#fff",
                  border:"none", borderRadius:8, fontWeight:600, cursor:"pointer" }}>
                {savingBooking ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
