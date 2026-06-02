import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "${import.meta.env.VITE_API_URL || "http://localhost:4000"}";

// ── Format helpers ─────────────────────────────────────────────────────────────
const f$ = (n) => n == null ? "—" :
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fD = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const fPct = (n) => n == null ? "—" : Number(n).toFixed(1) + "%";
const ageBucket = (age) => age <= 30 ? "0-30" : age <= 60 ? "31-60" : age <= 90 ? "61-90" : "90+";

const BCLR = { "0-30": "#34d399", "31-60": "#fbbf24", "61-90": "#fb923c", "90+": "#f87171" };

// ── Sidebar navigation ────────────────────────────────────────────────────────
const NAV = [
  { g: "Income", icon: "📈", items: [
    { id: "income-by-customer",    label: "By Customer" },
    { id: "income-by-destination", label: "By Destination" },
    { id: "income-by-route",       label: "By Route" },
  ]},
  { g: "Receivables", icon: "💰", items: [
    { id: "aged-receivables", label: "Aged Receivables" },
  ]},
  { g: "Expenses", icon: "🧾", items: [
    { id: "expenses-by-category", label: "By Category" },
    { id: "purchases-by-vendor",  label: "By Vendor" },
  ]},
  { g: "Payables", icon: "📋", items: [
    { id: "aged-payables", label: "Aged Payables" },
  ]},
  { g: "Financial", icon: "📊", items: [
    { id: "pl-accrual", label: "P&L — Accrual" },
    { id: "pl-cash",    label: "P&L — Cash Basis" },
    { id: "cash-flow",  label: "Cash Flow" },
  ]},
];

const TITLES = {
  "income-by-customer":    "Income by Customer",
  "income-by-destination": "Income by Destination",
  "income-by-route":       "Income by Route",
  "aged-receivables":      "Aged Receivables",
  "expenses-by-category":  "Expenses by Category",
  "purchases-by-vendor":   "Purchases by Vendor",
  "aged-payables":         "Aged Payables",
  "pl-accrual":            "Profit & Loss — Accrual Basis",
  "pl-cash":               "Profit & Loss — Cash Basis",
  "cash-flow":             "Cash Flow",
};

const HAS_DATES = new Set([
  "income-by-customer", "income-by-destination", "income-by-route",
  "expenses-by-category", "purchases-by-vendor", "pl-accrual", "pl-cash",
]);

const HAS_SEARCH = new Set([
  "income-by-customer", "income-by-destination", "income-by-route",
  "aged-receivables", "aged-payables", "expenses-by-category", "purchases-by-vendor",
]);

const SEARCH_LABEL = {
  "income-by-customer":    "Filter by customer…",
  "income-by-destination": "Filter by destination…",
  "income-by-route":       "Filter by route or port…",
  "aged-receivables":      "Filter by customer, ref # or vehicle…",
  "aged-payables":         "Filter by vendor…",
  "expenses-by-category":  "Filter by category…",
  "purchases-by-vendor":   "Filter by vendor…",
};

// Which reports support detailed drill-down and what data type each uses
const DETAIL_TYPE = {
  "income-by-customer":    "orders",
  "income-by-destination": "orders",
  "income-by-route":       "orders",
  "aged-receivables":      "orders",
  "expenses-by-category":  "expenses",
  "purchases-by-vendor":   "expenses",
  "aged-payables":         "expenses",
  "pl-accrual":            "pl",
  "pl-cash":               "pl",
};

// Filter helper — pass an array of string-getter functions to search across multiple fields
const applyFilter = (rows, filter, ...getters) => {
  if (!filter) return rows;
  const f = filter.toLowerCase();
  return rows.filter(r => getters.some(g => (g(r) || "").toLowerCase().includes(f)));
};

// ── Shared components ─────────────────────────────────────────────────────────

