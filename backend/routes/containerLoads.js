const express = require("express");
const router  = express.Router();
const multer  = require("multer");
const fs      = require("fs");
const path    = require("path");
const ContainerLoad = require("../models/ContainerLoad");
const Order         = require("../models/Order");
const { getGmailAccessToken } = require("../utils/gmail");
const {
  createDriveFolder,
  uploadFileToDrive,
  listFilesInFolder,
} = require("../googleDrive");

const upload = multer({ dest: "temp/" });

// Parent Drive folder for container load docs (same as ACL/EZ Cargo area)
const CONTAINER_DOCS_FOLDER = process.env.CONTAINER_DOCS_FOLDER_ID || "root";

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

// POST /api/container-loads  — create load (no auto-email; frontend shows preview modal)
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

// POST /api/container-loads/:id/send-email  — send custom email (frontend provides to/cc/subject/body)
router.post("/:id/send-email", express.json(), async (req, res) => {
  try {
    const { to, cc, subject, body } = req.body;
    if (!to) return res.status(400).json({ error: "Recipient required" });

    const load = await ContainerLoad.findById(req.params.id);
    if (!load) return res.status(404).json({ error: "Not found" });

    await sendRawEmail({ to, cc, subject, body });

    load.emailSentAt = new Date();
    if (to !== LOADER_TO) load.loaderEmail = to;
    await load.save();

    res.json({ success: true });
  } catch (e) {
    console.error("[ContainerLoad] send-email error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/container-loads/:id/files — list Drive files for this load
router.get("/:id/files", async (req, res) => {
  try {
    const load = await ContainerLoad.findById(req.params.id).lean();
    if (!load) return res.status(404).json({ error: "Not found" });
    if (!load.driveFolderId) return res.json([]);
    const files = await listFilesInFolder(load.driveFolderId);
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/container-loads/:id/upload — upload a file to Drive
router.post("/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const load = await ContainerLoad.findById(req.params.id);
    if (!load) return res.status(404).json({ error: "Not found" });

    // Create Drive folder if missing
    if (!load.driveFolderId) {
      const folderName = `Container ${load.name}`;
      const folder = await createDriveFolder(folderName, CONTAINER_DOCS_FOLDER);
      load.driveFolderId   = folder.id;
      load.driveFolderLink = folder.webViewLink;
    }

    const uploaded = await uploadFileToDrive(
      req.file.path,
      req.file.originalname,
      req.file.mimetype,
      load.driveFolderId
    );
    try { fs.unlinkSync(req.file.path); } catch (_) {}

    const label = req.body.label || "Document";
    load.files.push({
      label,
      originalName: req.file.originalname,
      filename:     uploaded.name,
      driveFileId:  uploaded.id,
      driveUrl:     uploaded.webViewLink,
      mimetype:     req.file.mimetype,
    });
    await load.save();

    const populated = await ContainerLoad.findById(load._id).populate("orderIds").lean();
    res.json(populated);
  } catch (e) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch (_) {}
    console.error("[ContainerLoad] upload error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/container-loads/:id/files/:fileId
router.delete("/:id/files/:fileId", async (req, res) => {
  try {
    const load = await ContainerLoad.findById(req.params.id);
    if (!load) return res.status(404).json({ error: "Not found" });
    load.files = (load.files || []).filter(f => f.driveFileId !== req.params.fileId);
    await load.save();
    const populated = await ContainerLoad.findById(load._id).populate("orderIds").lean();
    res.json(populated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/container-loads/:id/parse-bl — parse BL/draft PDF and extract fields
router.post("/:id/parse-bl", express.json(), async (req, res) => {
  try {
    const { url, filename } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });

    // Fetch the file content from Drive
    const fileRes = await fetch(url.replace("/view", "/export?format=txt&").replace("open?id=", "export?id=").replace(/\/view.*/, "/export?format=txt"));
    let text = "";
    if (fileRes.ok) {
      text = await fileRes.text();
    }

    // If we couldn't get text via export, try the proxy
    if (!text || text.length < 50) {
      const proxyRes = await fetch(`https://drive.google.com/uc?export=download&id=${extractDriveId(url)}`);
      if (proxyRes.ok) text = await proxyRes.text();
    }

    // Parse key fields from the text
    const parsed = parseBLText(text, filename);
    res.json(parsed);
  } catch (e) {
    console.error("[ContainerLoad] parse-bl error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/container-loads/:id/parse-bl-file — parse uploaded file directly
router.post("/:id/parse-bl-file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });

    // Use pdf-parse if PDF, otherwise read as text
    let text = "";
    try {
      if (req.file.mimetype === "application/pdf") {
        const pdfParse = require("pdf-parse");
        const buf  = fs.readFileSync(req.file.path);
        const data = await pdfParse(buf);
        text = data.text || "";
      } else {
        text = fs.readFileSync(req.file.path, "utf8");
      }
    } finally {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }

    const parsed = parseBLText(text, req.file.originalname);
    res.json(parsed);
  } catch (e) {
    console.error("[ContainerLoad] parse-bl-file error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

function extractDriveId(url) {
  const m = url.match(/[-\w]{25,}/);
  return m ? m[0] : "";
}

function parseBLText(text, filename = "") {
  const t = text || "";
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const find = (...patterns) => {
    for (const pat of patterns) {
      for (const line of lines) {
        const m = line.match(pat);
        if (m) return (m[1] || m[0]).trim();
      }
    }
    return "";
  };

  // Container number: CNT: XXXX1234567 or CONTAINER: or just a 4-letter + 7-digit pattern
  const containerNumber =
    find(/CNT[:\s]+([A-Z]{4}\d{7})/i, /CONTAINER\s*(?:NO\.?|NUMBER)?[:\s]+([A-Z]{4}\d{7})/i) ||
    (t.match(/\b([A-Z]{4}\d{7})\b/)?.[1] || "");

  // Seal number
  const sealNumber = find(/SEAL[:\s]+(\S+)/i, /SEAL\s*NO\.?\s*[:\s]+(\S+)/i);

  // Booking / document number (5a B/L NUMBER or DOCUMENT NUMBER field)
  const bookingNumber = find(
    /(?:DOCUMENT\s+NUMBER|DOC\.?\s*NO\.?)[:\s]+(\S+)/i,
    /B\/?L\s*(?:NUMBER|NO\.?)[:\s]+(\S+)/i,
    /BOOKING\s*(?:NUMBER|NO\.?)[:\s]+(\S+)/i,
  ) || (t.match(/\b(\d{10})\b/)?.[1] || ""); // 10-digit booking numbers

  // Vessel
  const vessel = find(
    /(?:VESSEL|EXPORTING CARRIER)[:\s]+([A-Z][A-Z0-9 \/]+?)(?:\s+\d+E|\s*$)/im,
    /([A-Z]{3,}\s+[A-Z]{3,})\s*\/\s*\d+[A-Z]/,
  );

  // POL
  const pol = find(
    /PORT\s+OF\s+LOADING[\/\s]+EXPORT[:\s]+(.+)/i,
    /PORT\s+OF\s+LOADING[:\s]+(.+)/i,
  );

  // POD
  const pod = find(
    /FOREIGN\s+PORT\s+OF\s+UNLOADING[:\s]+(.+)/i,
    /PORT\s+OF\s+DISCHARGE[:\s]+(.+)/i,
    /PLACE\s+OF\s+DELIVERY[:\s]+(.+)/i,
  );

  // AES ITN
  const aesItn = find(/AES\s+ITN[:\s]+(\S+)/i, /ITN[:\s]+(X\d{14})/i);

  // VINs — 17-char alphanumeric
  const vins = [...new Set((t.match(/\bVIN[:\s]*([A-HJ-NPR-Z0-9]{17})\b/gi) || [])
    .map(v => v.replace(/VIN[:\s]*/i, "").trim()))];

  return {
    containerNumber: containerNumber.slice(0, 20),
    sealNumber:      sealNumber.slice(0, 20),
    bookingNumber:   bookingNumber.slice(0, 30),
    vessel:          vessel.slice(0, 60),
    pol:             pol.slice(0, 40),
    pod:             pod.slice(0, 40),
    aesItn:          aesItn.slice(0, 20),
    vins,
  };
}

// DELETE /api/container-loads/:id
router.delete("/:id", async (req, res) => {
  try {
    await ContainerLoad.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Email sender ──────────────────────────────────────────────────────────────
async function sendRawEmail({ to, cc, subject, body }) {
  const from = `Dor Ldor Global <${process.env.GMAIL_USER}>`;
  const mimeLines = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
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
  console.log(`[ContainerLoad] Email sent → ${to}${cc ? " (cc: "+cc+")" : ""}`);
}

module.exports = router;
module.exports.buildEmailDraft = buildEmailDraft;

// ── Draft builder (exported so frontend can also call GET /draft) ─────────────
function buildEmailDraft(load, orders) {
  const destination = (load.pod || "DESTINATION").toUpperCase();
  const pol         = (load.pol || "NJ").toUpperCase();
  const custName    = orders[0]?.customerName || "";
  const subject     = `${load.name} CONTAINER TO ${destination} - ${custName}`.trim();

  const cBlock = [
    "CONSIGNEE INFO",
    load.consigneeName    || "—",
    load.consigneeAddress || "—",
    load.consigneePhone   ? `TEL: ${load.consigneePhone}`   : null,
    load.consigneeEmail   ? `EMAIL: ${load.consigneeEmail}` : null,
    load.consigneeTin     ? `TIN#: ${load.consigneeTin}`    : null,
  ].filter(Boolean).join("\n");

  const nBlock = [
    "NOTIFY PARTY INFO",
    load.notifyName    || "—",
    load.notifyAddress || "—",
    load.notifyPhone   ? `TEL: ${load.notifyPhone}`   : null,
    load.notifyEmail   ? `EMAIL: ${load.notifyEmail}` : null,
    load.notifyTin     ? `TIN#: ${load.notifyTin}`    : null,
  ].filter(Boolean).join("\n");

  const unitLines = orders.map(o => {
    const ymm = [o.year, o.make, o.model].filter(Boolean).join(" ") || "—";
    return `${ymm}   ${o.vin || "—"}`;
  }).join("\n");

  const body = [
    `SEE ATTACHED LOAD LIST FOR CONTAINER TO ${destination}`,
    `PLEASE CONFIRM THIS UNIT AND ITS TITLE`,
    ``,
    cBlock,
    ``,
    nBlock,
    ``,
    unitLines,
    ``,
    `Thank you,`,
    `Dor Ldor Global`,
  ].join("\n");

  return { to: LOADER_TO, cc: LOADER_CC, subject, body };
}

// GET /api/container-loads/:id/email-draft
router.get("/:id/email-draft", async (req, res) => {
  try {
    const load = await ContainerLoad.findById(req.params.id).populate("orderIds").lean();
    if (!load) return res.status(404).json({ error: "Not found" });
    res.json(buildEmailDraft(load, load.orderIds));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
