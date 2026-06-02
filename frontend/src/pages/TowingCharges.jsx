import { useEffect, useState } from "react";

function fmt(n) {
  const num = Number(n || 0);
  if (!num) return "—";
  return "$" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function profitCell(price, cost) {
  const p = Number(price || 0);
  const c = Number(cost  || 0);
  if (!p && !c) return <span style={{ color:"var(--text-muted)" }}>—</span>;
  const profit = p - c;
  return (
    <span style={{ fontWeight:700, color: profit>0?"#34d399":profit<0?"#f87171":"var(--text-muted)" }}>
      {(profit>=0?"+":"")+fmt(profit)}
    </span>
  );
}

// ── Warehouse proximity engine ────────────────────────────────────────────────
const WAREHOUSES = [
  { name: "EZ CARGO",             city: "Old Bridge", state: "NJ", lat: 40.45, lng: -74.32 },
  { name: "SAVANNAH AUTO EXPORT", city: "Savannah",   state: "GA", lat: 32.08, lng: -81.10 },
  { name: "ISHIP",                city: "Houston",    state: "TX", lat: 29.76, lng: -95.37 },
  { name: "CEDARS EXPRESS",       city: "Compton",    state: "CA", lat: 33.90, lng: -118.22 },
];
const STATE_CENTROIDS = {
  AL:[32.80,-86.79],AK:[64.20,-153.43],AZ:[34.05,-111.09],AR:[34.97,-92.37],
  CA:[36.78,-119.42],CO:[39.06,-105.31],CT:[41.60,-72.70],DE:[38.99,-75.51],
  FL:[27.99,-81.76],GA:[32.68,-83.44],HI:[20.80,-156.47],ID:[44.07,-114.74],
  IL:[40.35,-88.99],IN:[39.85,-86.26],IA:[42.01,-93.21],KS:[38.53,-96.73],
  KY:[37.67,-84.87],LA:[31.17,-91.87],ME:[44.69,-69.38],MD:[39.07,-76.80],
  MA:[42.23,-71.53],MI:[44.32,-85.60],MN:[46.39,-94.64],MS:[32.74,-89.67],
  MO:[38.46,-92.29],MT:[46.88,-110.36],NE:[41.49,-99.90],NV:[38.31,-117.06],
  NH:[43.45,-71.56],NJ:[40.30,-74.52],NM:[34.84,-106.25],NY:[42.17,-74.95],
  NC:[35.63,-79.81],ND:[47.53,-99.78],OH:[40.19,-82.67],OK:[35.56,-96.93],
  OR:[44.57,-122.07],PA:[40.59,-77.21],RI:[41.68,-71.51],SC:[33.84,-80.94],
  SD:[44.37,-100.35],TN:[35.86,-86.35],TX:[31.17,-99.33],UT:[39.32,-111.09],
  VT:[44.05,-72.71],VA:[37.77,-78.17],WA:[47.40,-121.49],WV:[38.49,-80.95],
  WI:[44.27,-89.62],WY:[42.96,-107.55],
};
function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8, dL = (lat2-lat1)*Math.PI/180, dG = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function nearestWarehouse(stateCode) {
  const coords = STATE_CENTROIDS[(stateCode||"").toUpperCase().trim()];
  if (!coords) return null;
  let best = null, bestDist = Infinity;
  for (const wh of WAREHOUSES) {
    const d = haversine(coords[0], coords[1], wh.lat, wh.lng);
    if (d < bestDist) { bestDist = d; best = wh; }
  }
  return best ? { ...best, miles: Math.round(bestDist) } : null;
}
// ─────────────────────────────────────────────────────────────────────────────

export default function TowingCharges() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const [showAdd, setShowAdd] = useState(false);

  const blank = {
    name:"", address:"", city:"", state:"", port:"", warehouse:"",
    portPrice:"", cost:"",
    warehousePrice:"", warehouseCost:"",
  };
  const [form, setForm] = useState(blank);

  useEffect(() => { fetchRows(); }, []);

  const fetchRows = async () => {
    const res = await fetch("${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api/pricing?type=towing");
    setRows(await res.json());
  };

  const saveRow = async () => {
    if (!form.address && !form.city) { alert("Address or city is required"); return; }
    await fetch(
      form._id ? `${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api/pricing/${form._id}` : "${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api/pricing",
      {
        method: form._id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type:          "towing",
          name:          form.name,
          address:       form.address,
          city:          form.city,
          state:         form.state,
          port:          form.port,
          warehouse:     form.warehouse,
          portPrice:     Number(form.portPrice     || 0),
          cost:          Number(form.cost          || 0),
          warehousePrice:Number(form.warehousePrice|| 0),
          warehouseCost: Number(form.warehouseCost || 0),
        }),
      }
    );
    setForm(blank);
    setShowAdd(false);
    fetchRows();
  };

  const deleteRow = async (id) => {
    if (!window.confirm("Delete this towing charge?")) return;
    await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api/pricing/${id}`, { method:"DELETE" });
    fetchRows();
  };

  const filtered = rows.filter((r) => {
    // Search only on pickup location fields — NOT port/price columns
    const text = `${r.name||""} ${r.city||""} ${r.state||""}`.toLowerCase();
    return text.includes(search.toLowerCase());
  });

  const visibleRows = filtered.slice(0, Number(limit));

  // Thin section label
  const sectionLabel = (label) => (
    <span style={{ fontSize:9, fontWeight:700, letterSpacing:1, textTransform:"uppercase",
      color:"var(--text-muted)", display:"block", marginBottom:2 }}>{label}</span>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Towing Charges</h1>
          <p>Manage towing prices by address, city, state, and port.</p>
        </div>
        <button onClick={() => { setForm(blank); setShowAdd(true); }}
          style={{ padding:"8px 12px", borderRadius:8, border:"none",
            background:"#2563eb", color:"white", cursor:"pointer", fontSize:12 }}>
          + Add Towing Charge
        </button>
      </div>

      <section className="form-section towing-section">
        <div className="towing-toolbar">
          <div>
            Show{" "}
            <select value={limit} onChange={e => setLimit(e.target.value)}>
              {[10,25,50,100,500].map(n=><option key={n} value={n}>{n}</option>)}
            </select>{" "}entries
          </div>
          <div>Search: <input value={search} onChange={e=>setSearch(e.target.value)} /></div>
        </div>

        <table className="orders-table towing-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>City</th>
              <th>State</th>
              <th>Port</th>
              {/* Port group */}
              <th style={{ color:"var(--accent)", borderLeft:"1px solid var(--border)" }}>Port Sell</th>
              <th style={{ color:"#f87171" }}>Port Cost</th>
              <th style={{ color:"#34d399" }}>Port Profit</th>
              {/* Warehouse group */}
              <th style={{ borderLeft:"1px solid var(--border)" }}>Warehouse</th>
              <th style={{ color:"var(--accent)" }}>Wh. Sell</th>
              <th style={{ color:"#f87171" }}>Wh. Cost</th>
              <th style={{ color:"#34d399" }}>Wh. Profit</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r._id}>
                <td style={{ fontSize:11 }}>{r.name}</td>
                <td>{r.city}</td>
                <td>{r.state}</td>
                <td>{r.port}</td>
                {/* Port */}
                <td style={{ fontWeight:600, color:"var(--accent)", borderLeft:"1px solid var(--border)" }}>{fmt(r.portPrice)}</td>
                <td style={{ fontWeight:600, color:"#f87171" }}>{fmt(r.cost)}</td>
                <td>{profitCell(r.portPrice, r.cost)}</td>
                {/* Warehouse */}
                <td style={{ fontSize:11, borderLeft:"1px solid var(--border)" }}>
                  {r.warehouse
                    ? (() => {
                        const wh = WAREHOUSES.find(w => w.name.toLowerCase() === r.warehouse.toLowerCase());
                        return wh ? `${wh.name} - ${wh.state}` : r.warehouse;
                      })()
                    : "—"}
                </td>
                <td style={{ fontWeight:600, color:"var(--accent)" }}>{fmt(r.warehousePrice)}</td>
                <td style={{ fontWeight:600, color:"#f87171" }}>{fmt(r.warehouseCost)}</td>
                <td>{profitCell(r.warehousePrice, r.warehouseCost)}</td>
                <td style={{ display:"flex", gap:4 }}>
                  <button onClick={() => {
                    setForm({
                      name:          r.name          || "",
                      address:       r.address       || "",
                      city:          r.city          || "",
                      state:         r.state         || "",
                      port:          r.port          || "",
                      warehouse:     r.warehouse     || "",
                      portPrice:     r.portPrice     || "",
                      cost:          r.cost          || "",
                      warehousePrice:r.warehousePrice|| "",
                      warehouseCost: r.warehouseCost || "",
                      _id:           r._id,
                    });
                    setShowAdd(true);
                  }} style={{ fontSize:10, padding:"3px 6px" }}>Edit</button>
                  <button onClick={() => deleteRow(r._id)}
                    style={{ fontSize:10, padding:"3px 6px" }}>Delete</button>
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr><td colSpan="12">No towing charges found.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {showAdd && (
        <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal-card" onClick={e=>e.stopPropagation()} style={{ width:540 }}>
            <h2 style={{ marginTop:0 }}>{form._id ? "Edit Towing Charge" : "Add Towing Charge"}</h2>

            <div className="towing-popup-form">
              <label>Name
                <input value={form.name}
                  onChange={e=>setForm({...form,name:e.target.value})}
                  placeholder="e.g. Copart Tampa → ACL JAX" />
              </label>

              <label>Address
                <input value={form.address}
                  onChange={e=>setForm({...form,address:e.target.value})} />
              </label>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <label>City
                  <input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} />
                </label>
                <label>State
                  <input value={form.state}
                    onChange={e => {
                      const st = e.target.value.toUpperCase();
                      const wh = nearestWarehouse(st);
                      setForm(f => ({
                        ...f,
                        state: st,
                        // Auto-suggest nearest warehouse if field is empty or was auto-set before
                        warehouse: wh ? wh.name : f.warehouse,
                      }));
                    }} />
                </label>
              </div>

              <label>Port
                <input value={form.port}
                  onChange={e=>setForm({...form,port:e.target.value.toUpperCase()})} />
              </label>

              {/* PORT pricing */}
              <div style={{ padding:"12px", borderRadius:8, border:"1px solid var(--border)",
                background:"rgba(99,102,241,0.05)" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"var(--accent)",
                  marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>
                  🚢 Port Delivery
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <label>Sell Price <span style={{ fontSize:11, color:"var(--accent)" }}>(charged)</span>
                    <input type="number" value={form.portPrice}
                      onChange={e=>setForm({...form,portPrice:e.target.value})}
                      placeholder="e.g. 550" style={{ marginTop:6 }} />
                  </label>
                  <label>Cost <span style={{ fontSize:11, color:"#f87171" }}>(paid)</span>
                    <input type="number" value={form.cost}
                      onChange={e=>setForm({...form,cost:e.target.value})}
                      placeholder="e.g. 450" style={{ marginTop:6 }} />
                  </label>
                </div>
                {(Number(form.portPrice)>0 || Number(form.cost)>0) && (
                  <div style={{ marginTop:8, fontSize:12, display:"flex", gap:20 }}>
                    <span>Sell: <strong style={{ color:"var(--accent)" }}>{fmt(form.portPrice)}</strong></span>
                    <span>Cost: <strong style={{ color:"#f87171" }}>{fmt(form.cost)}</strong></span>
                    <span>Profit: <strong style={{
                      color:(Number(form.portPrice)-Number(form.cost))>=0?"#34d399":"#f87171" }}>
                      {(Number(form.portPrice)-Number(form.cost))>=0?"+":""}{fmt(Number(form.portPrice)-Number(form.cost))}
                    </strong></span>
                  </div>
                )}
              </div>

              {/* WAREHOUSE pricing */}
              <div style={{ padding:"12px", borderRadius:8, border:"1px solid var(--border)",
                background:"rgba(16,185,129,0.05)" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#34d399",
                  marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>
                  🏭 Warehouse Delivery
                </div>
                <label>Warehouse Name
                  <input value={form.warehouse}
                    onChange={e=>setForm({...form,warehouse:e.target.value})}
                    placeholder="e.g. Savannah Warehouse" style={{ marginBottom:8 }} />
                </label>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <label>Sell Price <span style={{ fontSize:11, color:"var(--accent)" }}>(charged)</span>
                    <input type="number" value={form.warehousePrice}
                      onChange={e=>setForm({...form,warehousePrice:e.target.value})}
                      placeholder="e.g. 650" style={{ marginTop:6 }} />
                  </label>
                  <label>Cost <span style={{ fontSize:11, color:"#f87171" }}>(paid)</span>
                    <input type="number" value={form.warehouseCost}
                      onChange={e=>setForm({...form,warehouseCost:e.target.value})}
                      placeholder="e.g. 520" style={{ marginTop:6 }} />
                  </label>
                </div>
                {(Number(form.warehousePrice)>0 || Number(form.warehouseCost)>0) && (
                  <div style={{ marginTop:8, fontSize:12, display:"flex", gap:20 }}>
                    <span>Sell: <strong style={{ color:"var(--accent)" }}>{fmt(form.warehousePrice)}</strong></span>
                    <span>Cost: <strong style={{ color:"#f87171" }}>{fmt(form.warehouseCost)}</strong></span>
                    <span>Profit: <strong style={{
                      color:(Number(form.warehousePrice)-Number(form.warehouseCost))>=0?"#34d399":"#f87171" }}>
                      {(Number(form.warehousePrice)-Number(form.warehouseCost))>=0?"+":""}{fmt(Number(form.warehousePrice)-Number(form.warehouseCost))}
                    </strong></span>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button onClick={saveRow}>Save</button>
              <button onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



