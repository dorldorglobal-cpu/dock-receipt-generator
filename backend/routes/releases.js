// Shipping-line releases — see utils/releaseWatch.js
const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Invoice = require("../models/Invoice");
const { scanReleases, requestSallaumReleases, completeIfReady, last6 } = require("../utils/releaseWatch");

const lineOf = (s) => {
  const v = String(s || "").trim().toUpperCase();
  return v.startsWith("SALLAUM") ? "SALLAUM" : v === "ACL" || v.startsWith("ACL") ? "ACL" : v;
};

const FIELDS = "refNumber vin year make model customerName customerEmail shippingLine voyage bookingNumber release arrivalDate status";

async function withInvoices(orders) {
  const invs = await Invoice.find({ orderId: { $in: orders.map((o) => o._id) } })
    .select("orderId invoiceNumber status paidAt total payments").lean();
  const invBy = new Map(invs.map((i) => [String(i.orderId), i]));
  return orders.map((o) => {
    const inv = invBy.get(String(o._id));
    const paidSoFar = (inv?.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    return {
      _id: o._id, refNumber: o.refNumber, vin: o.vin, last6: last6(o.vin), status: o.status,
      vehicle: [o.year, o.make, o.model].filter(Boolean).join(" "),
      customerName: o.customerName, customerEmail: o.customerEmail || "",
      line: lineOf(o.shippingLine), voyage: String(o.voyage || "").trim().toUpperCase(), booking: o.bookingNumber || "",
      requestedAt: o.release?.requestedAt || null, arrivalDate: o.arrivalDate || "",
      held: !!o.release?.heldGmailId, heldReason: o.release?.heldReason || "",
      forwardedAt: o.release?.forwardedAt || null, forwardedTo: o.release?.forwardedTo || "",
      invoiceNumber: inv?.invoiceNumber || "", invoicePaid: inv?.status === "paid", paidAt: inv?.paidAt || null,
      balance: inv ? Math.max(0, (inv.total || 0) - paidSoFar) : null,
    };
  });
}

// GET /api/releases/pending
//   rows        — paid orders whose release hasn't gone out, plus releases held (invoice not paid / no email)
//   sentNotPaid — release already sent but the invoice isn't paid (early release for a good customer).
//                 Dor Ldor Global Ghana is left out: its invoices are always settled later.
router.get("/pending", async (req, res) => {
  try {
    const { isGhanaOffice } = require("../utils/releaseWatch");
    const waiting = await Order.find({
      "release.forwardedAt": null, status: { $ne: "Canceled" },
      $or: [{ status: "Paid" }, { "release.heldGmailId": { $nin: ["", null] } }],
    }).select(FIELDS).lean();
    const sent = await Order.find({
      "release.forwardedAt": { $ne: null }, status: { $nin: ["Completed", "Canceled"] },
    }).select(FIELDS).lean();
    const sentRows = (await withInvoices(sent.filter((o) => !isGhanaOffice(o)))).filter((r) => !r.invoicePaid);
    res.json({ rows: await withInvoices(waiting), sentNotPaid: sentRows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/releases/sallaum-request { voyage, orderIds, dryRun }
router.post("/sallaum-request", express.json(), async (req, res) => {
  try {
    const { voyage, orderIds, dryRun } = req.body || {};
    res.json(await requestSallaumReleases(voyage, orderIds || [], { dryRun: !!dryRun }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/releases/scan { days, dryRun } — check the inbox for releases now
router.post("/scan", express.json(), async (req, res) => {
  try {
    const { days, dryRun } = req.body || {};
    res.json(await scanReleases({ days: Math.min(Number(days) || 3, 60), dryRun: !!dryRun }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/releases/resend { vin } — forward the line's release to the customer again
router.post("/resend", express.json(), async (req, res) => {
  try {
    const { resendRelease } = require("../utils/releaseWatch");
    res.json(await resendRelease(req.body?.vin));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/releases/:id/mark-sent — release went to the customer some other way
router.post("/:id/mark-sent", async (req, res) => {
  try {
    const o = await Order.findByIdAndUpdate(req.params.id, {
      $set: { "release.forwardedAt": new Date(), "release.how": "marked" },
      $push: { timeline: { action: "Release Sent", details: "Release marked as sent to customer", createdAt: new Date() } },
    }, { new: true });
    if (!o) return res.status(404).json({ error: "Order not found" });
    const completed = await completeIfReady(o);
    res.json({ ok: true, completed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
