/**
 * Morning ops digest — one email at 8 AM Eastern with everything that needs
 * attention today. Replaces the old "Undispatched Order(s)" alert (that list is
 * now the "Not dispatched" section). Read-only: it never changes an order, bill
 * or invoice, and only ever emails ALERT_EMAIL (or GMAIL_USER).
 *
 * Preview in the browser: GET /api/digest   ·   send now: POST /api/digest/send
 */
const Order = require("../models/Order");
const Invoice = require("../models/Invoice");
const { parseDay } = require("../utils/invoiceDue");
const { flaggedOpenBills } = require("../utils/billChecks");
const { isExcludedCustomer } = require("./invoiceReminders");

const DAY = 86400000;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt$ = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vehicleOf = (o) => [o.year, o.make, o.model].filter(Boolean).join(" ") || o.vehicleYearMakeModel || "";
const hasFile = (o, label) => (o.files || []).some(f => String(f.label || "").toUpperCase() === label.toUpperCase());

// Today's calendar date in US Eastern, as UTC midnight (same form parseDay returns)
function easternToday() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
}
const daysAgo = (d, today) => d ? Math.floor((today - parseDay(d)) / DAY) : null;
const shortDay = (d) => d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : "";

const ACTIVE = { $nin: ["Completed", "Canceled"] };
const PRE_SAIL = ["New Order", "Awaiting Pickup", "Picked Up", "Delivered", "Waiting to Sail", "Problem / Hold"];
const ORDER_FIELDS = "refNumber year make model vehicleYearMakeModel vin customerName status createdAt cutoffDate pod shippingLine " +
  "dispatchMethod titleStatus files.label holds release arrivalDate vessel voyage";