function Chips({ items }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
      {items.map((c, i) => (
        <div key={i} style={{
          background: "var(--bg-panel)", borderRadius: 10, padding: "14px 18px",
          border: `1px solid ${c.border || "var(--border)"}`, flex: 1, minWidth: 130,
        }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
            {c.label}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: c.clr || "var(--text-primary)" }}>{c.val}</div>
          {c.sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function AgingStrip({ buckets, total }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
      {Object.entries(buckets).map(([k, v]) => (
        <div key={k} style={{
          background: "var(--bg-panel)", borderRadius: 10, padding: "14px 16px",
          border: `1px solid ${BCLR[k]}55`,
        }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>
            {k} Days
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: BCLR[k] }}>{f$(v)}</div>
          {total > 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              {((v / total) * 100).toFixed(0)}%
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Simple table: headers = string[], rows = array-of-arrays (can contain JSX for color), rights = col indexes that are right-aligned
function RT({ headers, rows, footer, rights = [] }) {
  if (!rows?.length) return (
    <div style={{ color: "var(--text-muted)", padding: 32, textAlign: "center" }}>
      No data for this period.
    </div>
  );
  const s = (i) => rights.includes(i) ? { textAlign: "right" } : {};
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="orders-table" style={{ width: "100%" }}>
        <thead>
          <tr>{headers.map((h, i) => <th key={i} style={s(i)}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} style={s(ci)}>{c}</td>)}</tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border)" }}>
              {footer.map((c, i) => <td key={i} style={{ ...s(i), fontWeight: 700 }}>{c}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function ExBar({ onCSV, onPDF }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      <button onClick={onCSV} style={{ fontSize: 12, padding: "5px 14px", background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
        ⬇ Export CSV
      </button>
      <button onClick={onPDF} style={{ fontSize: 12, padding: "5px 14px", background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
        📄 Export PDF
      </button>
    </div>
  );
}

// ── Export helpers ────────────────────────────────────────────────────────────

function dlCSV(headers, rows, name) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(esc), ...rows.map((r) => r.map(esc))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines], { type: "text/csv" }));
  a.download = name + ".csv";
  a.click();
}

async function dlPDF(title, subtitle, headers, rows, footer) {
  const plain = (v) =>
    v == null ? "" :
    typeof v === "object" && v?.props ? String(v.props.children ?? "") :
    String(v);
  const res = await fetch(`${API}/api/reports/export-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title, subtitle,
      columns:   headers.map((h) => ({ label: h })),
      rows:      rows.map((r) => r.map(plain)),
      totalsRow: footer?.map(plain),
    }),
  });
  if (!res.ok) { alert("PDF generation failed"); return; }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = title.replace(/\s+/g, "-") + ".pdf";
  a.click();
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Quick (summary) report renderers ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function IncomeByCustomer({ d, sub, filter }) {
  const rows = applyFilter(d.rows || [], filter, r => r.customer);
  const totals = rows.reduce((t, r) => ({
    orders: t.orders + r.orders, billed: t.billed + r.billed,
    collected: t.collected + r.collected, outstanding: t.outstanding + r.outstanding,
  }), { orders: 0, billed: 0, collected: 0, outstanding: 0 });
  const H = ["Customer", "Orders", "Total Billed", "Collected", "Outstanding"];
  const R = rows.map((r) => [
    r.customer, r.orders,
    <span style={{ color: "var(--accent)" }}>{f$(r.billed)}</span>,
    <span style={{ color: "#34d399" }}>{f$(r.collected)}</span>,
    <span style={{ color: r.outstanding > 0 ? "#f87171" : "var(--text-muted)" }}>{f$(r.outstanding)}</span>,
  ]);
  const F    = ["TOTALS", totals.orders, f$(totals.billed), f$(totals.collected), f$(totals.outstanding)];
  const Rcsv = rows.map((r) => [r.customer, r.orders, f$(r.billed), f$(r.collected), f$(r.outstanding)]);
  return <>
    <Chips items={[
      { label: "Customers",    val: rows.length },
      { label: "Total Billed", val: f$(totals.billed),      clr: "var(--accent)" },
      { label: "Collected",    val: f$(totals.collected),   clr: "#34d399" },
      { label: "Outstanding",  val: f$(totals.outstanding), clr: totals.outstanding > 0 ? "#f87171" : "#34d399" },
    ]} />
    <ExBar onCSV={() => dlCSV(H, Rcsv, "Income-by-Customer")} onPDF={() => dlPDF("Income by Customer", sub, H, Rcsv, F)} />
    <RT headers={H} rows={R} footer={F} rights={[1, 2, 3, 4]} />
  </>;
}

function IncomeByDestination({ d, sub, filter }) {
  const rows   = applyFilter(d.rows || [], filter, r => r.destination);
  const totals = { orders: rows.reduce((s,r)=>s+r.orders,0), billed: rows.reduce((s,r)=>s+r.billed,0) };
  const H = ["Destination", "Orders", "Completed", "Total Billed"];
  const R = rows.map((r) => [
    r.destination, r.orders, r.completed,
    <span style={{ color: "var(--accent)" }}>{f$(r.billed)}</span>,
  ]);
  const F    = ["TOTALS", totals.orders, "", f$(totals.billed)];
  const Rcsv = rows.map((r) => [r.destination, r.orders, r.completed, f$(r.billed)]);
  return <>
    <Chips items={[
      { label: "Destinations", val: rows.length },
      { label: "Total Orders", val: totals.orders },
      { label: "Total Billed", val: f$(totals.billed), clr: "var(--accent)" },
    ]} />
    <ExBar onCSV={() => dlCSV(H, Rcsv, "Income-by-Destination")} onPDF={() => dlPDF("Income by Destination", sub, H, Rcsv, F)} />
    <RT headers={H} rows={R} footer={F} rights={[1, 2, 3]} />
  </>;
}

function IncomeByRoute({ d, sub, filter }) {
  const rows   = applyFilter(d.rows || [], filter, r => r.route, r => r.pol, r => r.pod);
  const totals = { orders: rows.reduce((s,r)=>s+r.orders,0), billed: rows.reduce((s,r)=>s+r.billed,0) };
  const H = ["Route", "Origin (POL)", "Destination (POD)", "Orders", "Total Billed"];
  const R = rows.map((r) => [
    r.route, r.pol, r.pod, r.orders,
    <span style={{ color: "var(--accent)" }}>{f$(r.billed)}</span>,
  ]);
  const F    = ["TOTALS", "", "", totals.orders, f$(totals.billed)];
  const Rcsv = rows.map((r) => [r.route, r.pol, r.pod, r.orders, f$(r.billed)]);
  return <>
    <Chips items={[
      { label: "Routes",       val: rows.length },
      { label: "Total Orders", val: totals.orders },
      { label: "Total Billed", val: f$(totals.billed), clr: "var(--accent)" },
    ]} />
    <ExBar onCSV={() => dlCSV(H, Rcsv, "Income-by-Route")} onPDF={() => dlPDF("Income by Route", sub, H, Rcsv, F)} />
    <RT headers={H} rows={R} footer={F} rights={[3, 4]} />
  </>;
}

function AgedReceivables({ d, sub, filter }) {
  const rows    = applyFilter(d.rows || [], filter, r => r.customer, r => r.refNumber, r => r.vehicle);
  const total   = rows.reduce((s, r) => s + r.amount, 0);
  const buckets = rows.reduce((b, r) => ({ ...b, [r.bucket]: (b[r.bucket] || 0) + r.amount }), { "0-30":0,"31-60":0,"61-90":0,"90+":0 });
  const H = ["Customer", "Ref #", "Vehicle", "Status", "Amount", "Days", "Bucket"];
  const R = rows.map((r) => [
    r.customer,
    <span style={{ color: "var(--accent)", fontWeight: 600 }}>{r.refNumber}</span>,
    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.vehicle}</span>,
    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.status}</span>,
    <span style={{ fontWeight: 600 }}>{f$(r.amount)}</span>,
    <span style={{ color: BCLR[r.bucket] || "#9ca3af" }}>{r.age}d</span>,
    <span style={{ color: BCLR[r.bucket], fontWeight: 700 }}>{r.bucket}</span>,
  ]);
  const F    = ["", "", "", "TOTAL", f$(total), "", ""];
  const Rcsv = rows.map((r) => [r.customer, r.refNumber, r.vehicle, r.status, f$(r.amount), r.age + "d", r.bucket]);
  return <>
    <AgingStrip buckets={buckets} total={total} />
    <Chips items={[
      { label: "Outstanding",    val: f$(total),    clr: "#f87171" },
      { label: "Open Orders",    val: rows.length },
    ]} />
    <ExBar onCSV={() => dlCSV(H, Rcsv, "Aged-Receivables")} onPDF={() => dlPDF("Aged Receivables", sub, H, Rcsv, F)} />
    <RT headers={H} rows={R} footer={F} rights={[4, 5]} />
  </>;
}

function AgedPayables({ d, sub, filter }) {
  const rows    = applyFilter(d.rows || [], filter, r => r.vendor, r => r.description);
  const total   = rows.reduce((s, r) => s + r.amount, 0);
  const buckets = rows.reduce((b, r) => ({ ...b, [r.bucket]: (b[r.bucket] || 0) + r.amount }), { "0-30":0,"31-60":0,"61-90":0,"90+":0 });
  const H = ["Vendor", "Description", "Category", "Invoice #", "Amount", "Date", "Days", "Bucket"];
  const R = rows.map((r) => [
    <span style={{ fontWeight: 600 }}>{r.vendor}</span>,
    <span style={{ fontSize: 12 }}>{r.description}</span>,
    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.category}</span>,
    <span style={{ fontFamily: "monospace", fontSize: 11 }}>{r.invoiceNumber || "—"}</span>,
    <span style={{ color: "#f87171", fontWeight: 600 }}>{f$(r.amount)}</span>,
    fD(r.date),
    <span style={{ color: BCLR[r.bucket] || "#9ca3af" }}>{r.age}d</span>,
    <span style={{ color: BCLR[r.bucket], fontWeight: 700 }}>{r.bucket}</span>,
  ]);
  const F    = ["", "", "", "", f$(total), "", "", ""];
  const Rcsv = rows.map((r) => [r.vendor, r.description, r.category, r.invoiceNumber || "—", f$(r.amount), fD(r.date), r.age + "d", r.bucket]);
  return <>
    <AgingStrip buckets={buckets} total={total} />
    <Chips items={[
      { label: "Total Unpaid", val: f$(total), clr: "#f87171" },
      { label: "Unpaid Bills", val: rows.length },
    ]} />
    <ExBar onCSV={() => dlCSV(H, Rcsv, "Aged-Payables")} onPDF={() => dlPDF("Aged Payables", sub, H, Rcsv, F)} />
    <RT headers={H} rows={R} footer={F} rights={[4, 6]} />
  </>;
}

function ExpensesByCategory({ d, sub, filter }) {
  const rows  = applyFilter(d.rows || [], filter, r => r.category);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const H = ["Category", "Bills", "Total", "Paid", "Unpaid", "% of Total"];
  const R = rows.map((r) => [
    r.category, r.bills,
    f$(r.total),
    <span style={{ color: "#34d399" }}>{f$(r.paid)}</span>,
    <span style={{ color: r.unpaid > 0 ? "#f87171" : "var(--text-muted)" }}>{f$(r.unpaid)}</span>,
    <span style={{ fontSize: 12 }}>{r.pct}%</span>,
  ]);
  const F    = ["TOTALS", rows.reduce((s, r) => s + r.bills, 0), f$(total), "", "", "100%"];
  const Rcsv = rows.map((r) => [r.category, r.bills, f$(r.total), f$(r.paid), f$(r.unpaid), r.pct + "%"]);
  return <>
    <Chips items={[
      { label: "Categories",    val: rows.length },
      { label: "Total Spend",   val: f$(total), clr: "#f87171" },
      { label: "Paid",          val: f$(rows.reduce((s, r) => s + r.paid,   0)), clr: "#34d399" },
      { label: "Unpaid",        val: f$(rows.reduce((s, r) => s + r.unpaid, 0)), clr: rows.some(r => r.unpaid > 0) ? "#f87171" : "#34d399" },
    ]} />
    <ExBar onCSV={() => dlCSV(H, Rcsv, "Expenses-by-Category")} onPDF={() => dlPDF("Expenses by Category", sub, H, Rcsv, F)} />
    <RT headers={H} rows={R} footer={F} rights={[1, 2, 3, 4, 5]} />
  </>;
}

function PurchasesByVendor({ d, sub, filter }) {
  const rows   = applyFilter(d.rows || [], filter, r => r.vendor, r => r.category);
  const totals = rows.reduce((t, r) => ({
    bills: t.bills + r.bills, total: t.total + r.total,
    paid: t.paid + r.paid,   unpaid: t.unpaid + r.unpaid,
  }), { bills: 0, total: 0, paid: 0, unpaid: 0 });
  const H = ["Vendor", "Category", "Bills", "Total", "Paid", "Unpaid"];
  const R = rows.map((r) => [
    r.vendor, r.category, r.bills,
    f$(r.total),
    <span style={{ color: "#34d399" }}>{f$(r.paid)}</span>,
    <span style={{ color: r.unpaid > 0 ? "#f87171" : "var(--text-muted)" }}>{f$(r.unpaid)}</span>,
  ]);
  const F    = ["TOTALS", "", totals.bills, f$(totals.total), f$(totals.paid), f$(totals.unpaid)];
  const Rcsv = rows.map((r) => [r.vendor, r.category, r.bills, f$(r.total), f$(r.paid), f$(r.unpaid)]);
  return <>
    <Chips items={[
      { label: "Vendors",     val: rows.length },
      { label: "Total Spend", val: f$(totals.total),  clr: "#f87171" },
      { label: "Paid",        val: f$(totals.paid),   clr: "#34d399" },
      { label: "Unpaid",      val: f$(totals.unpaid), clr: totals.unpaid > 0 ? "#f87171" : "#34d399" },
    ]} />
    <ExBar onCSV={() => dlCSV(H, Rcsv, "Purchases-by-Vendor")} onPDF={() => dlPDF("Purchases by Vendor", sub, H, Rcsv, F)} />
    <RT headers={H} rows={R} footer={F} rights={[2, 3, 4, 5]} />
  </>;
}

function ProfitLoss({ d, sub }) {
  const {
    totalRevenue = 0, totalExpenses = 0, netProfit = 0, margin = 0,
    revByType = {}, expByCat = {}, orderCount = 0, expenseCount = 0, basis = "accrual",
  } = d;

  const LineRow = ({ label, amt, bold, color, indent }) => (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "7px 0", borderBottom: "1px solid var(--border-muted)",
      marginLeft: indent ? 16 : 0,
    }}>
      <span style={{ fontSize: 13, fontWeight: bold ? 700 : 400, color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 700 : 400, color: color || "var(--text-primary)", fontFamily: "monospace" }}>
        {f$(amt)}
      </span>
    </div>
  );

  const SectionHeader = ({ label, color }) => (
    <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: ".08em", padding: "14px 0 6px", marginTop: 4 }}>
      {label}
    </div>
  );

  // CSV/PDF data
  const csvH = ["Account", "Amount"];
  const csvR = [
    ["INCOME", ""],
    ...Object.entries(revByType).filter(([,v]) => v > 0).map(([k, v]) => ["  " + k, f$(v)]),
    ["TOTAL INCOME", f$(totalRevenue)],
    ["", ""],
    ["EXPENSES", ""],
    ...Object.entries(expByCat).sort((a,b)=>b[1]-a[1]).map(([k, v]) => ["  " + k, f$(v)]),
    ["TOTAL EXPENSES", f$(totalExpenses)],
    ["", ""],
    ["NET PROFIT / (LOSS)", f$(netProfit)],
    ["GROSS MARGIN", fPct(margin)],
  ];

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <span style={{
          fontSize: 11, padding: "3px 12px", borderRadius: 20,
          background: basis === "accrual" ? "rgba(99,102,241,0.15)" : "rgba(34,211,153,0.15)",
          color: basis === "accrual" ? "#818cf8" : "#34d399",
          border: `1px solid ${basis === "accrual" ? "#818cf822" : "#34d39922"}`,
        }}>
          {basis === "accrual" ? "Accrual Basis" : "Cash Basis"}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {orderCount} orders · {expenseCount} expense records
        </span>
      </div>

      <div style={{ background: "var(--bg-panel)", borderRadius: 12, padding: "20px 24px", border: "1px solid var(--border)" }}>
        <SectionHeader label="Income" color="#34d399" />
        {Object.entries(revByType).filter(([,v]) => v > 0).map(([k, v]) =>
          <LineRow key={k} label={k} amt={v} indent />
        )}
        {Object.values(revByType).every(v => v === 0) && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0 8px 16px" }}>No revenue recorded</div>
        )}
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 4 }} />
        <LineRow label="Total Income" amt={totalRevenue} bold color="#34d399" />

        <SectionHeader label="Expenses" color="#f87171" />
        {Object.entries(expByCat).sort((a,b)=>b[1]-a[1]).map(([k, v]) =>
          <LineRow key={k} label={k} amt={v} indent />
        )}
        {Object.keys(expByCat).length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0 8px 16px" }}>No expenses recorded</div>
        )}
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 4 }} />
        <LineRow label="Total Expenses" amt={totalExpenses} bold color="#f87171" />

        <div style={{ borderTop: "2px solid var(--border)", marginTop: 16, paddingTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 15, fontWeight: 800 }}>Net Profit / (Loss)</span>
            <span style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: netProfit >= 0 ? "#34d399" : "#f87171" }}>
              {f$(netProfit)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Gross Margin</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: netProfit >= 0 ? "#34d399" : "#f87171" }}>
              {fPct(margin)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={() => dlCSV(csvH, csvR, `PL-${basis}`)} style={{ fontSize: 12, padding: "5px 14px", background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
          ⬇ Export CSV
        </button>
        <button onClick={() => dlPDF(`P&L (${basis})`, sub, csvH, csvR, null)} style={{ fontSize: 12, padding: "5px 14px", background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
          📄 Export PDF
        </button>
      </div>
    </div>
  );
}

function CashFlow({ d, sub }) {
  const { months = [], totals = {} } = d;
  const H = ["Month", "Cash In (Completed Orders)", "Cash Out (Paid Expenses)", "Net Cash Flow"];
  const R = months.map((m) => [
    m.month,
    <span style={{ color: "#34d399" }}>{f$(m.inflow)}</span>,
    <span style={{ color: "#f87171" }}>{f$(m.outflow)}</span>,
    <span style={{ fontWeight: 700, color: m.net >= 0 ? "#34d399" : "#f87171" }}>{f$(m.net)}</span>,
  ]);
  const F    = ["TOTALS", f$(totals.inflow), f$(totals.outflow), f$(totals.net)];
  const Rcsv = months.map((m) => [m.month, f$(m.inflow), f$(m.outflow), f$(m.net)]);
  const Fcsv = ["TOTALS", f$(totals.inflow), f$(totals.outflow), f$(totals.net)];
  return <>
    <Chips items={[
      { label: "Total Cash In",  val: f$(totals.inflow),  clr: "#34d399" },
      { label: "Total Cash Out", val: f$(totals.outflow), clr: "#f87171" },
      { label: "Net Cash Flow",  val: f$(totals.net),     clr: totals.net >= 0 ? "#34d399" : "#f87171" },
    ]} />
    <ExBar onCSV={() => dlCSV(H, Rcsv, "Cash-Flow")} onPDF={() => dlPDF("Cash Flow", sub, H, Rcsv, Fcsv)} />
    <RT headers={H} rows={R} footer={F} rights={[1, 2, 3]} />
  </>;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Detailed (drill-down) report renderers ────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function PLDetail({ d, sub, filter, activeReport }) {
  const isCash = d.basis === "cash";
  const rows = applyFilter(
    d.rows || [], filter,
    r => r.refNumber, r => r.customer, r => r.vehicle, r => r.vin, r => r.invoiceNumber
  );

  const totRev    = rows.reduce((s, r) => s + (r.revenue    || 0), 0);
  const totCost   = rows.reduce((s, r) => s + (isCash ? (r.towingCost + r.oceanCost) : (r.cost || 0)), 0);
  const totProfit = totRev - totCost;

  const H = isCash
    ? ["Invoice #", "Date Paid", "Customer", "Vehicle / VIN", "Revenue", "Cost", "Profit"]
    : ["Ref #", "Date", "Customer", "Vehicle / VIN", "Status", "Revenue", "Cost", "Profit"];

  const clr = n => ({ color: n >= 0 ? "#34d399" : "#f87171", fontFamily: "monospace", fontWeight: 700 });

  const R = rows.map(r => {
    const cost   = isCash ? (r.towingCost + r.oceanCost) : (r.cost || 0);
    const profit = r.revenue - cost;
    const vinSuffix = r.vin ? ` ···${String(r.vin).slice(-6).toUpperCase()}` : "";
    const base = [
      <span style={{ fontSize:12, color:"var(--text-secondary)" }}>{fD(r.date)}</span>,
      <span style={{ fontSize:12 }}>{r.customer}</span>,
      <span style={{ fontSize:11 }}>{r.vehicle}<span style={{ color:"var(--text-muted)" }}>{vinSuffix}</span></span>,
    ];
    const nums = [
      <span style={{ fontFamily:"monospace" }}>{f$(r.revenue)}</span>,
      <span style={{ fontFamily:"monospace", color:"#f87171" }}>{f$(cost)}</span>,
      <span style={clr(profit)}>{profit >= 0 ? "+" : ""}{f$(profit)}</span>,
    ];
    if (isCash) return [
      <span style={{ color:"var(--accent)", fontFamily:"monospace", fontSize:11 }}>{r.invoiceNumber}</span>,
      ...base, ...nums,
    ];
    return [
      <span style={{ color:"var(--accent)", fontWeight:600, fontFamily:"monospace", fontSize:11 }}>{r.refNumber}</span>,
      ...base,
      <span style={{ fontSize:11, color: r.status === "Completed" ? "#34d399" : "var(--text-secondary)" }}>{r.status}</span>,
      ...nums,
    ];
  });

  const lastCols = isCash ? [4,5,6] : [5,6,7];
  const F = isCash
    ? ["", "", "", "", f$(totRev), f$(totCost), <span style={clr(totProfit)}>{totProfit>=0?"+":""}{f$(totProfit)}</span>]
    : ["", "", "", "", "", f$(totRev), f$(totCost), <span style={clr(totProfit)}>{totProfit>=0?"+":""}{f$(totProfit)}</span>];

  const Rcsv = rows.map(r => {
    const cost = isCash ? (r.towingCost + r.oceanCost) : (r.cost || 0);
    const profit = r.revenue - cost;
    return isCash
      ? [r.invoiceNumber, fD(r.date), r.customer, r.vehicle, f$(r.revenue), f$(cost), f$(profit)]
      : [r.refNumber, fD(r.date), r.customer, r.vehicle, r.status, f$(r.revenue), f$(cost), f$(profit)];
  });
  const Fcsv = isCash
    ? ["TOTALS", "", "", "", f$(totRev), f$(totCost), f$(totProfit)]
    : ["TOTALS", "", "", "", "", f$(totRev), f$(totCost), f$(totProfit)];

  return <>
    <Chips items={[
      { label: isCash ? "Paid Invoices" : "Orders", val: rows.length },
      { label: "Total Revenue",  val: f$(totRev),    clr: "var(--accent)" },
      { label: "Total Cost",     val: f$(totCost),   clr: "#f87171" },
      { label: "Net Profit",     val: f$(totProfit), clr: totProfit >= 0 ? "#34d399" : "#f87171" },
    ]} />
    <ExBar
      onCSV={() => dlCSV(H, Rcsv, isCash ? "PL-Cash-Detail" : "PL-Accrual-Detail")}
      onPDF={() => dlPDF(isCash ? "P&L Cash Basis — Detail" : "P&L Accrual — Detail", sub, H, Rcsv, Fcsv)}
    />
    <RT headers={H} rows={R} footer={F} rights={lastCols} />
  </>;
}

function IncomeDetail({ d, sub, filter, activeReport }) {
  const rows = applyFilter(
    d.rows || [], filter,
    r => r.refNumber, r => r.customer, r => r.vehicle,
    r => r.vin, r => r.pol, r => r.pod, r => r.status
  );

  const totTowing = rows.reduce((s, r) => s + (r.towingCharge || 0), 0);
  const totOcean  = rows.reduce((s, r) => s + (r.oceanFreight || 0), 0);
  const totTotal  = rows.reduce((s, r) => s + (r.total || 0), 0);
  const totComp   = rows.filter(r => r.status === "Completed").length;

  const H = ["Ref #", "Date", "Customer", "Vehicle / VIN", "Route", "Status", "Age", "Towing", "Ocean", "Total"];
  const R = rows.map((r) => {
    const vinSuffix = r.vin ? ` ···${String(r.vin).slice(-6).toUpperCase()}` : "";
    const bkt = ageBucket(r.age);
    return [
      <span style={{ color: "var(--accent)", fontWeight: 600, fontFamily: "monospace", fontSize: 11 }}>{r.refNumber}</span>,
      <span style={{ fontSize: 11 }}>{fD(r.date)}</span>,
      <span style={{ fontSize: 12 }}>{r.customer}</span>,
      <span style={{ fontSize: 11 }}>{r.vehicle}<span style={{ color: "var(--text-muted)" }}>{vinSuffix}</span></span>,
      <span style={{ fontSize: 11 }}>{r.pol} {" > "} {r.pod}</span>,
      <span style={{ fontSize: 11, color: r.status === "Completed" ? "#34d399" : "var(--text-secondary)" }}>{r.status}</span>,
      <span style={{ fontSize: 11, color: BCLR[bkt] || "#9ca3af" }}>{r.age}d</span>,
      r.towingCharge ? <span style={{ fontFamily: "monospace" }}>{f$(r.towingCharge)}</span> : <span style={{ color: "var(--text-muted)" }}>—</span>,
      r.oceanFreight ? <span style={{ fontFamily: "monospace" }}>{f$(r.oceanFreight)}</span> : <span style={{ color: "var(--text-muted)" }}>—</span>,
      <span style={{ fontWeight: 700, fontFamily: "monospace" }}>{f$(r.total)}</span>,
    ];
  });
  const F    = ["", "", "", "", "", `${totComp} completed`, "", f$(totTowing), f$(totOcean), f$(totTotal)];
  const Rcsv = rows.map((r) => [
    r.refNumber, fD(r.date), r.customer,
    r.vehicle + (r.vin ? ` ...${String(r.vin).slice(-6)}` : ""),
    `${r.pol} > ${r.pod}`, r.status, r.age + "d",
    f$(r.towingCharge), f$(r.oceanFreight), f$(r.total),
  ]);
  const Fcsv = ["", "", "", "", "", "", "TOTALS", f$(totTowing), f$(totOcean), f$(totTotal)];

  const isAgedRec = activeReport === "aged-receivables";

  return <>
    <Chips items={[
      { label: isAgedRec ? "Open Orders" : "Orders",      val: rows.length },
      { label: isAgedRec ? "Total Outstanding" : "Total Billed", val: f$(totTotal), clr: isAgedRec ? "#f87171" : "var(--accent)" },
      { label: "Towing / Transport", val: f$(totTowing), clr: "var(--text-secondary)" },
      { label: "Ocean Freight",      val: f$(totOcean),  clr: "var(--text-secondary)" },
    ]} />
    <ExBar
      onCSV={() => dlCSV(H, Rcsv, isAgedRec ? "Open-Orders-Detail" : "Income-Orders-Detail")}
      onPDF={() => dlPDF(isAgedRec ? "Open Orders — Detailed" : "Income — Order Detail", sub, H, Rcsv, Fcsv)}
    />
    <RT headers={H} rows={R} footer={F} rights={[7, 8, 9]} />
  </>;
}

function ExpenseDetail({ d, sub, filter, activeReport }) {
  const rows = applyFilter(
    d.rows || [], filter,
    r => r.vendor, r => r.description, r => r.category,
    r => r.invoiceNumber, r => r.orderRef
  );

  const totAmt    = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const totPaid   = rows.filter(r => r.status === "paid").reduce((s, r) => s + (r.amount || 0), 0);
  const totUnpaid = rows.filter(r => r.status !== "paid").reduce((s, r) => s + (r.amount || 0), 0);

  const H = ["Date", "Vendor", "Description", "Invoice #", "Category", "Amount", "Status", "Paid Date", "Order Ref"];
  const R = rows.map((r) => [
    <span style={{ fontSize: 11 }}>{fD(r.date)}</span>,
    <span style={{ fontWeight: 600, fontSize: 12 }}>{r.vendor || "—"}</span>,
    <span style={{ fontSize: 11 }}>{r.description || "—"}</span>,
    <span style={{ fontFamily: "monospace", fontSize: 11 }}>{r.invoiceNumber || "—"}</span>,
    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.category || "—"}</span>,
    <span style={{ fontWeight: 700, fontFamily: "monospace" }}>{f$(r.amount)}</span>,
    <span style={{ fontSize: 11, fontWeight: 600, color: r.status === "paid" ? "#34d399" : "#f87171" }}>{r.status || "—"}</span>,
    <span style={{ fontSize: 11 }}>{fD(r.paidDate)}</span>,
    <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>{r.orderRef || "—"}</span>,
  ]);
  const F    = ["", "", "", "", "TOTAL", f$(totAmt), "", "", ""];
  const Rcsv = rows.map((r) => [
    fD(r.date), r.vendor || "—", r.description || "—",
    r.invoiceNumber || "—", r.category || "—",
    f$(r.amount), r.status || "—", fD(r.paidDate), r.orderRef || "—",
  ]);

  const isAgedPay = activeReport === "aged-payables";

  return <>
    <Chips items={[
      { label: "Records",      val: rows.length },
      { label: "Total Amount", val: f$(totAmt),    clr: "#f87171" },
      { label: "Paid",         val: f$(totPaid),   clr: "#34d399" },
      { label: "Unpaid",       val: f$(totUnpaid), clr: totUnpaid > 0 ? "#f87171" : "#34d399" },
    ]} />
    <ExBar
      onCSV={() => dlCSV(H, Rcsv, isAgedPay ? "Unpaid-Bills-Detail" : "Expenses-Detail")}
      onPDF={() => dlPDF(isAgedPay ? "Unpaid Bills — Detailed" : "Expenses — Detailed", sub, H, Rcsv, F)}
    />
    <RT headers={H} rows={R} footer={F} rights={[5]} />
  </>;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Main page ─────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

export default function Reports() {
  const [active,     setActive]     = useState("income-by-customer");
  const [from,       setFrom]       = useState("");
  const [to,         setTo]         = useState("");
  const [months,     setMonths]     = useState("6");
  const [filterText, setFilterText] = useState("");
  const [view,       setView]       = useState("quick");   // "quick" | "detailed"
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(false);

  const subLabel = from || to
    ? `${from ? fD(from) : "Start"} — ${to ? fD(to) : "Today"}`
    : "All Time";

  // ── Fetch data ─────────────────────────────────────────────────────────────
  // viewOverride lets callers force a specific view without waiting for state update
  const load = async (viewOverride) => {
    const currentView = viewOverride !== undefined ? viewOverride : view;
    setLoading(true); setData(null);
    try {
      const p = new URLSearchParams();
      if (from) p.set("from", from);
      if (to)   p.set("to",   to);
      if (active === "cash-flow") p.set("months", months);

      let ep;
      if (currentView === "detailed" && DETAIL_TYPE[active]) {
        if (DETAIL_TYPE[active] === "pl") {
          const basis = active === "pl-accrual" ? "accrual" : "cash";
          ep = `profit-loss-detail?basis=${basis}&${p}`;
        } else if (DETAIL_TYPE[active] === "orders") {
          if (active === "aged-receivables") p.set("notCompleted", "1");
          ep = `orders-detail?${p}`;
        } else {
          if (active === "aged-payables") p.set("status", "unpaid");
          ep = `expenses-detail?${p}`;
        }
      } else if (active === "pl-accrual") {
        ep = `profit-loss?basis=accrual&${p}`;
      } else if (active === "pl-cash") {
        ep = `profit-loss?basis=cash&${p}`;
      } else {
        ep = `${active}?${p}`;
      }

      const res = await fetch(`${API}/api/reports/${ep}`);
      setData(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // Toggle between summary and detailed — loads immediately with the new view
  const handleView = (v) => {
    setView(v);
    load(v);
  };

  // When switching report tabs: reset filter, reset view to quick, reload
  useEffect(() => {
    setFilterText("");
    setView("quick");
    load("quick");
  }, [active]);

  // Re-run when month count changes on cash flow
  useEffect(() => {
    if (active === "cash-flow") load();
  }, [months]);

  // ── Render the active report ───────────────────────────────────────────────
  const renderReport = () => {
    if (loading) return (
      <div style={{ color: "var(--text-muted)", padding: 40, textAlign: "center" }}>Loading…</div>
    );
    if (!data) return null;

    const props = { d: data, sub: subLabel, filter: filterText, activeReport: active };

    // Detailed drill-down view
    if (view === "detailed") {
      if (DETAIL_TYPE[active] === "pl")       return <PLDetail      {...props} />;
      if (DETAIL_TYPE[active] === "orders")   return <IncomeDetail  {...props} />;
      if (DETAIL_TYPE[active] === "expenses") return <ExpenseDetail {...props} />;
    }

    // Quick summary view (default)
    switch (active) {
      case "income-by-customer":    return <IncomeByCustomer    {...props} />;
      case "income-by-destination": return <IncomeByDestination {...props} />;
      case "income-by-route":       return <IncomeByRoute       {...props} />;
      case "aged-receivables":      return <AgedReceivables     {...props} />;
      case "aged-payables":         return <AgedPayables        {...props} />;
      case "expenses-by-category":  return <ExpensesByCategory  {...props} />;
      case "purchases-by-vendor":   return <PurchasesByVendor   {...props} />;
      case "pl-accrual":
      case "pl-cash":               return <ProfitLoss          {...props} />;
      case "cash-flow":             return <CashFlow            {...props} />;
      default:                      return null;
    }
  };

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", minHeight: "100%" }}>

      {/* ── Report sidebar ── */}
      <div style={{
        width: 210, flexShrink: 0,
        background: "var(--bg-panel)", borderRight: "1px solid var(--border)",
        padding: "22px 0",
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".1em", padding: "0 16px 16px" }}>
          Report Type
        </div>
        {NAV.map((n) => (
          <div key={n.g} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", padding: "0 16px 5px",
              textTransform: "uppercase", letterSpacing: ".06em", display: "flex", alignItems: "center", gap: 5 }}>
              {n.icon} {n.g}
            </div>
            {n.items.map((item) => (
              <button key={item.id} onClick={() => setActive(item.id)} style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "8px 16px 8px 28px", border: "none", cursor: "pointer", fontSize: 13,
                background: active === item.id ? "rgba(59,130,246,0.12)" : "transparent",
                color:      active === item.id ? "#60a5fa" : "var(--text-secondary)",
                borderLeft: active === item.id ? "2px solid #3b82f6" : "2px solid transparent",
              }}>
                {item.label}
                {DETAIL_TYPE[item.id] && (
                  <span style={{ marginLeft: 6, fontSize: 9, color: "var(--text-muted)", letterSpacing: ".04em" }}>
                    DETAIL
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, padding: "28px 32px", overflowY: "auto" }}>

        {/* Page header + controls */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{TITLES[active]}</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              {subLabel}
              {view === "detailed" && DETAIL_TYPE[active] && (
                <span style={{ marginLeft: 8, fontSize: 11, color: "var(--accent)", fontWeight: 600,
                  background: "rgba(59,130,246,0.1)", padding: "2px 8px", borderRadius: 10 }}>
                  Detailed View
                </span>
              )}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>

            {/* Quick / Detailed segmented toggle */}
            {DETAIL_TYPE[active] && (
              <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                <button
                  onClick={() => handleView("quick")}
                  style={{
                    padding: "6px 16px", fontSize: 12, border: "none", cursor: "pointer",
                    background: view === "quick" ? "var(--accent)" : "var(--bg-panel)",
                    color:      view === "quick" ? "#fff" : "var(--text-secondary)",
                    fontWeight: view === "quick" ? 600 : 400,
                    transition: "background .15s",
                  }}
                >
                  Summary
                </button>
                <button
                  onClick={() => handleView("detailed")}
                  style={{
                    padding: "6px 16px", fontSize: 12, border: "none", cursor: "pointer",
                    borderLeft: "1px solid var(--border)",
                    background: view === "detailed" ? "var(--accent)" : "var(--bg-panel)",
                    color:      view === "detailed" ? "#fff" : "var(--text-secondary)",
                    fontWeight: view === "detailed" ? 600 : 400,
                    transition: "background .15s",
                  }}
                >
                  Detailed
                </button>
              </div>
            )}

            {/* Search / filter box */}
            {(HAS_SEARCH.has(active) || (view === "detailed" && DETAIL_TYPE[active])) && (
              <div style={{ position: "relative" }}>
                <input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder={
                    view === "detailed"
                      ? "Search all fields…"
                      : (SEARCH_LABEL[active] || "Filter…")
                  }
                  style={{ fontSize: 12, padding: "6px 30px 6px 10px", width: 220 }}
                />
                {filterText && (
                  <button onClick={() => setFilterText("")} style={{
                    position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: "var(--text-muted)",
                    cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0,
                  }}>✕</button>
                )}
              </div>
            )}

            {/* Date range / month selector */}
            {active === "cash-flow" ? (
              <select value={months} onChange={(e) => setMonths(e.target.value)}
                style={{ fontSize: 12, padding: "6px 10px" }}>
                {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} months</option>)}
              </select>
            ) : HAS_DATES.has(active) ? (
              <>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  style={{ fontSize: 12, padding: "6px 10px" }} />
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>to</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                  style={{ fontSize: 12, padding: "6px 10px" }} />
                {(from || to) && (
                  <button onClick={() => { setFrom(""); setTo(""); }}
                    style={{ fontSize: 12, padding: "6px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
                    ✕ Dates
                  </button>
                )}
              </>
            ) : null}

            <button onClick={() => load()} style={{ fontSize: 12, padding: "6px 18px", fontWeight: 600 }}>
              Run ↻
            </button>
          </div>
        </div>

        {/* Report body */}
        {renderReport()}
      </div>
    </div>
  );
}

