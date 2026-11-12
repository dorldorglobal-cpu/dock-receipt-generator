// Keep an order's invoice due date in step with its arrival date.
//
// Invoices are due on arrival. When the arrival date changes (vessel schedule
// lookup, edit, Draft BL upload), an unpaid invoice whose due date came from
// the old arrival date (or has none) moves to the new one and its PDF on the
// order is regenerated. A due date someone typed by hand is left alone, and a
// paid invoice is never touched.

const Invoice = require("../models/Invoice");

// "11/30/2026" | "2026-11-30" | Date → Date at UTC midnight of that calendar day
function parseDay(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const d = new Date(s);
  return isNaN(d) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// Same calendar day, allowing one day of drift from old time-zone conversions
const near = (a, b) => a && b && Math.abs(a - b) <= 36 * 3600 * 1000;
const fmt  = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;

/**
 * @param order       mongoose Order doc, already holding the NEW arrivalDate (saved or not)
 * @param oldArrival  the arrival date before the change
 * @returns { moved, invoiceNumber, from, to } | null
 */
async function syncInvoiceDueToArrival(order, oldArrival) {
  const newD = parseDay(order?.arrivalDate);
  const oldD = parseDay(oldArrival);
  if (!newD || (oldD && near(oldD, newD) && +oldD === +newD)) return null;

  const inv = await Invoice.findOne({ orderId: order._id }).sort({ createdAt: 1 });
  if (!inv || inv.status === "paid") return null;
  const cur = inv.dueDate ? parseDay(inv.dueDate) : null;
  if (cur && +cur === +newD) return null;
  // Only a due date that followed the old arrival date (or none) follows the new one
  if (cur && !(oldD && near(cur, oldD))) return null;

  inv.dueDate = newD;
  await inv.save();

  order.timeline.push({
    action: "Invoice Due Date Updated",
    details: `Invoice ${inv.invoiceNumber} due date ${cur ? fmt(cur) : "—"} → ${fmt(newD)} (arrival date changed)` +
             (inv.status === "sent" ? " — the invoice was already sent; resend it if the customer needs the new date." : ""),
    createdAt: new Date(),
  });

  // Fresh PDF on the order (this also saves the order)
  let saved = false;
  try {
    const invoices = require("../routes/invoices");
    const pdf = await invoices.generateInvoicePdf(inv.toObject(), order);
    saved = await invoices.replaceInvoiceFileOnOrder(order, pdf, inv.invoiceNumber);
  } catch (e) {
    console.warn("[invoiceDue] PDF regen failed:", e.message);
  }
  if (!saved) await order.save();
  return { moved: true, invoiceNumber: inv.invoiceNumber, from: cur ? fmt(cur) : "", to: fmt(newD), sent: inv.status === "sent" };
}

module.exports = { syncInvoiceDueToArrival, parseDay };
