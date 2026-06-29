const express = require("express");
const router  = express.Router();
const ContainerLoad = require("../models/ContainerLoad");
const Order         = require("../models/Order");
const { getGmailAccessToken } = require("../utils/gmail");

// GET /api/container-loads
router.get("/", async (req, res) => {
  try {
    const loads = await ContainerLoad.find().sort({ createdAt: -1 }).populate("orderIds").lean();
    res.json(loads);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/container-loads  — create load + send loader email
router.post("/", express.json(), async (req, res) => {
  try {
    const { name, orderIds, vessel, pol, pod, loaderEmail, notes } = req.body;
    if (!orderIds?.length) return res.status(400).json({ error: "Select at least one order" });

    const load = await ContainerLoad.create({ name, orderIds, vessel, pol, pod, loaderEmail, notes });

    // Send loader email if address provided
    if (loaderEmail) {
      const orders = await Order.find({ _id: { $in: orderIds } }).lean();
      await sendLoaderEmail(load, orders, loaderEmail, vessel, pol, pod);
      load.emailSentAt = new Date();
      await load.save();
    }

    const populated = await ContainerLoad.findById(load._id).populate("orderIds").lean();
    res.json(populated);
  } catch (e) {
    console.error("[ContainerLoad] create error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/container-loads/:id  — update booking#, container#, seal#, status, etc.
router.patch("/:id", express.json(), async (req, res) => {
  try {
    const { bookingNumber, containerNumber, sealNumber, status, vessel, pol, pod, loaderEmail, notes } = req.body;
    const load = await ContainerLoad.findById(req.params.id);
    if (!load) return res.status(404).json({ error: "Not found" });

    if (bookingNumber  !== undefined) load.bookingNumber  = bookingNumber;
    if (containerNumber!== undefined) load.containerNumber= containerNumber;
    if (sealNumber     !== undefined) load.sealNumber     = sealNumber;
    if (status         !== undefined) load.status         = status;
    if (vessel         !== undefined) load.vessel         = vessel;
    if (pol            !== undefined) load.pol            = pol;
    if (pod            !== undefined) load.pod            = pod;
    if (loaderEmail    !== undefined) load.loaderEmail    = loaderEmail;
    if (notes          !== undefined) load.notes          = notes;
    await load.save();

    // If booking number added, push it to all linked orders
    if (bookingNumber) {
      await Order.updateMany(
        { _id: { $in: load.orderIds } },
        { $set: { bookingNumber, ...(vessel ? { vessel } : {}) } }
      );
    }

    const populated = await ContainerLoad.findById(load._id).populate("orderIds").lean();
    res.json(populated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/container-loads/:id/resend-email
router.post("/:id/resend-email", express.json(), async (req, res) => {
  try {
    const load = await ContainerLoad.findById(req.params.id).populate("orderIds").lean();
    if (!load) return res.status(404).json({ error: "Not found" });
    const email = req.body.loaderEmail || load.loaderEmail;
    if (!email) return res.status(400).json({ error: "No loader email" });
    await sendLoaderEmail(load, load.orderIds, email, load.vessel, load.pol, load.pod);
    await ContainerLoad.findByIdAndUpdate(req.params.id, { emailSentAt: new Date(), loaderEmail: email });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/container-loads/:id
router.delete("/:id", async (req, res) => {
  try {
    await ContainerLoad.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Email helper ──────────────────────────────────────────────────────────────
async function sendLoaderEmail(load, orders, toEmail, vessel, pol, pod) {
  const from = `Dor Ldor Global <${process.env.GMAIL_USER}>`;
  const subject = `Container Load Request — ${load.name}${vessel ? " / " + vessel : ""}`;

  const unitLines = orders.map((o, i) => {
    const ymm  = [o.year, o.make, o.model].filter(Boolean).join(" ") || "—";
    const cons = [o.consigneeName, o.consigneeAddress, o.consigneeCity, o.consigneeCountry]
      .filter(Boolean).join(", ") || "—";
    return [
      `Unit ${i + 1}:`,
      `  Order:      ${o.refNumber}`,
      `  Vehicle:    ${ymm}`,
      `  VIN:        ${o.vin || "—"}`,
      `  Condition:  ${o.condition || "Runner"}`,
      `  Title:      ${o.titleStatus || "—"}`,
      `  Consignee:  ${cons}`,
      `  Destination:${o.pod || pod || "—"}`,
    ].join("\n");
  }).join("\n\n");

  const body = [
    `Hello,`,
    ``,
    `Please find below the details for our upcoming container load.`,
    ``,
    `Load Reference: ${load.name}`,
    `Vessel:         ${vessel || "TBD"}`,
    `Port of Loading:${pol || "—"}`,
    `Port of Discharge: ${pod || "—"}`,
    ``,
    `═══════════════════════════════`,
    `UNITS`,
    `═══════════════════════════════`,
    unitLines,
    ``,
    `═══════════════════════════════`,
    ``,
    `Please provide the booking number at your earliest convenience.`,
    ``,
    `Thank you,`,
    `Dor Ldor Global`,
  ].join("\n");

  const mimeLines = [
    `From: ${from}`,
    `To: ${toEmail}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    body,
  ];

  const raw = Buffer.from(mimeLines.join("\r\n")).toString("base64url");
  const accessToken = await getGmailAccessToken();
  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error?.message || "Gmail error");
  console.log(`[ContainerLoad] Email sent to ${toEmail} for load ${load.name}`);
}

module.exports = router;
