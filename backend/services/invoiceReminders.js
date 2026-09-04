/**
 * Overdue invoice reminder emails.
 *
 * Schedule (anchored to the invoice's due date — due date is normally set
 * from the vehicle's arrival date at invoice-creation time anyway, and is
 * far more reliably populated on older records, so it's the primary anchor;
 * arrivalDate is still used as a fallback for the few invoices missing a
 * due date but not an arrival date):
 *   day 0   (due date)      -> stage 1, first notice
 *   day 3+  (still unpaid)  -> stage 2, reminder
 *   day 7+  (still unpaid)  -> stage 3, overdue notice
 *   day 7+  thereafter      -> daily, once per calendar day, until paid
 *
 * Only invoices with status "sent" (not draft, not already paid) and a real
 * customer email are eligible. If the invoice's own customerEmail/arrivalDate
 * is blank, the linked Order's is used instead (many older invoices weren't
 * copied over at creation time, even though the order has it).
 *
 * Customer "Dor Ldor Global Ghana" (an internal entity, not an external
 * customer) is excluded for now per explicit request — handled separately.
 *
 * Runs once daily; wired up from server.js via startInvoiceReminderScheduler().
 */
const Invoice = require("../models/Invoice");
const Order   = require("../models/Order");
const { getGmailAccessToken } = require("../utils/gmail");

// ── Excluded customers (handled separately — see file header) ────────────────
function isExcludedCustomer(name) {
  const norm = (name || "").toUpperCase().replace(/[^A-Z]/g, "");
  return norm === "DORLDORGLOBALGHANA" || norm === "DORLDORGHANA";
}

// ── Anchor date: due date first, then arrival date; either can come from the
// invoice itself or (as a fallback) its linked order ──────────────────────────
function getAnchorDate(inv, order) {
  for (const raw of [inv.dueDate, inv.arrivalDate, order?.arrivalDate]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!isNaN(d)) return d;
  }
  return null;
}

// ── Customer email: invoice's own, falling back to its linked order's ────────
function resolveEmail(inv, order) {
  const invEmail = (inv.customerEmail || "").trim();
  if (invEmail) return invEmail;
  return (order?.customerEmail || "").trim();
}

function daysBetween(a, b) {
  const MS_DAY = 24 * 60 * 60 * 1000;
  const aMid = new Date(a); aMid.setHours(0, 0, 0, 0);
  const bMid = new Date(b); bMid.setHours(0, 0, 0, 0);
  return Math.round((bMid - aMid) / MS_DAY);
}

function isSameCalendarDay(a, b) {
  if (!a || !b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// ── Email content per stage ───────────────────────────────────────────────────
const fmt$ = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function emailContent(inv, stage, daysSince) {
  const ref = inv.orderRef ? ` (Order #${inv.orderRef})` : "";
  const vehicle = inv.vehicle ? ` for your ${inv.vehicle}${inv.vin ? ` (VIN: ${inv.vin})` : ""}` : "";
  const amount = fmt$(inv.total);

  if (stage === 1) {
    return {
      subject: `Invoice ${inv.invoiceNumber} — Payment Due${ref}`,
      body: `Hello,\n\nThis is a reminder that Invoice ${inv.invoiceNumber}${vehicle} in the amount of ${amount} is now due.\n\nPlease arrange payment at your earliest convenience. Let us know if you have any questions.\n\nThank you,\nDor Ldor Global`,
    };
  }
  if (stage === 2) {
    return {
      subject: `Reminder: Invoice ${inv.invoiceNumber} — 3 Days Past Due${ref}`,
      body: `Hello,\n\nInvoice ${inv.invoiceNumber}${vehicle} in the amount of ${amount} is now 3 days past due.\n\nPlease arrange payment as soon as possible. Let us know if you have any questions.\n\nThank you,\nDor Ldor Global`,
    };
  }
  if (stage === 3) {
    return {
      subject: `Overdue Notice: Invoice ${inv.invoiceNumber} — 1 Week Past Due${ref}`,
      body: `Hello,\n\nInvoice ${inv.invoiceNumber}${vehicle} in the amount of ${amount} is now one week past due.\n\nPlease arrange payment immediately. Contact us if there is an issue with this invoice.\n\nThank you,\nDor Ldor Global`,
    };
  }
  // Daily notices after the 1-week mark
  return {
    subject: `URGENT: Invoice ${inv.invoiceNumber} — ${daysSince} Days Past Due${ref}`,
    body: `Hello,\n\nInvoice ${inv.invoiceNumber}${vehicle} in the amount of ${amount} remains unpaid, ${daysSince} days past due.\n\nPlease arrange payment right away to avoid further action. Contact us immediately if there is an issue with this invoice.\n\nThank you,\nDor Ldor Global`,
  };
}

// ── Send one reminder email via Gmail ─────────────────────────────────────────
async function sendReminderEmail(inv, stage, daysSince, toEmail) {
  const { subject, body } = emailContent(inv, stage, daysSince);
  const accessToken = await getGmailAccessToken();
  const from = `Dor Ldor Global <${process.env.GMAIL_USER}>`;
  const to = String(toEmail).split(",").map(s => s.trim()).filter(Boolean).join(", ");

  const mimeLines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    body,
  ];
  const raw = Buffer.from(mimeLines.join("\r\n")).toString("base64url");

  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error?.message || `Gmail API error ${resp.status}`);
}

