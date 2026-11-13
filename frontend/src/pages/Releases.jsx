import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-US", { timeZone: "America/New_York" }) : "";

// Paid orders waiting on their shipping-line release. Sallaum: request it here (replies on the
// voyage's RELEASES thread). ACL: requested by the PAYMENT FOR RELEASE email. When the line's
// release email comes in, the server forwards it to the customer and the order goes Completed.
export default function Releases() {
  const [rows, setRows]       = useState(null);
  const [error, setError]     = useState("");
  const [search, setSearch]   = useState("");
  const [sel, setSel]         = useState({});         // orderId -> true
  const [preview, setPreview] = useState(null);       // { voyage, ids, to, cc, subject, vins }
  const [busy, setBusy]       = useState("");
  const [msg, setMsg]         = useState("");
  const [scan, setScan]       = useState(null);

  const load = () => {
    setError("");
    fetch(`${API}/api/releases/pending`).then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setRows(d); })
      .catch(e => setError(e.message));
  };
  useEffect(() => { document.title = "Releases"; load(); }, []);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map();
    for (const r of rows || []) {
      if (q && !`${r.refNumber} ${r.customerName} ${r.vehicle} ${r.vin} ${r.voyage} ${r.booking}`.toLowerCase().includes(q)) continue;
      const k = `${r.line}|${r.voyage}`;
      if (!map.has(k)) map.set(k, { line: r.line, voyage: r.voyage, rows: [] });
      map.get(k).rows.push(r);
    }
    const rank = (l) => l === "SALLAUM" ? 0 : l === "ACL" ? 1 : 2;
    return [...map.values()].sort((a, b) => rank(a.line) - rank(b.line) || a.voyage.localeCompare(b.voyage));
  }, [rows, search]);

  const askPreview = async (g) => {
    const ids = g.rows.filter(r => sel[r._id]).map(r => r._id);
    if (!ids.length) return;
    setBusy(g.voyage); setMsg("");
    try {
      const r = await fetch(`${API}/api/releases/sallaum-request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voyage: g.voyage, orderIds: ids, dryRun: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setPreview({ ...d, voyage: g.voyage, ids });
    } catch (e) { setMsg("❌ " + e.message); }
    setBusy("");
  };

  const send = async () => {
    setBusy("send");
    try {
      const r = await fetch(`${API}/api/releases/sallaum-request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voyage: preview.voyage, orderIds: preview.ids }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMsg(`✅ Release request sent on "${preview.voyage} RELEASES" for ${d.vins.length} car${d.vins.length === 1 ? "" : "s"}`);
      setPreview(null); setSel({}); load();
    } catch (e) { setMsg("❌ " + e.message); }
    setBusy("");
  };

  const markSent = async (r) => {
    if (!window.confirm(`Mark #${r.refNumber}'s release as already sent to the customer? The order will be Completed.`)) return;
    await fetch(`${API}/api/releases/${r._id}/mark-sent`, { method: "POST" });
    load();
  };

  const runScan = async () => {
    setBusy("scan"); setScan(null);
    try {
      const r = await fetch(`${API}/api/releases/scan`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 3 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setScan(d); load();
    } catch (e) { setScan([{ result: "error: " + e.message }]); }
    setBusy("");
  };

  const th = { textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border)" };
  const td = { padding: "9px 10px", fontSize: 13, borderBottom: "1px solid var(--border)", verticalAlign: "top" };
  const btn = (bg) => ({ background: bg, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" });

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1300 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>Releases</h1>
        <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          {rows ? (rows.length ? `${rows.length} paid car${rows.length === 1 ? "" : "s"} waiting on a release` : "All caught up") : ""}
        </span>
      </div>
      <p style={{ margin: "0 0 16px", color: "var(--text-secondary)", fontSize: 13, maxWidth: 900 }}>
        Paid orders whose release hasn't gone to the customer yet. <strong>Sallaum:</strong> tick the cars and click
        Request releases. It replies on that voyage's RELEASES thread with "PLEASE RELEASE" and the last 6 of each VIN.
        {" "}<strong>ACL:</strong> the PAYMENT FOR RELEASE email is the request.
        When Sallaum's TELEX RELEASE or ACL's PRINT AT DESTINATION email arrives, the app forwards it to the
        customer's email on the order (checked every 15 minutes), and the order goes to <strong>Completed</strong>.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <input placeholder="Search order, customer, VIN, voyage…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ fontSize: 13, padding: "6px 10px", minWidth: 280 }} />
        <button onClick={runScan} disabled={busy === "scan"} style={btn("#2563eb")}>
          {busy === "scan" ? "Checking inbox…" : "Check inbox for releases now"}
        </button>
      </div>

      {msg && <div style={{ marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      {scan && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
          <strong>Inbox check (last 3 days):</strong>{" "}
          {scan.length ? "" : "no release emails found."}
          {scan.map((s, i) => (
            <div key={i} style={{ marginTop: 4 }}>
              {s.orderRef ? `#${s.orderRef}` : s.vin || ""} {s.line ? `(${s.line})` : ""} — {s.result}{s.to ? ` → ${s.to}` : ""}{s.completed ? " · Completed" : ""}
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div style={{ border: "2px solid #2563eb", borderRadius: 8, padding: 14, marginBottom: 16, fontSize: 13, background: "var(--bg-card, transparent)" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Send this release request?</div>
          <div><strong>To:</strong> {preview.to}{preview.cc ? <> &nbsp; <strong>Cc:</strong> {preview.cc}</> : null}</div>
          <div><strong>Subject:</strong> {preview.subject}</div>
          <pre style={{ margin: "8px 0", fontFamily: "inherit", whiteSpace: "pre-wrap" }}>{"PLEASE RELEASE\n\n" + preview.vins.join("\n")}</pre>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={send} disabled={busy === "send"} style={btn("#16a34a")}>{busy === "send" ? "Sending…" : "Send"}</button>
            <button onClick={() => setPreview(null)} style={btn("#6b7280")}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div style={{ color: "#dc2626" }}>{error}</div>}
      {!rows && !error && <div>Loading…</div>}

      {groups.map(g => {
        const key = `${g.line}|${g.voyage}`;
        const selectable = g.line === "SALLAUM" && g.voyage;
        const picked = g.rows.filter(r => sel[r._id]).length;
        return (
          <div key={key} style={{ border: "1px solid var(--border)", borderRadius: 8, marginBottom: 18, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "var(--bg-secondary, rgba(0,0,0,0.03))", flexWrap: "wrap" }}>
              <strong>{g.line || "No line"} · {g.voyage || "no voyage"}</strong>
              <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{g.rows.length} car{g.rows.length === 1 ? "" : "s"}</span>
              {selectable && (
                <button onClick={() => askPreview(g)} disabled={!picked || busy === g.voyage} style={{ ...btn("#2563eb"), opacity: picked ? 1 : 0.5 }}>
                  {busy === g.voyage ? "…" : `Request releases (${picked})`}
                </button>
              )}
              {g.line === "ACL" && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Requested with the ACL payment email</span>}
              {g.line !== "SALLAUM" && g.line !== "ACL" && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Container / other line: forward the release yourself, then mark it sent</span>}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                {selectable && <th style={{ ...th, width: 30 }}>
                  <input type="checkbox" checked={picked === g.rows.length}
                    onChange={e => setSel(s => { const n = { ...s }; g.rows.forEach(r => { n[r._id] = e.target.checked; }); return n; })} />
                </th>}
                <th style={th}>Order</th><th style={th}>Customer</th><th style={th}>Vehicle</th><th style={th}>Last 6</th>
                <th style={th}>Invoice</th><th style={th}>Requested</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {g.rows.map(r => (
                  <tr key={r._id}>
                    {selectable && <td style={td}><input type="checkbox" checked={!!sel[r._id]} onChange={e => setSel(s => ({ ...s, [r._id]: e.target.checked }))} /></td>}
                    <td style={td}><Link to={`/orders/${r._id}`}>#{r.refNumber}</Link></td>
                    <td style={td}>{r.customerName}<div style={{ fontSize: 12, color: r.customerEmail ? "var(--text-muted)" : "#dc2626" }}>{r.customerEmail || "no email: the release can't be forwarded"}</div></td>
                    <td style={td}>{r.vehicle}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.last6}</td>
                    <td style={td}>{r.invoiceNumber}{r.paidAt ? <div style={{ fontSize: 12, color: "#16a34a" }}>paid {fmtDate(r.paidAt)}</div> : null}</td>
                    <td style={td}>{r.requestedAt ? fmtDate(r.requestedAt) : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                    <td style={td}><button onClick={() => markSent(r)} style={{ ...btn("#6b7280"), padding: "4px 10px", fontSize: 12 }}>Already sent</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
