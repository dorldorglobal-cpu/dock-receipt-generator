import { useEffect, useState } from "react";
import { API } from "../lib/auth";

const inputStyle = { width:"100%",padding:"8px 10px",background:"var(--bg-elevated)",border:"1px solid var(--border)",borderRadius:6,color:"var(--text-primary)",fontSize:13,boxSizing:"border-box",marginTop:4 };
const labelStyle = { display:"block",fontSize:12,color:"var(--text-secondary)",marginBottom:2 };

function Section({ title, sub, children }) {
  return (
    <div style={{ background:"var(--bg-panel)",border:"1px solid var(--border)",borderRadius:10,padding:20,marginBottom:16 }}>
      <h3 style={{ margin:"0 0 2px",fontSize:14,color:"var(--text-primary)" }}>{title}</h3>
      {sub && <p style={{ margin:"0 0 14px",fontSize:12,color:"var(--text-muted)" }}>{sub}</p>}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>{children}</div>
    </div>
  );
}

function Field({ label, k, form, set, full, placeholder, type }) {
  return (
    <label style={{ ...labelStyle, gridColumn: full ? "1/-1" : undefined }}>
      {label}
      <input
        style={inputStyle}
        type={type || "text"}
        placeholder={placeholder || ""}
        value={form[k] ?? ""}
        onChange={(e) => set(k, e.target.value)}
      />
    </label>
  );
}

function FAField({ label, k, fa, setFa, full, placeholder }) {
  return (
    <label style={{ ...labelStyle, gridColumn: full ? "1/-1" : undefined }}>
      {label}
      <input
        style={inputStyle}
        placeholder={placeholder || ""}
        value={fa[k] ?? ""}
        onChange={(e) => setFa(k, e.target.value)}
      />
    </label>
  );
}

