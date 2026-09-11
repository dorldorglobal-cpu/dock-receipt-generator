import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { API } from "../lib/auth";

// WebLink field code → friendly label
const LABELS = {
  SRN: "Shipment reference #", BN: "Booking / transport ref #", FAC: "Filing action",
  FO: "Filing option", FT: "AEI filing type", ST: "U.S. state of origin",
  POE: "Port of export (Schedule D)", COD: "Country of destination", POU: "Port of unlading (Schedule K)",
  EDA: "Est. date of export (YYMMDD)", MOT: "Mode of transport", SCAC: "Carrier SCAC",
  VN: "Vessel name", RCC: "Related party", HAZ: "Hazmat", RT: "Routed export", ORIG_ITN: "Original ITN",
  EMAIL: "Response email", wl_success_url: "Success return URL", wl_nosed_url: "Failure return URL",
  AD0_1: "USPPI name", AD0_2: "USPPI EIN", AD0_3: "USPPI ID type", AD0_4: "USPPI address 1",
  AD0_5: "USPPI address 2", AD0_6: "USPPI city", AD0_7: "USPPI state", AD0_8: "USPPI ZIP",
  AD0_9: "USPPI contact first", AD0_11: "USPPI contact last", AD0_12: "USPPI phone",
  AD1_3: "Consignee name", AD1_5: "Consignee contact", AD1_6: "Sold en route", AD1_7: "Consignee phone",
  AD1_8: "Consignee address", AD1_10: "Consignee city", AD1_11: "Consignee state",
  AD1_12: "Consignee country", AD1_13: "Consignee postal", AD1_14: "Ult. consignee type",
  AD3_2: "Fwd agent ID type", AD3_3: "Fwd agent name", AD3_4: "Fwd agent ID", AD3_5: "Fwd agent contact",
  AD3_7: "Fwd agent phone", AD3_8: "Fwd agent address 1", AD3_9: "Fwd agent address 2",
  AD3_10: "Fwd agent city", AD3_11: "Fwd agent state", AD3_12: "Fwd agent country", AD3_13: "Fwd agent postal",
  isLine1: "Line 1 flag", IT1_1: "Export info code", IT1_2: "Value (USD)", IT1_3: "Unit of measure",
  IT1_4: "Quantity", IT1_7: "Shipping weight (kg)", IT1_8: "License code", IT1_9: "License number",
  IT1_12: "Commodity description", IT1_13: "Schedule B #", IT1_15: "Used vehicle flag",
  IT1_16: "Vehicle ID qualifier", IT1_17: "VIN", IT1_18: "Title number", IT1_19: "Title state",
  IT1_20: "ECCN", IT1_21: "Origin (F/D)", EQ1: "Container #", SN1: "Seal #",
};

const GROUPS = [
  ["Shipment", ["SRN", "BN", "FAC", "FO", "FT", "ST", "POE", "COD", "POU", "EDA", "MOT", "SCAC", "VN", "RCC", "HAZ", "RT", "ORIG_ITN"]],
  ["USPPI (exporter of record)", ["AD0_1", "AD0_2", "AD0_3", "AD0_4", "AD0_5", "AD0_6", "AD0_7", "AD0_8", "AD0_9", "AD0_11", "AD0_12"]],
  ["Ultimate consignee", ["AD1_3", "AD1_5", "AD1_6", "AD1_7", "AD1_8", "AD1_10", "AD1_11", "AD1_12", "AD1_13", "AD1_14"]],
  ["Forwarding agent", ["AD3_2", "AD3_3", "AD3_4", "AD3_5", "AD3_7", "AD3_8", "AD3_9", "AD3_10", "AD3_11", "AD3_12", "AD3_13"]],
  ["Commodity — the vehicle", ["isLine1", "IT1_1", "IT1_2", "IT1_3", "IT1_4", "IT1_7", "IT1_8", "IT1_9", "IT1_12", "IT1_13", "IT1_15", "IT1_16", "IT1_17", "IT1_18", "IT1_19", "IT1_20", "IT1_21"]],
  ["Equipment", ["EQ1", "SN1"]],
  ["System", ["EMAIL", "wl_success_url", "wl_nosed_url"]],
];

// WebLink field code → editable Order field (inline fix on this screen)
const EDIT_MAP = {
  BN: "bookingNumber", ST: "pickupState", VN: "vessel",
  IT1_1: "exportInfoCode", IT1_2: "value", IT1_7: "weightKgs", IT1_13: "scheduleB",
  IT1_17: "vin", IT1_18: "titleNumber", IT1_19: "titleState",
  AD1_3: "consigneeName", AD1_8: "consigneeAddress", AD1_10: "consigneeCity",
  AD1_11: "consigneeState", AD1_13: "consigneeZip",
  EQ1: "containerNumber", SN1: "sealNumber",
};

const box = { background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, marginBottom: 14 };
const inputStyle = { padding: "5px 8px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-primary)", fontSize: 12, width: 220 };