/** → { date, sections: [{ key, title, note, cols, rows: [{ ref, orderId, cells: [] }], total? }] } */
async function buildDigest() {
  const today = easternToday();
  const sections = [];
  const row = (o, cells) => ({ ref: o.refNumber || "", orderId: o._id ? String(o._id) : "", cells });

  // 1. Bills that look wrong (possible duplicate, canceled order, price well above usual)
  const flagged = await flaggedOpenBills();
  sections.push({
    key: "bills", title: "⛔ Bills to check before paying", note: "Unpaid bills that may be duplicates, on a canceled order, or priced well above the vendor's usual.",
    cols: ["Order", "Vendor", "Amount", "Why"],
    rows: flagged.map(({ bill: b, flags }) => ({ ref: b.orderRef || "", orderId: "", cells: [b.vendor, fmt$(b.amount), flags.map(f => f.text).join(" · ")] })),
  });

  const orders = await Order.find({ status: ACTIVE }).select(ORDER_FIELDS).sort({ refNumber: 1 }).lean();

  // 2. Not dispatched
  const notDispatched = orders.filter(o => o.status === "New Order" && o.dispatchMethod !== "Self Dispatch")
    .map(o => ({ o, age: daysAgo(o.createdAt, today) })).sort((a, b) => b.age - a.age);
  sections.push({
    key: "dispatch", title: "🚚 Not dispatched yet", note: "Orders still in New Order.",
    cols: ["Order", "Customer", "Vehicle", "Waiting"],
    rows: notDispatched.map(({ o, age }) => row(o, [o.customerName || "—", vehicleOf(o), `${age}d`])),
  });

  // 3. Waiting for pickup more than 7 days
  const slowPickup = orders.filter(o => o.status === "Awaiting Pickup")
    .map(o => ({ o, age: daysAgo(o.createdAt, today) })).filter(x => x.age > 7).sort((a, b) => b.age - a.age);
  sections.push({
    key: "pickup", title: "⏳ Awaiting pickup over 7 days", note: "Dispatched, but the trucker hasn't picked up.",
    cols: ["Order", "Customer", "Vehicle", "Order age"],
    rows: slowPickup.map(({ o, age }) => row(o, [o.customerName || "—", vehicleOf(o), `${age}d`])),
  });

  // 4. Cutoff in the next 5 days (or passed) and still no dock receipt
  const cutoffSoon = orders.filter(o => PRE_SAIL.includes(o.status) && o.cutoffDate && !hasFile(o, "Dock Receipt"))
    .map(o => ({ o, d: parseDay(o.cutoffDate) })).filter(x => x.d && x.d - today <= 5 * DAY && today - x.d <= 7 * DAY)
    .sort((a, b) => a.d - b.d);
  sections.push({
    key: "cutoff", title: "📄 Cutoff soon — no dock receipt", note: "Cutoff within 5 days (or in the last week) and no Dock Receipt on the order.",
    cols: ["Order", "Vehicle", "Line / POD", "Cutoff"],
    rows: cutoffSoon.map(({ o, d }) => row(o, [vehicleOf(o), [o.shippingLine, o.pod].filter(Boolean).join(" → "),
      d < today ? `${shortDay(d)} (passed)` : d - today === 0 ? "today" : shortDay(d)])),
  });

  // 5. Titles missing
  // Sailed or later had a title (utils/titleAuto.js sets those to Title hourly)
  const noTitle = orders.filter(o => o.titleStatus && o.titleStatus !== "Title" && !["Sailed", "Arrived", "Paid", "Completed"].includes(o.status));
  sections.push({
    key: "titles", title: "📑 Titles missing", note: "Open orders marked No Title or Pending.",
    cols: ["Order", "Customer", "Vehicle", "Status"],
    rows: noTitle.map(o => row(o, [o.customerName || "—", vehicleOf(o), `${o.titleStatus} · ${o.status}`])),
  });

  // 6. Cotonou with no CTN
  const noCtn = orders.filter(o => /COTONOU/i.test(o.pod || "") && ["Waiting to Sail", "Sailed", "Arrived"].includes(o.status) && !hasFile(o, "CTN"));
  sections.push({
    key: "ctn", title: "🇧🇯 Cotonou — no CTN", note: "The CTN has to go with the invoice and Draft BL.",
    cols: ["Order", "Customer", "Vehicle", "Status"],
    rows: noCtn.map(o => row(o, [o.customerName || "—", vehicleOf(o), o.status])),
  });

  // 7. Releases
  const arrived = orders.filter(o => !o.release?.forwardedAt && (o.status === "Arrived" || o.release?.heldGmailId));
  const invs = await Invoice.find({ orderId: { $in: arrived.map(o => o._id) } }).select("orderId status").lean();
  const paid = new Set(invs.filter(i => i.status === "paid").map(i => String(i.orderId)));
  const relRows = [];
  for (const o of arrived) {
    const req = o.release?.requestedAt ? new Date(o.release.requestedAt) : null;
    const reqDays = req ? Math.floor((Date.now() - req) / DAY) : null;
    const arr = parseDay(o.arrivalDate);
    const arrNote = arr ? ` (arrived ${shortDay(arr)})` : "";
    if (o.release?.heldGmailId) relRows.push(row(o, [o.customerName || "—", o.shippingLine || "", `Release came in but held — ${o.release.heldReason || "check"}`]));
    // Older arrivals were mostly released before the app tracked it — only the last 60 days
    else if (paid.has(String(o._id)) && !req && (!arr || today - arr <= 60 * DAY)) relRows.push(row(o, [o.customerName || "—", o.shippingLine || "", `Paid & arrived — release not requested${arrNote}`]));
    else if (req && reqDays >= 3) relRows.push(row(o, [o.customerName || "—", o.shippingLine || "", `Requested ${reqDays}d ago — not received`]));
  }
  sections.push({
    key: "releases", title: "🔓 Releases", note: "Held releases, paid cars with no release request, and requests with no answer after 3 days.",
    cols: ["Order", "Customer", "Line", "What"], rows: relRows,
  });

  // 8. Overdue invoices (same customers the reminder emails cover)
  const overdue = (await Invoice.find({ status: { $nin: ["paid", "draft"] }, dueDate: { $lt: today } })
    .select("invoiceNumber customerName total payments dueDate orderId orderRef vehicle").sort({ dueDate: 1 }).lean())
    .filter(i => !isExcludedCustomer(i.customerName))
    .map(i => ({ i, owed: Math.max(0, (i.total || 0) - (i.payments || []).reduce((s, p) => s + (p.amount || 0), 0)) }))
    .filter(x => x.owed > 0.005);
  sections.push({
    key: "overdue", title: "💰 Overdue invoices", note: "Past due and not fully paid (Dor Ldor Global Ghana left out).",
    cols: ["Order", "Customer", "Owed", "Days late"],
    rows: overdue.map(({ i, owed }) => ({ ref: i.orderRef || "", orderId: i.orderId ? String(i.orderId) : "",
      cells: [i.customerName || "—", fmt$(owed), `${daysAgo(i.dueDate, today)}d`] })),
    total: overdue.length ? `${fmt$(overdue.reduce((s, x) => s + x.owed, 0))} owed` : "",
  });

  // 9. Open problems / holds
  const inTitles = new Set(noTitle.map(o => String(o._id)));   // already listed under Titles missing
  const holds = orders.flatMap(o => (o.holds || []).filter(h => !h.resolvedAt).map(h => ({ o, h })))
    .filter(({ o, h }) => !(inTitles.has(String(o._id)) && (h.holdType === "No Title" || /NO\s*TITLE/i.test(h.note || ""))))
    .sort((a, b) => new Date(a.h.createdAt) - new Date(b.h.createdAt));
  sections.push({
    key: "holds", title: "🚩 Open problems / holds", note: "Unresolved holds on open orders, oldest first.",
    cols: ["Order", "Customer", "Hold", "Open"],
    rows: holds.map(({ o, h }) => row(o, [o.customerName || "—", (h.note && h.note.toUpperCase() !== h.holdType.toUpperCase()) ? `${h.holdType}: ${h.note}` : h.holdType, `${daysAgo(h.createdAt, today)}d`])),
  });

  return { date: today, sections };
}