export default function AesSettings() {
  const [form, setForm] = useState(null);
  const [tables, setTables] = useState(null);
  const [env, setEnv] = useState("test");
  const [envLocked, setEnvLocked] = useState(false);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/aes-config`).then((r) => r.json()).then((d) => {
      setForm(d.config);
      setEnv(d.effectiveEnv);
      setEnvLocked(d.envLockedByServer);
    }).catch(() => setMsg("❌ Failed to load config"));
    fetch(`${API}/api/aes-config/code-tables`).then((r) => r.json()).then(setTables).catch(() => {});
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFa = (k, v) => setForm((f) => ({ ...f, forwardingAgent: { ...(f.forwardingAgent || {}), [k]: v } }));

  const save = async () => {
    setSaving(true);
    setMsg("Saving…");
    try {
      const res = await fetch(`${API}/api/aes-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "❌ Save failed"); return; }
      setForm(d.config);
      setEnv(d.effectiveEnv);
      setMsg("✅ Saved");
    } catch {
      setMsg("❌ Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!form) return <div style={{ padding:24 }}>{msg || "Loading…"}</div>;

  const fa = form.forwardingAgent || {};

  return (
    <div style={{ padding:24,maxWidth:900 }}>
      <h1 style={{ fontSize:20,marginBottom:4 }}>AES Filing Settings</h1>
      <p style={{ color:"var(--text-muted)",fontSize:13,marginTop:0 }}>
        Company constants used to build every AES / EEI filing. Per-shipment data comes from the order.
      </p>

      <div style={{
        background: env === "prod" ? "rgba(239,68,68,0.12)" : "rgba(251,191,36,0.12)",
        border: `1px solid ${env === "prod" ? "#ef4444" : "#fbbf24"}`,
        borderRadius:8,padding:"10px 14px",fontSize:13,margin:"12px 0 20px",
      }}>
        Environment: <strong>{env === "prod" ? "PRODUCTION — live filings" : "TEST (trade-test.cbp.dhs.gov)"}</strong>
        {envLocked && <span style={{ color:"var(--text-muted)" }}> · locked by server AES_ENV</span>}
      </div>

      {msg && <div style={{ marginBottom:14,fontSize:13 }}>{msg}</div>}

      <Section title="Forwarding Agent — DDG's own identity" sub="Confirmed from a real accepted filing: DDG files AS THE AGENT, not the USPPI. Sent on every filing.">
        <FAField label="Name" k="name" fa={fa} setFa={setFa} full />
        <FAField label="ID type" k="idType" fa={fa} setFa={setFa} placeholder="E" />
        <FAField label="Party ID (DDG's EIN)" k="partyId" fa={fa} setFa={setFa} placeholder="not on the EEI printout — enter it here" />
        <FAField label="Contact name" k="contact" fa={fa} setFa={setFa} />
        <FAField label="Phone" k="phone" fa={fa} setFa={setFa} />
        <FAField label="Address line 1" k="address1" fa={fa} setFa={setFa} full />
        <FAField label="Address line 2" k="address2" fa={fa} setFa={setFa} full />
        <FAField label="City" k="city" fa={fa} setFa={setFa} />
        <FAField label="State" k="state" fa={fa} setFa={setFa} />
        <FAField label="Country" k="country" fa={fa} setFa={setFa} />
        <FAField label="Postal code" k="postal" fa={fa} setFa={setFa} />
      </Section>

      <Section title="USPPI fallback" sub="The USPPI (exporter of record) is the vehicle's seller — it usually differs per order and is entered on the filing screen itself. These fields are only used when an order has no exporterName of its own (e.g. a vehicle DDG owns outright).">
        <Field label="Legal name" k="usppiName" form={form} set={set} full />
        <Field label="EIN (digits only)" k="usppiEin" form={form} set={set} placeholder="e.g. 37053310000" />
        <Field label="ID type" k="usppiIdType" form={form} set={set} placeholder="E" />
        <Field label="Address line 1" k="usppiAddress1" form={form} set={set} full />
        <Field label="Address line 2" k="usppiAddress2" form={form} set={set} full />
        <Field label="City" k="usppiCity" form={form} set={set} />
        <Field label="State" k="usppiState" form={form} set={set} placeholder="NJ" />
        <Field label="ZIP" k="usppiZip" form={form} set={set} />
        <Field label="Contact first name" k="usppiContactFirst" form={form} set={set} />
        <Field label="Contact last name" k="usppiContactLast" form={form} set={set} />
        <Field label="Contact phone" k="usppiPhone" form={form} set={set} />
      </Section>

      <Section title="Filer & Filing Defaults">
        <Field label="CBP Filer ID (FID)" k="filerId" form={form} set={set} placeholder="≤ 11 chars" />
        <Field label="SRN prefix" k="srnPrefix" form={form} set={set} placeholder="blank = bare order number (confirmed convention)" />
        <Field label="AES response email" k="responseEmail" form={form} set={set} full />
        <Field label="Filing action" k="defaultFilingAction" form={form} set={set} placeholder="A" />
        <Field label="Filing option" k="defaultFilingOption" form={form} set={set} placeholder="e.g. 2 — PREDEPARTURE" />
        <Field label="AEI filing type" k="defaultFilingType" form={form} set={set} placeholder="from CBP profile" />
        <Field label="In-bond code" k="defaultInBondCode" form={form} set={set} placeholder="70" />
        <Field label="Export information code" k="defaultExportInfoCode" form={form} set={set} placeholder="OS" />
        <Field label="License code" k="defaultLicenseCode" form={form} set={set} placeholder="C33" />
        <Field label="License number" k="defaultLicenseNumber" form={form} set={set} placeholder="NLR" />
        <Field label="ECCN (blank = EAR99)" k="defaultEccn" form={form} set={set} />
        <Field label="Ultimate consignee type" k="ultConsigneeType" form={form} set={set} placeholder="O (Other/Unknown) — confirmed default" />
        <Field label="Origin indicator default" k="defaultOriginIndicator" form={form} set={set} placeholder="D (Domestic) — confirmed default for used vehicles" />
        <Field label="State of origin (last resort)" k="defaultStateOfOrigin" form={form} set={set} placeholder="NJ — only used when an order has no exporter/pickup state" />
        <Field label="Related party (Y/N)" k="relatedParty" form={form} set={set} placeholder="N" />
        <Field label="Hazmat (Y/N)" k="hazmat" form={form} set={set} placeholder="N" />
        <Field label="Routed export (Y/N)" k="routedExport" form={form} set={set} placeholder="N" />
      </Section>

      <Section title="Schedule B — used vehicles" sub="Default 10-digit code, used when an order doesn't override it. Varies by engine/body type — verify per shipment.">
        <Field label="Default Schedule B" k="defaultScheduleB" form={form} set={set} full placeholder="e.g. 8703600045" />
      </Section>

      {!envLocked && (
        <Section title="Environment">
          <label style={labelStyle}>
            AES environment
            <select style={inputStyle} value={form.aesEnv} onChange={(e) => set("aesEnv", e.target.value)}>
              <option value="test">test — trade-test.cbp.dhs.gov</option>
              <option value="prod">prod — LIVE filings (requires CBP certification)</option>
            </select>
          </label>
        </Section>
      )}

      <div style={{ display:"flex",gap:12,alignItems:"center",margin:"4px 0 32px" }}>
        <button
          onClick={save}
          disabled={saving}
          style={{ background:"#3b82f6",color:"#fff",border:"none",borderRadius:7,padding:"10px 26px",fontSize:13,fontWeight:600,cursor:saving?"not-allowed":"pointer",opacity:saving?0.6:1 }}
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
        <span style={{ fontSize:13 }}>{msg}</span>
      </div>

      {tables && (
        <div style={{ background:"var(--bg-panel)",border:"1px solid var(--border)",borderRadius:10,padding:20,marginBottom:40 }}>
          <h3 style={{ margin:"0 0 4px",fontSize:14 }}>CBP Code Tables (read-only)</h3>
          <p style={{ margin:"0 0 14px",fontSize:12,color:"var(--text-muted)" }}>
            From <code>backend/utils/aesCodes.js</code>. Blank entries show up as missing fields on the
            filing screen — fill them in the source file from the current CBP Schedule D / K / C.
          </p>
          {[
            ["Schedule D — U.S. port of export", tables.scheduleD],
            ["Schedule K — foreign port of unlading", tables.scheduleK],
            ["Country (ISO alpha-2)", tables.countryIso],
            ["SCAC by port (preferred — most common carrier per destination)", tables.scacByPod],
            ["SCAC by shipping line (fallback)", tables.scac],
          ].map(([title, obj]) => (
            <div key={title} style={{ marginBottom:14 }}>
              <div style={{ fontSize:12,fontWeight:700,color:"var(--text-secondary)",marginBottom:4 }}>{title}</div>
              <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                {Object.entries(obj || {}).map(([name, code]) => (
                  <span key={name} style={{
                    fontSize:11,padding:"2px 7px",borderRadius:5,
                    background: code ? "var(--bg-elevated)" : "rgba(239,68,68,0.15)",
                    border:`1px solid ${code ? "var(--border)" : "#ef4444"}`,
                    color: code ? "var(--text-primary)" : "#ef4444",
                  }}>
                    {name}: {code || "—"}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