// ── Main job — call once per day ──────────────────────────────────────────────
// dryRun:true computes exactly what would happen (same eligibility/stage
// logic) without sending any email or writing to the database — for testing.
async function runInvoiceReminders({ dryRun = false } = {}) {
  const today = new Date();
  const summary = { sent: 0, skippedNoEmail: 0, skippedExcluded: 0, skippedNoAnchor: 0, errors: [], details: [] };

  const invoices = await Invoice.find({ status: "sent" });

  for (const inv of invoices) {
    if (isExcludedCustomer(inv.customerName)) { summary.skippedExcluded++; continue; }

    // Only bother fetching the linked order if the invoice itself is
    // missing something we might need from it.
    const invHasEmail  = !!(inv.customerEmail && inv.customerEmail.trim());
    const invHasAnchor = getAnchorDate(inv) !== null;
    let order = null;
    if ((!invHasEmail || !invHasAnchor) && inv.orderId) {
      order = await Order.findById(inv.orderId).select("customerEmail arrivalDate").lean();
    }

    const email = resolveEmail(inv, order);
    if (!email) { summary.skippedNoEmail++; continue; }

    const anchor = getAnchorDate(inv, order);
    if (!anchor) { summary.skippedNoAnchor++; continue; }

    const daysSince = daysBetween(anchor, today);
    if (daysSince < 0) continue; // hasn't arrived / isn't due yet

    // Target stage based on how overdue it actually is right now — not just
    // "one stage past whatever we last sent". An invoice that's already 61
    // days overdue the first time this job ever runs should get an urgent
    // notice immediately, not a friendly "just due today" one that slowly
    // catches up one stage per day over the next week.
    const targetStage = daysSince >= 7 ? 3 : daysSince >= 3 ? 2 : 1;

    let stageToSend = null;
    if (targetStage > inv.reminderStage) {
      stageToSend = targetStage; // first time reaching this urgency level
    } else if (inv.reminderStage >= 3 && daysSince >= 7 && !isSameCalendarDay(inv.lastReminderSentAt, today)) {
      // Already past the 1-week notice and it's a new day — daily repeat.
      // Stage 4 is not a real DB stage (reminderStage caps its meaning at 3,
      // "reached weekly"); it just tells emailContent() to use the escalating
      // "URGENT: N days past due" wording instead of repeating the fixed
      // "1 Week Past Due" text forever.
      stageToSend = 4;
    }

    if (stageToSend === null) continue;

    if (dryRun) {
      summary.sent++;
      summary.details.push({
        invoiceNumber: inv.invoiceNumber, customerEmail: email,
        emailFromOrder: !inv.customerEmail?.trim() && !!email,
        daysSince, stageToSend, anchor: anchor.toISOString().slice(0, 10),
        subject: emailContent(inv, stageToSend, daysSince).subject,
      });
      continue;
    }

    try {
      await sendReminderEmail(inv, stageToSend, daysSince, email);
      inv.reminderStage      = Math.max(inv.reminderStage, stageToSend);
      inv.lastReminderSentAt = today;
      await inv.save();
      summary.sent++;
      console.log(`[invoice-reminders] Sent stage ${stageToSend} reminder for ${inv.invoiceNumber} (${daysSince}d) to ${email}`);
    } catch (err) {
      summary.errors.push({ invoiceNumber: inv.invoiceNumber, error: err.message });
      console.error(`[invoice-reminders] Failed to send for ${inv.invoiceNumber}:`, err.message);
    }
  }

  console.log(`[invoice-reminders] Run complete${dryRun ? " (dry run)" : ""}:`, summary);
  return summary;
}

// ── Daily scheduler — 9:00 AM Eastern, DST-aware ──────────────────────────────
function easternUtcOffsetHours(date) {
  const tzPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(date).find(p => p.type === "timeZoneName")?.value || "GMT-5";
  const m = tzPart.match(/GMT([+-]\d+)/);
  return m ? -parseInt(m[1], 10) : 5;
}
function msUntil9amEastern() {
  const now    = new Date();
  const offset = easternUtcOffsetHours(now);
  const next   = new Date(now);
  next.setUTCHours(9 + offset, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

function startInvoiceReminderScheduler() {
  const delay = msUntil9amEastern();
  console.log(`[invoice-reminders] Scheduled — first run in ${Math.round(delay / 60000)} min (9 AM Eastern)`);
  setTimeout(() => {
    runInvoiceReminders().catch(e => console.error("[invoice-reminders] Run failed:", e.message));
    setInterval(() => {
      runInvoiceReminders().catch(e => console.error("[invoice-reminders] Run failed:", e.message));
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

module.exports = { runInvoiceReminders, startInvoiceReminderScheduler, isExcludedCustomer, getAnchorDate, resolveEmail };
