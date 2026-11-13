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

// GET /api/releases/pending — paid orders whose release hasn't gone to the customer yet
router.get("/pending", async (req, res) => {
  try {
    const orders = await Order.find({ status: "Paid", "release.forwardedAt": null })
      .select("refNumber vin year make model customerName customerEmail shippingLine voyage bookingNumber release arrivalDate")
      .lean();
    const invs = await Invoice.find({ orderId: { $in: orders.map((o) => o._id) } })
      .select("orderId invoiceNumber status paidAt").lean();
    const invBy = new Map(invs.map((i) => [String(i.orderId), i]));
    const rows = orders.map((o) => {
      const inv = invBy.get(String(o._id));
      return {
        _id: o._id, refNumber: o.refNumber, vin: o.vin, last6: last6(o.vin),
        vehicle: [o.year, o.make, o.model].filter(Boolean).join(" "),
        customerName: o.customerName, customerEmail: o.customerEmail || "",
        line: lineOf(o.shippingLine), voyage: String(o.voyage || "").trim().toUpperCase(), booking: o.bookingNumber || "",
        requestedAt: o.release?.requestedAt || null, arrivalDate: o.arrivalDate || "",
        invoiceNumber: inv?.invoiceNumber || "", invoicePaid: inv?.status === "paid", paidAt: inv?.paidAt || null,
      };
    });
    res.json(rows);
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
