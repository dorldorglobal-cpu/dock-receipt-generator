const express  = require("express");
const router   = express.Router();
const { google } = require("googleapis");
const EmailOrder = require("../models/EmailOrder");
const Order      = require("../models/Order");
const Counter    = require("../models/Counter");
const { uploadBufferToDrive, createDriveFolder } = require("../googleDrive");

const REDIRECT_URI = "https://dock-receipt-backend.onrender.com/oauth2callback";
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  REDIRECT_URI
);
// Note: oauth2Client here is only used to generate the auth URL, not to call Gmail directly

// ── GET /api/email-orders — list pending email orders ────────────────────────
router.get("/", async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const items  = await EmailOrder.find({ status }).sort({ createdAt: -1 }).select("-pdfBuffer -bodyText");
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/email-orders/count — how many pending ───────────────────────────
router.get("/count", async (req, res) => {
  try {
    const count = await EmailOrder.countDocuments({ status: "pending" });
    res.json({ count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/email-orders/:id/approve — create a real order ─────────────────
router.post("/:id/approve", express.json(), async (req, res) => {
  try {
    const eo = await EmailOrder.findById(req.params.id);
    if (!eo) return res.status(404).json({ error: "Not found" });
    if (eo.status !== "pending") return res.status(400).json({ error: "Already processed" });

    // Merge any manual edits from the request body
    const data = { ...eo.toObject(), ...req.body };

    // Generate ref number
    const counter = await Counter.findByIdAndUpdate("orderRef", { $inc: { seq: 1 } }, { new: true, upsert: true });
    const refNumber = counter.seq.toString();

    // Create the order
    const pickupFull = [data.pickupAddress, data.pickupCity, data.pickupState, data.pickupZip].filter(Boolean).join(", ");
    const order = await Order.create({
      refNumber,
      customerName:  data.customerName || "",
      year:          data.year || "",
      make:          data.make || "",
      model:         data.model || "",
      color:         data.color || "",
      vin:           data.vin || "",
      lotNumber:     data.lot || "",
      pin:           data.pin || "",
      pickupLocation: pickupFull,
      pickupAddress: data.pickupAddress || "",
      pickupCity:    data.pickupCity || "",
      pickupState:   data.pickupState || "",
      pickupZip:     data.pickupZip || "",
      requestType:   data.requestType || "RORO",
      status:        "New Order",
      source:        "Copart Email",
      notes:         data.notes || "",
    });

    // Upload PDF to Drive if we have a root folder configured
    const files = [];
    if (eo.pdfBuffer && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
      try {
        const folderName = `${refNumber} - ${data.year || ""} ${data.make || ""} ${data.model || ""} - ${data.vin || ""}`.trim();
        const folder = await createDriveFolder(folderName, process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
        order.driveFolderId   = folder.id;
        order.driveFolderLink = folder.webViewLink;

        const driveFile = await uploadBufferToDrive(
          eo.pdfBuffer, eo.pdfFilename || `${eo.lot}_receipt.pdf`,
          "application/pdf", folder.id
        );
        files.push({
          label: "Buyer Receipt",
          originalName: eo.pdfFilename || `${eo.lot}_receipt.pdf`,
          filename:    eo.pdfFilename || `${eo.lot}_receipt.pdf`,
          driveFileId: driveFile.id,
          mimetype:    "application/pdf",
        });
        order.files = files;
        await order.save();
      } catch (driveErr) {
        console.error("[emailOrders] Drive upload error:", driveErr.message);
        await order.save();
      }
    } else {
      await order.save();
    }

    eo.status   = "approved";
    eo.orderId  = order._id;
    eo.orderRef = refNumber;
    await eo.save();

    res.json({ order, emailOrder: eo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/email-orders/:id/reject ────────────────────────────────────────
router.post("/:id/reject", async (req, res) => {
  try {
    const eo = await EmailOrder.findById(req.params.id);
    if (!eo) return res.status(404).json({ error: "Not found" });
    eo.status = "rejected";
    await eo.save();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/email-orders/sync — manual trigger ──────────────────────────────
router.post("/sync", async (req, res) => {
  try {
    const { pollCopart } = require("../services/copartPoller");
    await pollCopart();
    const count = await EmailOrder.countDocuments({ status: "pending" });
    res.json({ ok: true, pending: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/email-orders/cleanup — mark pending items as approved if order already exists ──
router.post("/cleanup", async (req, res) => {
  try {
    const pending = await EmailOrder.find({ status: "pending" });
    let cleaned = 0;
    for (const eo of pending) {
      if (!eo.vin) continue;
      const existing = await Order.findOne({ vin: eo.vin });
      if (existing) {
        eo.status = "approved";
        eo.orderId = existing._id;
        eo.orderRef = existing.refNumber;
        await eo.save();
        cleaned++;
      }
    }
    const remaining = await EmailOrder.countDocuments({ status: "pending" });
    res.json({ ok: true, cleaned, remaining });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/gmail-auth — generate OAuth URL with Gmail scope ─────────────────
router.get("/gmail-auth-url", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
  });
  res.json({ url });
});

module.exports = router;
