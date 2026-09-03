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

    // Nearest warehouse / port lookup (same logic as CreateOrder frontend)
    const WH_LIST = [
      { name: "EZ CARGO",             address: "3220 Bordentown Avenue", city: "Old Bridge", state: "NJ", zip: "08857", lat: 40.45, lng: -74.32 },
      { name: "SAVANNAH AUTO EXPORT", address: "109A Barrow Dr",         city: "Pooler",     state: "GA", zip: "31322", lat: 32.08, lng: -81.10 },
      { name: "ISHIP",                address: "9324 Tavenor Ln",        city: "Houston",    state: "TX", zip: "77075", lat: 29.76, lng: -95.37 },
      { name: "CEDARS EXPRESS",       address: "19070 S Reyes Ave",      city: "Compton",    state: "CA", zip: "90221", lat: 33.90, lng: -118.22 },
    ];
    const PORT_LIST = [
      { name: "BALTIMORE",    city: "Baltimore",    state: "MD", zip: "21224", lat: 39.27, lng: -76.58 },
      { name: "JACKSONVILLE", city: "Jacksonville", state: "FL", zip: "32226", lat: 30.33, lng: -81.65 },
      { name: "FREEPORT",     city: "Freeport",     state: "TX", zip: "77541", lat: 28.95, lng: -95.36 },
      { name: "DAVISVILLE",   city: "Davisville",   state: "RI", zip: "02854", lat: 41.67, lng: -71.42 },
      { name: "WILMINGTON",   city: "Wilmington",   state: "NC", zip: "28401", lat: 34.23, lng: -77.95 },
      { name: "BRUNSWICK",    city: "Brunswick",    state: "GA", zip: "31525", lat: 31.14, lng: -81.49 },
    ];
    const WH_CENTROIDS = {
      AL:[32.80,-86.79],AZ:[34.05,-111.09],AR:[34.97,-92.37],CA:[36.78,-119.42],
      CO:[39.06,-105.31],CT:[41.60,-72.70],DE:[38.99,-75.51],FL:[27.99,-81.76],
      GA:[32.68,-83.44],ID:[44.07,-114.74],IL:[40.35,-88.99],IN:[39.85,-86.26],
      IA:[42.01,-93.21],KS:[38.53,-96.73],KY:[37.67,-84.87],LA:[31.17,-91.87],
      ME:[44.69,-69.38],MD:[39.07,-76.80],MA:[42.23,-71.53],MI:[44.32,-85.60],
      MN:[46.39,-94.64],MS:[32.74,-89.67],MO:[38.46,-92.29],MT:[46.88,-110.36],
      NE:[41.49,-99.90],NV:[38.31,-117.06],NH:[43.45,-71.56],NJ:[40.30,-74.52],
      NM:[34.84,-106.25],NY:[42.17,-74.95],NC:[35.63,-79.81],ND:[47.53,-99.78],
      OH:[40.19,-82.67],OK:[35.56,-96.93],OR:[44.57,-122.07],PA:[40.59,-77.21],
      RI:[41.68,-71.51],SC:[33.84,-80.94],SD:[44.37,-100.35],TN:[35.86,-86.35],
      TX:[31.17,-99.33],UT:[39.32,-111.09],VT:[44.05,-72.71],VA:[37.77,-78.17],
      WA:[47.40,-121.49],WV:[38.49,-80.95],WI:[44.27,-89.62],WY:[42.96,-107.55],
    };
    const hav = (a,b,c,d) => { const R=3958.8,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); };
    const nearest = (list, stateCode) => {
      const coords = WH_CENTROIDS[(stateCode || "").toUpperCase().trim()];
      if (!coords) return null;
      let best = null, bestD = Infinity;
      for (const loc of list) { const d = hav(coords[0],coords[1],loc.lat,loc.lng); if (d < bestD) { bestD = d; best = loc; } }
      return best;
    };

    const reqType = data.requestType || "RORO";
    const pickupState = (data.pickupState || "").toUpperCase().trim();
    let deliveryCity = data.deliveryCity || "";
    let deliveryState = data.deliveryState || "";
    let deliveryZip = data.deliveryZip || "";
    let deliveryName = data.deliveryName || "";
    if (!deliveryCity && pickupState) {
      const dest = reqType === "Container"
        ? nearest(WH_LIST, pickupState)
        : nearest(PORT_LIST, pickupState);
      if (dest) {
        deliveryCity  = dest.city;
        deliveryState = dest.state;
        deliveryZip   = dest.zip;
        deliveryName  = dest.name;
      }
    }

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
      requestType:   reqType,
      deliveryCity,
      deliveryState,
      deliveryZip,
      deliveryName,
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
    const pending  = await EmailOrder.countDocuments({ status: "pending" });
    const approved = await EmailOrder.countDocuments({ status: "approved" });
    const noPdf    = await EmailOrder.countDocuments({ status: "no-pdf" });
    res.json({ ok: true, pending, approved, noPdf });
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
