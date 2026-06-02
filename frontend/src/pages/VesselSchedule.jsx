const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

import { useEffect, useRef, useState } from "react";

const CARRIER_COLORS = {
  SALLAUM: { bg: "rgba(99,102,241,0.15)", color: "#a78bfa", border: "rgba(167,139,250,0.3)" },
  ACL:     { bg: "rgba(5,150,105,0.15)",  color: "#34d399", border: "rgba(52,211,153,0.3)"  },
  OTHER:   { bg: "rgba(100,116,139,0.15)",color: "#94a3b8", border: "rgba(148,163,184,0.3)" },
};

const SALLAUM_VESSELS = ["PLATINUM RAY","OCEAN EXPLORER","RCC AMSTERDAM","LIBERTY PEACE",
  "GLOVIS SUNRISE","LIBERTY PROMISE","RCC COMPASS"];

function carrierOf(carrier, vessel) {
  if (carrier) return carrier.toUpperCase();
  if (!vessel) return "OTHER";
  const v = vessel.toUpperCase();
  if (SALLAUM_VESSELS.some(s => v.includes(s.split(" ")[0]))) return "SALLAUM";
  if (v.includes("GRANDE") || v.includes("ABIDJAN")) return "ACL";
  return "OTHER";
}

function CarrierBadge({ carrier, vessel }) {
  const c = carrierOf(carrier, vessel);
  const s = CARRIER_COLORS[c] || CARRIER_COLORS.OTHER;
  return (
    <span style={{ padding:"2px 7px", borderRadius:12, fontSize:10, fontWeight:700,
      background:s.bg, color:s.color, border:`1px solid ${s.border}` }}>
      {c}
    </span>
  );
}

function fmtDate(v) {
  if (!v || v === "NA") return <span style={{ color:"var(--text-muted)" }}>—</span>;
  // Always use UTC to avoid timezone off-by-one (dates are stored as midnight UTC)
  let ms;
  if (typeof v === "number") {
    // Excel serial → ms since Unix epoch
    ms = Math.round((v - 25569) * 86400 * 1000);
  } else if (typeof v === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v.trim())) {
    // Already MM/DD/YYYY string — parse as UTC
    const [mo, dy, yr] = v.trim().split("/");
    ms = Date.UTC(+yr, +mo - 1, +dy);
  } else if (typeof v === "string") {
    // ISO string or other — parse and use UTC
    const d = new Date(v);
    ms = isNaN(d) ? null : d.getTime();
  } else {
    ms = null;
  }
  if (ms == null) return <span style={{ color:"var(--text-muted)" }}>{v}</span>;
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${mm}/${dd}/${yy}`;
}

function DropZone({ label, icon, file, onChange, accept=".pdf" }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onChange(f);
  };

  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${dragging ? "#2563eb" : file ? "#22c55e" : "var(--border)"}`,
        borderRadius: 12, padding: "28px 20px", textAlign:"center",
        cursor:"pointer", transition:"all .2s",
        background: dragging ? "rgba(37,99,235,0.06)" : file ? "rgba(34,197,94,0.06)" : "var(--bg-panel)",
        flex:1, minWidth:220,
      }}>
      <input ref={inputRef} type="file" accept={accept} style={{ display:"none" }}
        onChange={e => e.target.files[0] && onChange(e.target.files[0])} />
      <div style={{ fontSize:28, marginBottom:8 }}>{file ? "✅" : icon}</div>
      <div style={{ fontWeight:600, fontSize:13, color: file ? "#22c55e" : "var(--text-primary)" }}>
        {file ? file.name : label}
      </div>
      <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:4 }}>
        {file ? "Click to replace" : "Click or drag & drop PDF"}
      </div>
    </div>
  );
}

