const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

import { useEffect, useState } from "react";

function fmt(n) {
  const num = Number(n || 0);
  if (!num) return "—";
  return "$" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const POLS = ["JACKSONVILLE","BALTIMORE","DAVISVILLE","PROVIDENCE","FREEPORT","WILMINGTON","BRUNSWICK","NEWARK"];
const PODS = ["LAGOS","TEMA","COTONOU","LOME","DAKAR","DURBAN","ABIDJAN"];
const LINES = ["ACL","SALLAUM","CMA CGM","COSCO","HAPAG LLOYD","MAERSK","MSC","OOCL"];

export default function OceanFreight() {
  const [rows, setRows]       = useState([]);
  const [search, setSearch]   = useState("");
  const [limit, setLimit]     = useState(100);
  const [filterLine, setFilterLine]   = useState("");
  const [filterCat, setFilterCat]     = useState("");
  const [filterType, setFilterType]   = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [populating, setPopulating] = useState(false);

  const blank = { shippingLine:"", category:"1", requestType:"", pol:"", pod:"", portPrice:"", cost:"" };
  const [form, setForm] = useState(blank);

  useEffect(() => { fetchRows(); }, []);

  const fetchRows = async () => {
    const res  = await fetch(`${API}/api/pricing?type=ocean`);
    setRows(await res.json());
  };

  const saveRow = async () => {
    if (!form.pol || !form.pod) { alert("POL and POD are required"); return; }
    await fetch(
      form._id ? `${API}/api/pricing/${form._id}` : `${API}/api/pricing`,
      {
        method: form._id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type:         "ocean",
          shippingLine: form.shippingLine.toUpperCase(),
          category:     form.category || "1",
          requestType:  form.requestType,
          pol:          form.pol.toUpperCase(),
          pod:          form.pod.toUpperCase(),
          portPrice:    Number(form.portPrice || 0),
          cost:         Number(form.cost      || 0),
        }),
      }
    );
    setForm(blank);
    setShowAdd(false);
    fetchRows();
  };

  const populateAllOrders = async () => {
    if (!window.confirm("Populate ocean freight on all orders that are currently $0?")) return;
    setPopulating(true);
    try {
      const res = await fetch(`${API}/api/orders/bulk-populate-ocean`, { method: "POST" });
      const data = await res.json();
      alert(`Done! Updated ${data.updated} order${data.updated !== 1 ? "s" : ""}.`);
    } catch {
      alert("Failed to populate orders.");
    }
    setPopulating(false);
  };

  const deleteRow = async (id) => {
    if (!window.confirm("Delete this rate?")) return;
    await fetch(`${API}/api/pricing/${id}`, { method:"DELETE" });
    fetchRows();
  };

  const filtered = rows.filter((r) => {
    if (filterLine && (r.shippingLine || "") !== filterLine) return false;
    if (filterCat  && (r.category     || "1") !== filterCat)  return false;
    if (filterType && (r.requestType  || "") !== filterType)  return false;
    const text = `${r.shippingLine} ${r.requestType} ${r.pol} ${r.pod} ${r.portPrice} ${r.cost}`.toLowerCase();
    return text.includes(search.toLowerCase());
  });

  const sorted = [...filtered].sort((a, b) => {
    const ca = Number(a.category || 1);
    const cb = Number(b.category || 1);
    return ca - cb;
  });
  const visibleRows = sorted.slice(0, Number(limit));

  const catBadge = (cat) => (
    <span style={{
      padding:"2px 7px", borderRadius:12, fontSize:10, fontWeight:700,
      background: cat==="2" ? "rgba(245,158,11,0.15)" : "rgba(99,102,241,0.15)",
      color:       cat==="2" ? "#fbbf24"               : "#a78bfa",
      border:`1px solid ${cat==="2" ? "rgba(251,191,36,0.3)" : "rgba(167,139,250,0.3)"}`,
    }}>CAT {cat||"1"}</span>
  );

  const typeBadge = (t) => (
    <span style={{
      padding:"2px 8px", borderRadius:12, fontSize:11, fontWeight:600,
      background: t==="CONTAINER" ? "rgba(37,99,235,0.15)" : "rgba(5,150,105,0.15)",
      color:       t==="CONTAINER" ? "#60a5fa"               : "#34d399",
      border:`1px solid ${t==="CONTAINER" ? "rgba(96,165,250,0.3)" : "rgba(52,211,153,0.3)"}`,
    }}>{t||"—"}</span>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Ocean Freight</h1>
          <p>Manage ocean freight rates by route and shipping line.</p>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={populateAllOrders} disabled={populating}
            style={{ padding:"8px 12px", borderRadius:8, border:"1px solid var(--border)",
              background:"var(--bg-panel)", color:"var(--text-muted)", cursor:"pointer", fontSize:12 }}>
            {populating ? "Populating…" : "⚡ Populate All Orders"}
          </button>
          <button onClick={() => { setForm(blank); setShowAdd(true); }}
            style={{ padding:"8px 12px", borderRadius:8, border:"none",
              background:"#2563eb", color:"white", cursor:"pointer", fontSize:12 }}>
            + Add Rate
          </button>
        </div>
      </div>

      <section className="form-section towing-section">
        {/* Toolbar */}
        <div className="towing-toolbar" style={{ flexWrap:"wrap", gap:10 }}>
          <div>
            Show{" "}
            <select value={limit} onChange={e=>setLimit(e.target.value)}>
              {[25,50,100,200,500].map(n=><option key={n}>{n}</option>)}
            </select>{" "}entries
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <select value={filterLine} onChange={e=>setFilterLine(e.target.value)}>
              <option value="">All Lines</option>
              {LINES.map(l=><option key={l}>{l}</option>)}
            </select>
            <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}>
              <option value="">All Categories</option>
              <option value="1">Cat 1</option>
              <option value="2">Cat 2</option>
            </select>
            <select value={filterType} onChange={e=>setFilterType(e.target.value)}>
              <option value="">All Types</option>
              <option>RORO</option>
              <option>CONTAINER</option>
            </select>
            <input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
        </div>

        <table className="orders-table towing-table">
          <thead>
            <tr>
              <th>Line</th>
              <th>Cat</th>
              <th>Type</th>
              <th>POL</th>
              <th>POD</th>
              <th style={{ color:"var(--accent)" }}>Price</th>
              <th style={{ color:"#f87171" }}>Cost</th>
              <th style={{ color:"#34d399" }}>Profit</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const price  = Number(r.portPrice||0);
              const cost   = Number(r.cost||0);
              const profit = price - cost;
              return (
                <tr key={r._id}>
                  <td style={{ fontWeight:600 }}>{r.shippingLine}</td>
                  <td>{catBadge(r.category)}</td>
                  <td>{typeBadge(r.requestType)}</td>
                  <td>{r.pol}</td>
                  <td>{r.pod}</td>
                  <td style={{ fontWeight:600, color:"var(--accent)" }}>{fmt(price)}</td>
                  <td style={{ fontWeight:600, color:"#f87171" }}>{fmt(cost)}</td>
                  <td style={{ fontWeight:700,
                    color: profit>0?"#34d399":profit<0?"#f87171":"var(--text-muted)" }}>
                    {(cost>0||price>0) ? (profit>=0?"+":"")+fmt(profit) : "—"}
                  </td>
                  <td style={{ display:"flex", gap:4 }}>
                    <button onClick={()=>{ setForm({
                      shippingLine: r.shippingLine||"", category: r.category||"1",
                      requestType: r.requestType||"", pol: r.pol||"", pod: r.pod||"",
                      portPrice: r.portPrice||"", cost: r.cost||"", _id: r._id,
                    }); setShowAdd(true); }} style={{ fontSize:10, padding:"3px 6px" }}>Edit</button>
                    <button onClick={()=>deleteRow(r._id)} style={{ fontSize:10, padding:"3px 6px" }}>Delete</button>
                  </td>
                </tr>
              );
            })}
            {visibleRows.length===0 && (
              <tr><td colSpan="9">No ocean freight rates found.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {showAdd && (
        <div className="modal-backdrop" onClick={()=>setShowAdd(false)}>
          <div className="modal-card" onClick={e=>e.stopPropagation()} style={{ width:480 }}>
            <h2 style={{ marginTop:0 }}>{form._id ? "Edit Rate" : "Add Ocean Freight Rate"}</h2>
            <div className="towing-popup-form">

              {/* Row 1: Line + Category */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <label>Shipping Line
                  <select value={form.shippingLine} onChange={e=>{
                    const v=e.target.value;
                    if(v==="__custom__"){
                      const c=prompt("Enter shipping line:"); if(c?.trim()) setForm({...form,shippingLine:c.trim().toUpperCase()});
                    } else setForm({...form,shippingLine:v});
                  }}>
                    <option value="">Select...</option>
                    <optgroup label="RORO"><option>ACL</option><option>SALLAUM</option></optgroup>
                    <optgroup label="Container">
                      <option>CMA CGM</option><option>COSCO</option><option>HAPAG LLOYD</option>
                      <option>MAERSK</option><option>MSC</option><option>OOCL</option>
                    </optgroup>
                    <optgroup label="Other"><option value="__custom__">+ Add New...</option></optgroup>
                  </select>
                </label>
                <label>Category
                  <select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>
                    <option value="1">Category 1</option>
                    <option value="2">Category 2</option>
                  </select>
                </label>
              </div>

              {/* Type */}
              <label>Type
                <select value={form.requestType} onChange={e=>setForm({...form,requestType:e.target.value})}>
                  <option value="">Select type...</option>
                  <option>RORO</option>
                  <option>CONTAINER</option>
                </select>
              </label>

              {/* POL + POD */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <label>Port of Loading (POL)
                  <select value={form.pol} onChange={e=>setForm({...form,pol:e.target.value})}>
                    <option value="">Select POL...</option>
                    {POLS.map(p=><option key={p}>{p}</option>)}
                  </select>
                </label>
                <label>Port of Discharge (POD)
                  <select value={form.pod} onChange={e=>setForm({...form,pod:e.target.value})}>
                    <option value="">Select POD...</option>
                    {PODS.map(p=><option key={p}>{p}</option>)}
                  </select>
                </label>
              </div>

              {/* Price + Cost */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <label>Price <span style={{ fontSize:11, color:"var(--accent)" }}>(charged)</span>
                  <input type="number" value={form.portPrice}
                    onChange={e=>setForm({...form,portPrice:e.target.value})} placeholder="e.g. 1480" style={{ marginTop:6 }}/>
                </label>
                <label>Cost <span style={{ fontSize:11, color:"#f87171" }}>(paid)</span>
                  <input type="number" value={form.cost}
                    onChange={e=>setForm({...form,cost:e.target.value})} placeholder="e.g. 1370" style={{ marginTop:6 }}/>
                </label>
              </div>

              {(Number(form.portPrice)>0||Number(form.cost)>0) && (
                <div style={{ padding:"10px 14px", borderRadius:8, background:"var(--bg-panel)",
                  border:"1px solid var(--border)", display:"flex", gap:24, fontSize:13 }}>
                  <span>Price: <strong style={{ color:"var(--accent)" }}>{fmt(form.portPrice)}</strong></span>
                  <span>Cost: <strong style={{ color:"#f87171" }}>{fmt(form.cost)}</strong></span>
                  <span>Profit: <strong style={{ color:(Number(form.portPrice)-Number(form.cost))>=0?"#34d399":"#f87171" }}>
                    {fmt(Number(form.portPrice)-Number(form.cost))}
                  </strong></span>
                </div>
              )}
            </div>
            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button onClick={saveRow}>Save</button>
              <button onClick={()=>setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
