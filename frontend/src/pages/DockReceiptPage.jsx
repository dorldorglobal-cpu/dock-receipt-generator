import { useEffect, useState, useCallback, useRef } from "react";
import "../App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "Never";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function DropZone({ label, sub, file, onFile, accept }) {
  const [dragging, setDragging] = useState(false);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <label
      className={`dropzone ${dragging ? "active" : ""} ${file ? "has-file" : ""}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{ display: "block", cursor: "pointer" }}
    >
      <div className="dropzone-icon">{file ? "✅" : "📂"}</div>
      <div className="dropzone-label">{file ? file.name : label}</div>
      <div className="dropzone-sub">{file ? "Click to change file" : sub}</div>
      <input type="file" accept={accept} style={{ display: "none" }}
        onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
    </label>
  );
}

function DarkSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const selected = options.find(o => o.value === value) || options[0];
  const s = { background: "#1c2130", border: "1px solid #2a3245", borderRadius: 6, color: "#e6edf3", fontSize: 13 };
  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ ...s, padding: "6px 32px 6px 10px", cursor: "pointer", userSelect: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{selected?.label}</span>
        <span style={{ fontSize: 10, color: "#8b949e" }}>▾</span>
      </div>
      {open && (
        <div style={{ ...s, position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999, marginTop: 2, boxShadow: "0 4px 16px #0008" }}>
          {options.map(o => (
            <div key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
              style={{ padding: "7px 10px", cursor: "pointer", background: o.value === value ? "#2a3a5a" : "transparent", color: "#e6edf3" }}
              onMouseEnter={e => e.currentTarget.style.background = "#232d42"}
              onMouseLeave={e => e.currentTarget.style.background = o.value === value ? "#2a3a5a" : "transparent"}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RadioGroup({ name, options, value, onChange }) {
  return (
    <div className="radio-group">
      {options.map(opt => (
        <label key={opt.value} className="radio-option">
          <input type="radio" name={name} value={opt.value}
            checked={value === opt.value} onChange={e => onChange(e.target.value)} />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DockReceiptPage() {
  const [aesFile, setAesFile]           = useState(null);
  const [dispatchFile, setDispatchFile] = useState(null);
  const [condition, setCondition]       = useState("RUNNER");
  const [titleStatus, setTitleStatus]   = useState("TITLE");
  const [result, setResult]             = useState(null);
  const [message, setMessage]           = useState("");
  const [msgType, setMsgType]           = useState(""); // "success" | "error" | ""
  const [search, setSearch]             = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [scheduleStatus, setScheduleStatus] = useState(null);
  const [refreshing, setRefreshing]     = useState("");
  const [sendModal, setSendModal]       = useState(null); // { pdfBase64, pdfName }
  const [sendTo, setSendTo]             = useState("");
  const [sendTrucker, setSendTrucker]   = useState("");
  const [sendSubject, setSendSubject]   = useState("");
  const [sendBody, setSendBody]         = useState("");
  const [sending, setSending]           = useState(false);

  useEffect(() => { loadScheduleStatus(); }, []);

  const loadScheduleStatus = async () => {
    try {
      const res = await fetch(`${API}/api/schedule/status`);
      const data = await res.json();
      setScheduleStatus(data);
    } catch { /* ignore */ }
  };

  const setMsg = (text, type = "") => { setMessage(text); setMsgType(type); };



  // ── ACL: Upload PDF (parses full schedule — vessel, voyage, sail, cutoff, arrival) ──
  const [aclFile, setAclFile] = useState(null);

  const uploadAclPdf = async () => {
    if (!aclFile) { setMsg("Select the ACL schedule PDF first", "error"); return; }
    setRefreshing("acl-pdf");
    setMsg("Parsing ACL schedule PDF…");
    try {
      const fd = new FormData();
      fd.append("schedule", aclFile);
      const res = await fetch(`${API}/api/schedule/upload-acl-pdf`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(`✅ ACL schedule loaded — ${data.rows} routes`, "success");
      setAclFile(null);
      loadScheduleStatus();
    } catch (err) {
      setMsg(`❌ ACL PDF failed: ${err.message}`, "error");
    } finally { setRefreshing(""); }
  };

  // ── Upload master Excel (legacy / manual fallback) ──────────────────────────
  const [excelFile, setExcelFile] = useState(null);

  const uploadExcel = async () => {
    if (!excelFile) { setMsg("Select an Excel schedule first", "error"); return; }
    setRefreshing("excel");
    setMsg("Saving Excel schedule…");
    try {
      const fd = new FormData();
      fd.append("schedule", excelFile);
      const res = await fetch(`${API}/api/schedule/upload-excel`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(`✅ Excel schedule saved (${data.rows} rows)`, "success");
      setExcelFile(null);
      loadScheduleStatus();
    } catch (err) {
      setMsg(`❌ Excel upload failed: ${err.message}`, "error");
    } finally { setRefreshing(""); }
  };

  // ── Process AES + Dispatch ──────────────────────────────────────────────────
  const processFiles = async () => {
    if (!aesFile) { setMsg("Upload an AES PDF first", "error"); return; }
    setMsg("Processing…");
    setResult(null);

    const fd = new FormData();
    if (aesFile)      fd.append("aes", aesFile);
    if (dispatchFile) fd.append("dispatch", dispatchFile);

    try {
      const res = await fetch(`${API}/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Error processing files", "error"); return; }
      setResult({ ...data, condition, titleStatus });
      setMsg("✅ Files parsed successfully", "success");
    } catch {
      setMsg("❌ Backend not reachable", "error");
    }
  };

  // ── Download PDF ────────────────────────────────────────────────────────────
  const downloadPDF = async () => {
    if (!result) return;

    const vin = (result.vin || "").trim();
    if (!vin) {
      if (!window.confirm("⚠ VIN is missing. Continue anyway?")) return;
    } else if (vin.length !== 17) {
      if (!window.confirm(`⚠ VIN should be 17 chars. Current: ${vin}\nContinue?`)) return;
    }

    // Port/country mismatch check
    const portToCountry = { LAGOS: "NIGERIA", TEMA: "GHANA", COTONOU: "BENIN", LOME: "TOGO" };
    const countryToPort = { NIGERIA: "LAGOS", GHANA: "TEMA", BENIN: "COTONOU", TOGO: "LOME" };
    const pod = (result.portOfDischarge || "").toUpperCase();
    const country = (result.consigneeCountry || "").toUpperCase();
    const expectedCountry = portToCountry[pod];
    const correctPort = countryToPort[country];

    let finalResult = { ...result };

    if (expectedCountry && country && expectedCountry !== country) {
      if (window.confirm(`⚠ Consignee country is ${country} but port is ${pod}.\nClick OK to fix port to ${correctPort}.`)) {
        finalResult = { ...finalResult, portOfDischarge: correctPort };
        setResult(finalResult);
      }
    }

    const res = await fetch(`${API}/generate-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalResult),
    });

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${finalResult.referenceNumber || "dock-receipt"} DR.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openSendModal = async () => {
    if (!result) return;
    const vin = (result.vin || "").trim();
    if (!vin && !window.confirm("⚠ VIN is missing. Continue anyway?")) return;

    const res = await fetch(`${API}/generate-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    const blob = await res.blob();
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(",")[1];
      const pdfName = `${result.referenceNumber || "dock-receipt"} DR.pdf`;
      setSendModal({ pdfBase64: base64, pdfName });
      setSendTo("");
      setSendTrucker("");
      setSendSubject(`Dock Receipt — ${result.referenceNumber || ""} | ${result.vehicleYearMakeModel || ""} | VIN: ${result.vin || ""}`);
      setSendBody(`Please find the attached Dock Receipt for your vehicle.\n\nVIN: ${result.vin || ""}\nVessel: ${result.vessel || ""} | Voyage: ${result.voyage || ""}\nPort of Loading: ${result.portOfLoading || ""}\n\nRegards,\nDDG OPS`);
    };
    reader.readAsDataURL(blob);
  };

  const sendEmails = async () => {
    if (!sendModal) return;
    const recipients = [sendTo, sendTrucker].map(e => e.trim()).filter(Boolean);
    if (!recipients.length) return alert("Enter at least one email address.");
    setSending(true);
    try {
      await Promise.all(recipients.map(to =>
        fetch(`${API}/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, subject: sendSubject, body: sendBody, pdfBase64: sendModal.pdfBase64, pdfName: sendModal.pdfName }),
        })
      ));
      setSendModal(null);
      setMsg("✅ DR sent successfully", "success");
    } catch {
      setMsg("❌ Failed to send email", "error");
    }
    setSending(false);
  };

  // ── Search saved shipments ──────────────────────────────────────────────────
  const handleSearch = async () => {
    if (!search.trim()) return;
    try {
      const res = await fetch(`${API}/search?q=${encodeURIComponent(search)}`);
      setSearchResults(await res.json());
    } catch { setSearchResults([]); }
  };

  // ── Field editing ───────────────────────────────────────────────────────────
  const updateField = (key, value) => setResult(r => ({ ...r, [key]: value }));

  // ── Excel column ────────────────────────────────────────────────────────────
  const excelColumn = result ? [
    result.bookingNumber, result.referenceNumber,
    result.exporterName, result.exporterAddress, result.exporterCity, result.exporterState, result.exporterZip, result.exporterCountry,
    result.consigneeName, result.consigneeAddress, result.consigneeCity, result.consigneeCountry,
    result.vehicleType, result.weightKgs, result.vehicleYearMakeModel, result.vin, result.value, result.aesItn,
    result.portOfLoading, result.portOfDischarge,
    result.vessel, result.voyage,
    result.cutoffDate, result.sailDate, result.arrivalDate,
    result.pickupName, result.pickupAddress, result.pickupCity, result.pickupState, result.pickupZip,
    result.deliveryName, result.deliveryAddress, result.deliveryCity, result.deliveryState, result.deliveryZip,
    result.condition, result.titleStatus,
  ].join("\n") : "";

  const copyExcel = () => {
    navigator.clipboard.writeText(excelColumn);
    setMsg("✅ Copied to clipboard", "success");
  };

  const hiddenKeys = ["_id", "__v", "createdAt", "updatedAt", "scheduleRowsRead", "scheduleMatchFound", "dispatchVin", "dispatchWeightKgs"];

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1>Dock Receipt Generator</h1>
          <p>Parse AES + Dispatch PDFs → auto-fill and generate dock receipts</p>
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div style={{
          padding: "10px 16px", marginBottom: 20, borderRadius: "var(--radius-md)",
          background: msgType === "success" ? "var(--success-dim)" : msgType === "error" ? "var(--danger-dim)" : "var(--bg-panel)",
          border: `1px solid ${msgType === "success" ? "var(--success)" : msgType === "error" ? "var(--danger)" : "var(--border)"}`,
          color: msgType === "success" ? "var(--success)" : msgType === "error" ? "var(--danger)" : "var(--text-secondary)",
          fontSize: 13,
        }}>
          {message}
        </div>
      )}

      {/* ── Vessel Schedules ── */}
      <div className="form-section">
        <h2>Vessel Schedules</h2>

        <div className="schedule-status-row">
          {/* Sallaum card */}
          <div className={`schedule-card ${scheduleStatus?.sallaum?.loaded ? "loaded" : "empty"}`}>
            <div className="sc-carrier">Sallaum Lines</div>
            <div className="sc-status">
              {scheduleStatus?.sallaum?.loaded
                ? `✅ ${scheduleStatus.sallaum.rows} routes loaded`
                : "⚪ Not loaded"}
            </div>
            {scheduleStatus?.sallaum?.updatedAt && (
              <div className="sc-meta">Updated {fmtDate(scheduleStatus.sallaum.updatedAt)}</div>
            )}
          </div>

          {/* ACL card */}
          <div className={`schedule-card ${scheduleStatus?.acl?.loaded ? "loaded" : "empty"}`}>
            <div className="sc-carrier">ACL / Grimaldi</div>
            <div className="sc-status">
              {scheduleStatus?.acl?.loaded
                ? `✅ ${scheduleStatus.acl.rows} routes loaded`
                : "⚪ Not loaded"}
            </div>
            {scheduleStatus?.acl?.updatedAt && (
              <div className="sc-meta">Updated {fmtDate(scheduleStatus.acl.updatedAt)}</div>
            )}
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <DropZone
                label="Upload ACL Schedule PDF"
                sub="Weekly RoRo PDF (e.g. ACL Week 21 RoRo Schedule.pdf)"
                file={aclFile}
                onFile={setAclFile}
                accept=".pdf"
              />
              {aclFile && (
                <button onClick={uploadAclPdf} disabled={refreshing === "acl-pdf"}
                  style={{ fontSize: 12, padding: "7px 14px" }}>
                  {refreshing === "acl-pdf" ? "Parsing PDF…" : "⬆ Load ACL Schedule"}
                </button>
              )}
            </div>
          </div>

          {/* Excel fallback card */}
          <div className="schedule-card empty">
            <div className="sc-carrier">Master Excel (Fallback)</div>
            <div className="sc-status" style={{ color: "var(--text-muted)" }}>Manual upload</div>
            <div style={{ marginTop: 10 }}>
              <DropZone
                label="Upload Master Excel"
                sub=".xlsx with schedule data"
                file={excelFile}
                onFile={setExcelFile}
                accept=".xlsx,.xls"
              />
              {excelFile && (
                <button onClick={uploadExcel} disabled={refreshing === "excel"}
                  style={{ marginTop: 8, width: "100%", fontSize: 12, padding: "7px 14px" }}>
                  {refreshing === "excel" ? "Saving…" : "⬆ Upload Excel"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Search Saved Shipments ── */}
      <div className="form-section">
        <h2>Search Saved Shipments</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            placeholder="Search VIN or Reference #"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            style={{ flex: 1, maxWidth: 360 }}
          />
          <button onClick={handleSearch} className="btn-ghost">Search</button>
        </div>

        {searchResults.length > 0 && (
          <table className="orders-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Ref #</th><th>VIN</th><th>Vessel</th><th>Voyage</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              {searchResults.map((r, i) => (
                <tr key={i} style={{ cursor: "pointer" }} onClick={() => { setResult(r); setSearchResults([]); setMsg("Shipment loaded", "success"); }}>
                  <td style={{ color: "var(--accent)" }}>{r.referenceNumber}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.vin}</td>
                  <td>{r.vessel}</td>
                  <td>{r.voyage}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Daily Files ── */}
      <div className="form-section">
        <h2>Parse Daily Files</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
          <DropZone label="AES PDF" sub="Drag AES document here or click to browse" file={aesFile} onFile={setAesFile} accept=".pdf" />
          <DropZone label="Dispatch PDF" sub="Optional — drag dispatch document here" file={dispatchFile} onFile={setDispatchFile} accept=".pdf" />
        </div>

        <div style={{ display: "flex", gap: 32, marginBottom: 20, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 8 }}>
              Condition of Vehicle
            </div>
            <RadioGroup name="condition" value={condition} onChange={setCondition}
              options={[{ value: "RUNNER", label: "Runner" }, { value: "NONRUNNER", label: "Non-Runner" }, { value: "FORKLIFT", label: "Forklift" }]} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 8 }}>
              Title Status
            </div>
            <RadioGroup name="title" value={titleStatus} onChange={setTitleStatus}
              options={[{ value: "TITLE", label: "Title" }, { value: "NO TITLE", label: "No Title" }]} />
          </div>
        </div>

        <button onClick={processFiles} style={{ padding: "10px 24px", fontSize: 14 }}>
          ⚡ Process Files
        </button>
      </div>

      {/* ── Results ── */}
      {result && (
        <div className="form-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border-muted)" }}>
            <h2 style={{ margin: 0, border: "none", padding: 0 }}>Parsed Result — Review & Download</h2>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-ghost" onClick={copyExcel} style={{ fontSize: 12, padding: "7px 14px" }}>
                📋 Copy Excel Column
              </button>
              <button onClick={downloadPDF} style={{ fontSize: 13 }}>
                📄 Generate DR PDF
              </button>
              <button onClick={openSendModal} style={{ fontSize: 13, background: "#059669", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer" }}>
                ✉️ Send DR
              </button>
            </div>
          </div>

          {/* Schedule match indicator */}
          <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: "var(--radius-sm)", background: "var(--bg-panel)", fontSize: 12 }}>
            <span style={{ color: "var(--text-muted)" }}>Schedule match: </span>
            <span style={{ color: result.scheduleMatchFound === "YES" ? "var(--success)" : "var(--warning)", fontWeight: 500 }}>
              {result.scheduleMatchFound === "YES" ? `✅ Found — ${result.vessel} | Voyage: ${result.voyage}` : "⚠ No match — enter voyage manually"}
            </span>
          </div>

          {/* Editable field grid */}
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "6px 12px", maxWidth: 900 }}>
            {Object.keys(result)
              .filter(key => !hiddenKeys.includes(key))
              .map(key => (
                <div key={key} style={{ display: "contents" }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", alignSelf: "center", paddingRight: 8 }}>
                    {key}
                  </label>
                  {key === "condition" ? (
                    <DarkSelect value={result[key] || "RUNNER"} onChange={v => updateField(key, v)}
                      options={[{ value: "RUNNER", label: "Runner" }, { value: "NONRUNNER", label: "Non-Runner" }, { value: "FORKLIFT", label: "Forklift" }]} />
                  ) : key === "titleStatus" ? (
                    <DarkSelect value={result[key] || "TITLE"} onChange={v => updateField(key, v)}
                      options={[{ value: "TITLE", label: "Title" }, { value: "NO TITLE", label: "No Title" }]} />
                  ) : (
                    <input
                      value={result[key] || ""}
                      onChange={e => updateField(key, e.target.value)}
                      style={{ fontSize: 13, padding: "6px 10px", background: "#1c2130", color: "#e6edf3", border: "1px solid #2a3245", borderRadius: 6 }}
                    />
                  )}
                </div>
              ))}
          </div>

          {/* Excel column preview */}
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginBottom: 6 }}>Excel Column Preview</div>
            <textarea
              value={excelColumn}
              readOnly
              style={{ width: "100%", height: 120, fontFamily: "monospace", fontSize: 12, resize: "vertical", background: "var(--bg-panel)", color: "var(--text-secondary)" }}
            />
          </div>

          <div style={{ display:"flex", gap:10, marginTop:16 }}>
            <button onClick={downloadPDF} style={{ padding: "10px 24px" }}>
              📄 Generate DR PDF (with overrides)
            </button>
            <button onClick={openSendModal} style={{ padding:"10px 24px", background:"#059669", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontWeight:600 }}>
              ✉️ Send DR
            </button>
          </div>
        </div>
      )}

      {/* ── Send DR Modal ── */}
      {sendModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:"#1c2130", border:"1px solid #2a3245", borderRadius:12, padding:28, width:480, maxWidth:"95vw" }}>
            <h3 style={{ margin:"0 0 18px", color:"#e6edf3" }}>✉️ Send Dock Receipt</h3>
            {[
              { label:"Customer Email", value: sendTo, set: setSendTo, placeholder:"customer@example.com" },
              { label:"Trucker Email (optional)", value: sendTrucker, set: setSendTrucker, placeholder:"trucker@example.com" },
              { label:"Subject", value: sendSubject, set: setSendSubject, placeholder:"Subject" },
            ].map(({ label, value, set, placeholder }) => (
              <label key={label} style={{ display:"block", marginBottom:12, fontSize:12, color:"#8b949e" }}>
                {label}
                <input value={value} onChange={e => set(e.target.value)} placeholder={placeholder}
                  style={{ display:"block", width:"100%", marginTop:4, padding:"8px 10px", background:"#0d1117", border:"1px solid #2a3245", borderRadius:6, color:"#e6edf3", fontSize:13, boxSizing:"border-box" }} />
              </label>
            ))}
            <label style={{ display:"block", marginBottom:18, fontSize:12, color:"#8b949e" }}>
              Message
              <textarea value={sendBody} onChange={e => setSendBody(e.target.value)} rows={5}
                style={{ display:"block", width:"100%", marginTop:4, padding:"8px 10px", background:"#0d1117", border:"1px solid #2a3245", borderRadius:6, color:"#e6edf3", fontSize:13, resize:"vertical", boxSizing:"border-box" }} />
            </label>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => setSendModal(null)} style={{ padding:"8px 18px", background:"none", border:"1px solid #2a3245", borderRadius:8, color:"#8b949e", cursor:"pointer" }}>Cancel</button>
              <button onClick={sendEmails} disabled={sending} style={{ padding:"8px 20px", background:"#059669", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontWeight:600 }}>
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
