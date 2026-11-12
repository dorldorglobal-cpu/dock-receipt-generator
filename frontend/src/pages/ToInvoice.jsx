import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const fmt$ = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS = {
  none:  { label: "Not invoiced", bg: "rgba(239,68,68,0.12)",  color: "#dc2626" },
  draft: { label: "Draft",        bg: "rgba(245,158,11,0.14)", color: "#d97706" },
  sent:  { label: "Sent",         bg: "rgba(37,99,235,0.12)",  color: "#2563eb" },
  paid:  { label: "Paid",         bg: "rgba(22,163,74,0.12)",  color: "#16a34a" },
};
const done = (r) => r.invoiceStatus === "sent" || r.invoiceStatus === "paid";

// The cars still to invoice in a group, starting from `startId` — the order page walks this list
export function startInvoiceQueue(group, startId) {
  const open = group.rows.filter(r => !done(r)).map(r => String(r.orderId));
  const i = Math.max(0, open.indexOf(String(startId)));
  const ids = [...open.slice(i), ...open.slice(0, i)];
  try { sessionStorage.setItem("toInvoiceQueue", JSON.stringify({ label: group.label, ids })); } catch {}
  return ids;
}

export default function ToInvoice() {
  const navigate = useNavigate();
  const [days, setDays]       = useState(() => { try { return Number(localStorage.getItem("toInvoiceDays")) || 60; } catch { return 60; } });
  const [openOnly, setOpenOnly] = useState(true);
  const [data, setData]       = useState(null);
  const [error, setError]     = useState("");
  const [search, setSearch]   = useState("");

  useEffect(() => {
    document.title = "To Invoice";
    try { localStorage.setItem("toInvoiceDays", String(days)); } catch {}
    setData(null); setError("");
    fetch(`${API}/api/invoices/to-invoice?days=${days}`)
      .then(r => r.json()).then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(e => setError(e.message));
  }, [days]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.groups || []).map(g => ({
      ...g,
      shown: g.rows.filter(r => (!openOnly || !done(r)) &&
        (!q || `${r.refNumber} ${r.customerName} ${r.vehicle} ${r.vin} ${r.booking}`.toLowerCase().includes(q))),
    })).filter(g => g.shown.length);
  }, [data, openOnly, search]);

  const totalOpen = (data?.groups || []).reduce((s, g) => s + g.rows.filter(r => !done(r)).length, 0);

  const openInvoice = (g, r) => {
    startInvoiceQueue(g, r.orderId);
    navigate(`/orders/${r.orderId}?invoice=1&returnTo=to-invoice`);
  };

  const th = { textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border)" };
  const td = { padding: "9px 10px", fontSize: 13, borderBottom: "1px solid var(--border)", verticalAlign: "top" };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1300 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>To Invoice</h1>
        <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          {data ? (totalOpen ? `${totalOpen} car${totalOpen === 1 ? "" : "s"} still to invoice` : "All caught up") : ""}
        </span>
      </div>
      <p style={{ margin: "0 0 16px", color: "var(--text-secondary)", fontSize: 13 }}>
        Every car on a Sallaum bill (Expenses import) or an ACL rated BL (BL Separator), grouped by the bill it came in on.
        Click <strong>Invoice</strong> to open the order at its sell / cost lines — check them, then Generate Invoice.
        After you send it, the next car in that bill opens.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} />
          Not sent yet only
        </label>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ fontSize: 13, padding: "5px 8px" }}>
          <option value={30}>Bills from the last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={120}>Last 120 days</option>
          <option value={365}>Last year</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order, customer, VIN, booking…"
          style={{ fontSize: 13, padding: "6px 10px", minWidth: 260, flex: "0 1 320px" }} />
      </div>

      {error && <div style={{ color: "#dc2626", marginBottom: 12 }}>❌ {error}</div>}
      {!data && !error && <div style={{ color: "var(--text-secondary)" }}>Loading…</div>}
      {data && !groups.length && (
        <div style={{ padding: 28, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12, color: "var(--text-secondary)" }}>
          {openOnly ? "✅ Every car on these bills has a sent invoice. Untick “Not sent yet only” to see them." : "No carrier bills in this period."}
        </div>
      )}

      {groups.map(g => {
        const total = g.rows.length, sent = g.rows.filter(done).length;
        const next = g.rows.find(r => !done(r));
        return (
          <section key={g.key} style={{ marginBottom: 22, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--bg-panel)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-base)" }}>
              <strong style={{ fontSize: 15 }}>{g.line === "SALLAUM" ? "🟦" : "🟥"} {g.label}</strong>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{new Date(g.date).toLocaleDateString("en-US")}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: sent === total ? "#16a34a" : "var(--text-primary)" }}>
                {sent} of {total} sent
              </span>
              <div style={{ flex: 1, minWidth: 80, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(sent / total) * 100}%`, height: "100%", background: "#16a34a" }} />
              </div>
              {next && (
                <button onClick={() => openInvoice(g, next)}
                  style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                  Invoice next → #{next.refNumber}
                </button>
              )}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Order</th><th style={th}>Customer</th><th style={th}>Vehicle</th><th style={th}>Booking</th>
                    <th style={{ ...th, textAlign: "right" }}>Carrier cost</th><th style={th}>Breakdown</th><th style={th}>Invoice</th><th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {g.shown.map(r => {
                    const s = STATUS[r.invoiceStatus] || STATUS.none;
                    return (
                      <tr key={r.orderId}>
                        <td style={td}><Link to={`/orders/${r.orderId}`} style={{ fontWeight: 700 }}>#{r.refNumber}</Link></td>
                        <td style={td}>{r.customerName}</td>
                        <td style={td}>
                          {r.vehicle || "—"}
                          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{r.vin}</div>
                        </td>
                        <td style={{ ...td, fontSize: 12, fontFamily: "monospace" }}>{r.booking || "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmt$(r.carrierCost)}</td>
                        <td style={{ ...td, fontSize: 12, color: "var(--text-secondary)" }}>
                          {r.breakdown.map(b => `${b.label} ${fmt$(b.amount)}`).join(" · ") || "—"}
                          {r.flags.length > 0 && (
                            <div title={r.flags.join("\n")} style={{ color: "#d97706", fontWeight: 600, marginTop: 3, cursor: "help" }}>
                              ⚠ {r.flags.length} open issue{r.flags.length === 1 ? "" : "s"} — {String(r.flags[0]).slice(0, 70)}{String(r.flags[0]).length > 70 ? "…" : ""}
                            </div>
                          )}
                        </td>
                        <td style={td}>
                          <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: s.bg, color: s.color }}>
                            {s.label}
                          </span>
                          {r.invoice && (
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                              {r.invoice.number} · {fmt$(r.invoice.total)}
                              {r.invoice.sentAt ? ` · ${new Date(r.invoice.sentAt).toLocaleDateString("en-US")}` : ""}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {done(r) ? (
                            <Link to={`/orders/${r.orderId}`} style={{ fontSize: 12 }}>View</Link>
                          ) : (
                            <button onClick={() => openInvoice(g, r)}
                              style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                              {r.invoiceStatus === "draft" ? "Finish & send" : "Invoice"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
