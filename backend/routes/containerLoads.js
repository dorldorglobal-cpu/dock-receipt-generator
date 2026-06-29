const express = require("express");
const router  = express.Router();
const ContainerLoad = require("../models/ContainerLoad");
const Order         = require("../models/Order");
const { getGmailAccessToken } = require("../utils/gmail");

const LOADER_TO = "info@e-zcargo.com";
const LOADER_CC = "shipping@e-zcargo.com";

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
    const {
      name, orderIds, vessel, pol, pod, loaderEmail, notes,
      consigneeName, consigneeAddress, consigneePhone, consigneeEmail, consigneeTin,
      notifyName, notifyAddress, notifyPhone, notifyEmail, notifyTin,
    } = req.body;
    if (!orderIds?.length) return res.status(400).json({ error: "Select at least one order" });

    const load = await ContainerLoad.create({
      name, orderIds, vessel, pol, pod, loaderEmail, notes,
      consigneeName, consigneeAddress, consigneePhone, consigneeEmail, consigneeTin,
      notifyName, notifyAddress, notifyPhone, notifyEmail, notifyTin,
    });

    if (loaderEmail) {
      const orders = await Order.find({ _id: { $in: orderIds } }).lean();
      await sendLoaderEmail(load, orders);
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

// PATCH /api/container-loads/:id
router.patch("/:id", express.json(), async (req, res) => {
  try {
    const fields = [
      "bookingNumber","containerNumber","sealNumber","status",
      "vessel","pol","pod","loaderEmail","notes",
      "consigneeName","consigneeAddress","consigneePhone","consigneeEmail","consigneeTin",
      "notifyName","notifyAddress","notifyPhone","notifyEmail","notifyTin",
    ];
    const load = await ContainerLoad.findById(req.params.id);
    if (!load) return res.status(404).json({ error: "Not found" });

    for (const f of fields) {
      if (req.body[f] !== undefined) load[f] = req.body[f];
    }
    await load.save();

    if (req.body.bookingNumber) {
      await Order.updateMany(
        { _id: { $in: load.orderIds } },
        { $set: { bookingNumber: req.body.bookingNumber, ...(req.body.vessel ? { vessel: req.body.vessel } : {}) } }
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
    await sendLoaderEmail(load, load.orderIds);
    await ContainerLoad.findByIdAndUpdate(req.params.id, { emailSentAt: new Date() });
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
async function sendLoaderEmail(load, orders) {
  const destination = load.pod || "DESTINATION";
  const pol         = load.pol || "NJ";

  // Subject: ref numbers, CONTAINER TO TEMA NJ CUSTOMER NAME
  const refs = orders.map(o => o.refNumber).filter(Boolean).join(" / ");
  const custName = orders[0]?.customerName || "";
  const subject  = `${refs} CONTAINER TO ${destination.toUpperCase()} ${pol.toUpperCase()} ${custName}`.trim();

  // Consignee block
  const cLines = [
    "CONSIGNEE INFO",
    load.consigneeName    || "—",
    load.consigneeAddress || "—",
    load.consigneePhone   ? `TEL: ${load.consigneePhone}`   : "",
    load.consigneeEmail   ? `EMAIL: ${load.consigneeEmail}` : "",
    load.consigneeTin     ? `TIN#: ${load.consigneeTin}`    : "",
  ].filter(l => l !== "").join("\n");

  // Notify party block
  const nLines = [
    "NOTIFY PARTY INFO",
    load.notifyName    || "—",
    load.notifyAddress || "—",
    load.notifyPhone   ? `TEL: ${load.notifyPhone}`   : "",
    load.notifyEmail   ? `EMAIL: ${load.notifyEmail}` : "",
    load.notifyTin     ? `TIN#: ${load.notifyTin}`    : "",
  ].filter(l => l !== "").join("\n");

  // Unit lines: YYM VIN
  const unitLines = orders.map(o => {
    const ymm = [o.year, o.make, o.model].filter(Boolean).join(" ") || "—";
    return `${ymm}   ${o.vin || "—"}`;
  }).join("\n");

  const body = [
    `SEE ATTACHED LOAD LIST FOR CONTAINER TO ${destination.toUpperCase()}`,
    `PLEASE CONFIRM THIS UNIT AND ITS TITLE`,
    ``,
    cLines,
    ``,
    nLines,
    ``,
    unitLines,
    ``,
    `Thank you,`,
    `Dor Ldor Global`,
  ].join("\n");

  const from = `Dor Ldor Global <${process.env.GMAIL_USER}>`;
  const mimeLines = [
    `From: ${from}`,
    `To: ${LOADER_TO}`,
    `Cc: ${LOADER_CC}`,
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
  console.log(`[ContainerLoad] Email sent → ${LOADER_TO} (cc: ${LOADER_CC}) for load ${load.name}`);
}

module.exports = router;