export default function AesFiling() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState({ code: null, val: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setMsg("Loading…");
    fetch(`${API}/api/orders/${id}/aes-weblink`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setMsg("❌ " + d.error); else { setData(d); setMsg(""); } })
      .catch(() => setMsg("❌ Failed to load"));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const saveField = async (code) => {
    const orderField = EDIT_MAP[code];
    if (!orderField) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [orderField]: edit.val }),
      });
      if (!res.ok) { const e = await res.json(); setMsg("❌ " + (e.error || "save failed")); return; }
      setEdit({ code: null, val: "" });
      load();
    } finally { setBusy(false); }
  };

  const handOff = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await fetch(`${API}/api/orders/${id}/aes-mark-handoff`, { method: "POST" });
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.actionUrl;
      form.target = "_blank";
      Object.entries(data.fields).forEach(([k, v]) => {
        const i = document.createElement("input");
        i.type = "hidden"; i.name = k; i.value = v;
        form.appendChild(i);
      });
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
      setMsg("↗ Opened ACE AESDirect in a new tab. Review every screen there and click Submit Filing.");
      setTimeout(load, 1500);
    } finally { setBusy(false); }
  };

  if (!data) return <div style={{ padding: 24 }}>{msg || "Loading…"}</div>;

  const missingByCode = Object.fromEntries(data.missing.map((m) => [m.field, m]));
  const warnByCode = {};
  data.warnings.forEach((w) => { (warnByCode[w.field] = warnByCode[w.field] || []).push(w.note); });
  const isTest = data.meta.env !== "prod";

  return (
    <div style={{ padding: 24, maxWidth: 880 }}>
      <button onClick={() => navigate(`/orders/${id}`)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 }}>← Back to order</button>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>
        File AES · {data.order.refNumber}
        <span style={{ marginLeft: 10, fontSize: 12, padding: "2px 8px", borderRadius: 5, background: isTest ? "rgba(251,191,36,0.15)" : "rgba(239,68,68,0.15)", border: `1px solid ${isTest ? "#fbbf24" : "#ef4444"}`, color: isTest ? "#b45309" : "#b91c1c" }}>
          {isTest ? "TEST" : "PRODUCTION"}
        </span>
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 0 }}>
        {data.order.vehicleYearMakeModel || data.order.vin} · {data.order.requestType} · {data.order.pol || "?"} → {data.order.pod || "?"} · SRN {data.meta.srn}
      </p>

      {data.aesItn && (
        <div style={{ ...box, borderColor: "#16a34a", background: "rgba(22,163,74,0.08)" }}>
          ✓ ITN already on this order: <strong>{data.aesItn}</strong> (status: {data.filingStatus || "—"})
        </div>
      )}

      {data.missing.length > 0 && (
        <div style={{ ...box, borderColor: "#ef4444", background: "rgba(239,68,68,0.06)" }}>
          <strong>{data.missing.length} field{data.missing.length > 1 ? "s" : ""} missing.</strong> ACE will also reject on these — fix what you can below, then hand off.
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {data.missing.map((m) => <li key={m.field}>{LABELS[m.field] || m.field} — {m.reason}</li>)}
          </ul>
        </div>
      )}

      {GROUPS.map(([title, codes]) => {
        const rows = codes.filter((c) => c in data.fields || c in missingByCode);
        if (!rows.length) return null;
        return (
          <div key={title} style={box}>
            <h3 style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-secondary)" }}>{title}</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {rows.map((code) => {
                  const miss = missingByCode[code];
                  const warns = warnByCode[code];
                  const editable = code in EDIT_MAP;
                  return (
                    <tr key={code} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", width: 190, color: miss ? "#ef4444" : "var(--text-secondary)" }}>
                        {LABELS[code] || code} <span style={{ color: "var(--text-muted)" }}>({code})</span>
                      </td>
                      <td style={{ padding: "6px 8px", color: "var(--text-primary)" }}>
                        {edit.code === code ? (
                          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                            <input autoFocus style={inputStyle} value={edit.val} onChange={(e) => setEdit({ code, val: e.target.value })} />
                            <button disabled={busy} onClick={() => saveField(code)} style={{ fontSize: 11, padding: "3px 8px", cursor: "pointer" }}>Save</button>
                            <button onClick={() => setEdit({ code: null, val: "" })} style={{ fontSize: 11, padding: "3px 6px", cursor: "pointer" }}>✕</button>
                          </span>
                        ) : (
                          <span>
                            {miss ? <em style={{ color: "#ef4444" }}>missing</em> : (data.fields[code] || <span style={{ color: "var(--text-muted)" }}>—</span>)}
                            {editable && (
                              <button
                                onClick={() => setEdit({ code, val: data.fields[code] || "" })}
                                style={{ marginLeft: 8, fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", padding: "1px 6px" }}
                              >edit</button>
                            )}
                            {warns && <span style={{ color: "#b45309", marginLeft: 8 }} title={warns.join("; ")}>⚠</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {data.warnings.length > 0 && (
        <div style={{ ...box, borderColor: "#f59e0b", background: "rgba(245,158,11,0.06)", fontSize: 13 }}>
          <strong>Check before submitting in ACE:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {data.warnings.map((w, i) => <li key={i}>{LABELS[w.field] || w.field} — {w.note}</li>)}
          </ul>
        </div>
      )}

      <div style={{ ...box, background: "var(--bg-elevated)" }}>
        <p style={{ margin: "0 0 12px", fontSize: 13 }}>
          <strong>Before you click:</strong> be signed into ACE AESDirect in this browser
          ({isTest ? "ace-test.cbp.gov — confirm the orange TRAINING banner" : "ace.cbp.gov"}).
          The button opens ACE with everything below pre-filled — review every screen there,
          pick the Filer ID, and click <strong>Submit Filing</strong>. The ITN posts back to this order automatically.
        </p>
        <button
          onClick={handOff}
          disabled={busy}
          style={{ background: data.missing.length ? "#64748b" : "#0369a1", color: "#fff", border: "none", borderRadius: 8, padding: "11px 26px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}
        >
          {data.missing.length ? "Hand off anyway →" : "Hand off to ACE AESDirect →"}
        </button>
        {msg && <span style={{ marginLeft: 14, fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}