const MAX_ROWS = 25;

function digestHtml({ date, sections }, appUrl = "") {
  const link = (r) => r.orderId && appUrl ? `<a href="${esc(appUrl)}/orders/${esc(r.orderId)}" style="color:#2563eb;text-decoration:none">${esc(r.ref || "—")}</a>` : esc(r.ref || "—");
  const td = "padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top";
  const withItems = sections.filter(s => s.rows.length);
  const summary = withItems.map(s => `<li>${esc(s.title)} — <strong>${s.rows.length}</strong>${s.total ? ` (${esc(s.total)})` : ""}</li>`).join("");
  const body = withItems.map(s => `
    <h3 style="margin:22px 0 2px;font-size:15px">${esc(s.title)} <span style="color:#888;font-weight:normal">(${s.rows.length}${s.total ? ` · ${esc(s.total)}` : ""})</span></h3>
    <div style="color:#666;font-size:12px;margin-bottom:6px">${esc(s.note)}</div>
    <table style="border-collapse:collapse;font-size:13px;width:100%">
      <tr style="background:#f4f4f4">${s.cols.map(c => `<th style="padding:5px 8px;text-align:left;font-size:11px;color:#555">${esc(c)}</th>`).join("")}</tr>
      ${s.rows.slice(0, MAX_ROWS).map(r => `<tr><td style="${td};white-space:nowrap">${link(r)}</td>${r.cells.map(c => `<td style="${td}">${esc(c)}</td>`).join("")}</tr>`).join("")}
    </table>
    ${s.rows.length > MAX_ROWS ? `<div style="font-size:12px;color:#888;margin-top:4px">+ ${s.rows.length - MAX_ROWS} more</div>` : ""}`).join("");
  const day = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return `<div style="font-family:Arial,sans-serif;color:#111;max-width:860px">
    <h2 style="margin:0 0 4px">☀️ Today's ops — ${esc(day)}</h2>
    ${withItems.length ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${summary}</ul>${body}` : `<p>Nothing needs attention today. 🎉</p>`}
    <p style="font-size:11px;color:#999;margin-top:24px">Morning digest from the order system · read-only, nothing was changed.</p>
  </div>`;
}

function digestSubject({ date, sections }) {
  const n = sections.reduce((s, x) => s + x.rows.length, 0);
  const stop = sections.find(s => s.key === "bills")?.rows.length || 0;
  return `[Ops] ${date.getUTCMonth() + 1}/${date.getUTCDate()} — ${n} item${n === 1 ? "" : "s"} need attention${stop ? ` · ${stop} bill${stop === 1 ? "" : "s"} to check` : ""}`;
}

const appUrl = () => process.env.APP_URL || (process.env.FRONTEND_ORIGIN || "").split(",")[0].trim().replace(/\/$/, "");

async function sendDigest(mailer) {
  const d = await buildDigest();
  const to = process.env.ALERT_EMAIL || process.env.GMAIL_USER;
  await mailer.sendMail({ from: process.env.GMAIL_USER, to, subject: digestSubject(d), html: digestHtml(d, appUrl()) });
  const n = d.sections.reduce((s, x) => s + x.rows.length, 0);
  console.log(`[ops-digest] Sent to ${to} — ${n} item(s)`);
  return { sent: true, to, items: n };
}

// 8:00 AM Eastern every day, DST-aware (re-aims each day so it never drifts across DST)
function msUntil8amEastern() {
  const now = new Date();
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(now).find(p => p.type === "timeZoneName")?.value || "GMT-5";
  const offset = -parseInt((tz.match(/GMT([+-]\d+)/) || [, "-5"])[1], 10);
  const next = new Date(now);
  next.setUTCHours(8 + offset, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

function startOpsDigestScheduler(mailer) {
  const aim = () => {
    let ms = msUntil8amEastern();
    if (ms < 60000) ms += DAY; // timer fired a hair early — don't send twice
    setTimeout(async () => {
      try { await sendDigest(mailer); } catch (e) { console.warn("[ops-digest] Failed:", e.message); }
      aim();
    }, ms);
    return ms;
  };
  console.log(`[ops-digest] Scheduled — first run in ${Math.round(aim() / 60000)} min (8 AM Eastern)`);
}

module.exports = { buildDigest, digestHtml, digestSubject, sendDigest, startOpsDigestScheduler, appUrl };