export default function VesselSchedule() {
  const [tab, setTab]           = useState("view");   // "view" | "update"
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [filterCarrier, setFilterCarrier] = useState("");
  const [filterPOD, setFilterPOD]         = useState("");
  const [filterPOL, setFilterPOL]         = useState("");

  // Upload state
  const [sallaumFile, setSallaumFile] = useState(null);
  const [aclFile, setAclFile]         = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [result, setResult]           = useState(null);  // { success, deleted, added, error }

  useEffect(() => { fetchSchedule(); }, []);

  const fetchSchedule = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/schedule/all`);
      setRows(await res.json());
    } catch { setRows([]); }
    setLoading(false);
  };

  const handleUpdate = async () => {
    if (!sallaumFile && !aclFile) { alert("Select at least one PDF to upload."); return; }
    setUploading(true); setResult(null);
    const fd = new FormData();
    if (sallaumFile) fd.append("sallaum", sallaumFile);
    if (aclFile)     fd.append("acl",     aclFile);
    try {
      const res  = await fetch("${API}/api/schedule/update-from-pdfs", { method:"POST", body:fd });
      const data = await res.json();
      setResult(data);
      if (data.success) { fetchSchedule(); setSallaumFile(null); setAclFile(null); }
    } catch (e) {
      setResult({ error: e.message });
    }
    setUploading(false);
  };

  // Derived values for filters
  const allPODs = [...new Set(rows.map(r => r["POD"]).filter(Boolean))].sort();
  const allPOLs = [...new Set(rows.map(r => r["POL"]).filter(Boolean))].sort();

  const filtered = rows.filter(r => {
    const carrier = carrierOf(r["Carrier"], r["Vessel"]);
    if (filterCarrier && carrier !== filterCarrier) return false;
    if (filterPOD && r["POD"] !== filterPOD) return false;
    if (filterPOL && r["POL"] !== filterPOL) return false;
    if (search) {
      const text = `${r["Vessel"]} ${r["Voyage"]} ${r["POL"]} ${r["POD"]}`.toLowerCase();
      if (!text.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  // Sort by sail date ascending
  const sorted = [...filtered].sort((a, b) => {
    const da = a["Sail Date"]; const db = b["Sail Date"];
    if (!da || da === "NA") return 1;
    if (!db || db === "NA") return -1;
    return new Date(da) - new Date(db);
  });

  const tabStyle = (t) => ({
    padding:"8px 20px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:13,
    background: tab===t ? "#2563eb" : "var(--bg-panel)",
    color:      tab===t ? "white"   : "var(--text-muted)",
    border:     tab===t ? "none"    : "1px solid var(--border)",
  });

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1>Vessel Schedule</h1>
          <p>View upcoming sailings and update the schedule from carrier PDFs.</p>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button style={tabStyle("view")}   onClick={() => setTab("view")}>📋 View Schedule</button>
          <button style={tabStyle("update")} onClick={() => setTab("update")}>⬆️ Update Schedule</button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === "view" && (
        <section className="form-section towing-section">

          {/* Toolbar */}
          <div className="towing-toolbar" style={{ flexWrap:"wrap", gap:10 }}>
            <div style={{ color:"var(--text-muted)", fontSize:12 }}>
              {loading ? "Loading…" : `${sorted.length} sailings`}
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginLeft:"auto" }}>
              <select value={filterCarrier} onChange={e => setFilterCarrier(e.target.value)}>
                <option value="">All Carriers</option>
                <option value="SALLAUM">Sallaum</option>
                <option value="ACL">ACL / Grimaldi</option>
              </select>
              <select value={filterPOL} onChange={e => setFilterPOL(e.target.value)}>
                <option value="">All POLs</option>
                {allPOLs.map(p => <option key={p}>{p}</option>)}
              </select>
              <select value={filterPOD} onChange={e => setFilterPOD(e.target.value)}>
                <option value="">All PODs</option>
                {allPODs.map(p => <option key={p}>{p}</option>)}
              </select>
              <input placeholder="Search vessel, voyage, port…"
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ width:210 }} />
            </div>
          </div>

          <table className="orders-table towing-table">
            <thead>
              <tr>
                <th>Carrier</th>
                <th>Vessel</th>
                <th>Voyage</th>
                <th>POL</th>
                <th>POD</th>
                <th>Cutoff</th>
                <th>Sail Date</th>
                <th>Arrival</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i}>
                  <td><CarrierBadge carrier={r["Carrier"]} vessel={r["Vessel"]} /></td>
                  <td style={{ fontWeight:600 }}>{r["Vessel"]}</td>
                  <td style={{ color:"var(--text-muted)", fontSize:12 }}>{r["Voyage"]}</td>
                  <td>{r["POL"]}</td>
                  <td>{r["POD"]}</td>
                  <td style={{ fontSize:12 }}>{fmtDate(r["Cutoff Date"])}</td>
                  <td style={{ fontWeight:600 }}>{fmtDate(r["Sail Date"])}</td>
                  <td style={{ fontSize:12 }}>{fmtDate(r["Arrival Date"])}</td>
                </tr>
              ))}
              {!loading && sorted.length === 0 && (
                <tr><td colSpan="8" style={{ textAlign:"center", color:"var(--text-muted)" }}>
                  No schedule data found.
                </td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {tab === "update" && (
        <section className="form-section" style={{ maxWidth:700 }}>
          <h3 style={{ marginTop:0, marginBottom:4 }}>Update Master Schedule</h3>
          <p style={{ color:"var(--text-muted)", fontSize:13, marginBottom:24 }}>
            Upload the latest PDF schedules from Sallaum and ACL. The system will parse both files,
            remove old voyages, and add the new ones automatically.
          </p>

          {/* Drop zones */}
          <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:24 }}>
            <DropZone
              label="Sallaum (refreshes from website)"
              icon="🚢"
              file={sallaumFile}
              onChange={setSallaumFile}
            />
            <DropZone
              label="ACL / Grimaldi Schedule PDF"
              icon="🛳️"
              file={aclFile}
              onChange={setAclFile}
            />
          </div>

          {/* Update button */}
          <button
            onClick={handleUpdate}
            disabled={uploading || (!sallaumFile && !aclFile)}
            style={{
              padding:"11px 28px", borderRadius:9, border:"none", fontWeight:700,
              fontSize:14, cursor: (uploading||(!sallaumFile&&!aclFile)) ? "not-allowed" : "pointer",
              background: (sallaumFile || aclFile) ? "#2563eb" : "var(--bg-panel)",
              color:      (sallaumFile || aclFile) ? "white"   : "var(--text-muted)",
              opacity:    uploading ? 0.7 : 1, transition:"all .2s",
            }}>
            {uploading ? "⏳ Updating…" : "⬆️ Update Schedule"}
          </button>

          {/* Result banner */}
          {result && (
            <div style={{
              marginTop:20, padding:"16px 20px", borderRadius:10,
              background: result.success ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
              border: `1px solid ${result.success ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            }}>
              {result.success ? (
                <>
                  <div style={{ fontWeight:700, color:"#22c55e", marginBottom:6 }}>✅ Schedule Updated Successfully</div>
                  <div style={{ fontSize:13, color:"var(--text-secondary)" }}>
                    {result.sallaum > 0 && <span>🚢 Sallaum: <strong>{result.sallaum}</strong> rows &nbsp;·&nbsp; </span>}
                    {result.acl     > 0 && <span>🛳️ ACL: <strong>{result.acl}</strong> rows</span>}
                    {!result.sallaum && !result.acl && <span>Added <strong>{result.added}</strong> rows</span>}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight:700, color:"#f87171", marginBottom:6 }}>❌ Update Failed</div>
                  <div style={{ fontSize:12, color:"var(--text-muted)", fontFamily:"monospace" }}>
                    {result.error}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Info box */}
          <div style={{
            marginTop:28, padding:"14px 18px", borderRadius:10,
            background:"var(--bg-panel)", border:"1px solid var(--border)", fontSize:12,
            color:"var(--text-muted)", lineHeight:1.7,
          }}>
            <strong style={{ color:"var(--text-primary)" }}>ℹ️ How it works</strong><br />
            The system uses the <strong>Sallaum vessel schedule PDF</strong> (e.g. <em>Vessel_Schedule_06.01.pdf</em>)
            and the <strong>ACL/Grimaldi weekly RoRo PDF</strong> (e.g. <em>ACL Week 21 RoRo Schedule.pdf</em>).
            All existing rows for those carriers are removed and replaced with the fresh data.
            Dates with "t/s via Dakar" or "N/A" are handled automatically.
          </div>
        </section>
      )}
    </div>
  );
}
