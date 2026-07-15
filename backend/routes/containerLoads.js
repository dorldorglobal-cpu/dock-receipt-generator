const express = require("express");
const router  = express.Router();
const multer  = require("multer");
const fs      = require("fs");
const path    = require("path");
const ContainerLoad = require("../models/ContainerLoad");
const Order         = require("../models/Order");
const { getGmailAccessToken } = require("../utils/gmail");
const {
  drive,
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
      "bookingNumber","containerNumber","sealNumber","sailCutoff","arrivalDate","status",
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

// GET /api/container-loads/:id/billing-summary — expenses + invoice per order in load
router.get("/:id/billing-summary", async (req, res) => {
  try {
    const Expense = require("../models/Expense");
    const Invoice = require("../models/Invoice");

    const load = await ContainerLoad.findById(req.params.id).lean();
    if (!load) return res.status(404).json({ error: "Not found" });

    const orders = await Order.find({ _id: { $in: load.orderIds } })
      .select("_id refNumber customerName customerEmail year make model vin status").lean();

    const orderIds = orders.map(o => o._id);

    const [expenses, invoices] = await Promise.all([
      Expense.find({ orderId: { $in: orderIds } }).select("orderId category vendor amount status description").lean(),
      Invoice.find({ orderId: { $in: orderIds } }).select("orderId invoiceNumber total status paidAt items customerEmail").lean(),
    ]);

    const expByOrder = {};
    for (const e of expenses) {
      const key = String(e.orderId);
      if (!expByOrder[key]) expByOrder[key] = [];
      expByOrder[key].push(e);
    }
    const invByOrder = {};
    for (const i of invoices) {
      invByOrder[String(i.orderId)] = i;
    }

    const rows = orders.map(o => {
      const key = String(o._id);
      const exps = expByOrder[key] || [];
      const inv  = invByOrder[key] || null;
      const totalExpenses = exps.reduce((s, e) => s + (e.amount || 0), 0);
      const invoiceTotal  = inv?.total || 0;
      return {
        orderId:       o._id,
        refNumber:     o.refNumber,
        customerName:  o.customerName,
        customerEmail: (inv?.customerEmail || o.customerEmail || "").split(",")[0].trim(),
        vehicle:       [o.year, o.make, o.model].filter(Boolean).join(" "),
        vin:           o.vin,
        orderStatus:   o.status,
        expenses:      exps,
        totalExpenses,
        invoice:       inv,
        invoiceTotal,
        profit:        invoiceTotal - totalExpenses,
      };
    });

    res.json({ load, rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/container-loads/:id/send-all-invoices — send invoices for all orders in load
router.post("/:id/send-all-invoices", express.json(), async (req, res) => {
  try {
    const Invoice = require("../models/Invoice");
    const { getGmailAccessToken } = require("../utils/gmail");
    const { generateInvoicePdf } = require("./invoices");
    const { google } = require("googleapis");

    const { to, subject, body } = req.body || {};
    if (!to) return res.status(400).json({ error: "to is required" });

    const load = await ContainerLoad.findById(req.params.id).lean();
    if (!load) return res.status(404).json({ error: "Not found" });

    const invoices = await Invoice.find({ orderId: { $in: load.orderIds }, status: { $ne: "paid" } }).lean();
    const orders   = await Order.find({ _id: { $in: load.orderIds } }).lean();
    const orderMap = {};
    for (const o of orders) orderMap[String(o._id)] = o;

    // Generate all PDFs
    const attachments = [];
    for (const inv of invoices) {
      try {
        const order = orderMap[String(inv.orderId)] || null;
        const pdfBuf = await generateInvoicePdf(inv, order);
        attachments.push({ filename: `Invoice-${inv.invoiceNumber}.pdf`, content: pdfBuf.toString("base64") });
      } catch (err) {
        console.warn(`PDF gen failed for ${inv.invoiceNumber}:`, err.message);
      }
    }

    if (!attachments.length) return res.status(400).json({ error: "No invoices to send" });

    // Build one MIME email with all PDFs attached
    const from     = `Dor Ldor Global <${process.env.GMAIL_USER}>`;
    const boundary = "DDG_LOAD_" + Date.now();

    const mimeLines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      body || "",
      ``,
    ];

    for (const att of attachments) {
      mimeLines.push(
        `--${boundary}`,
        `Content-Type: application/pdf; name="${att.filename}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        ``,
        att.content,
        ``
      );
    }
    mimeLines.push(`--${boundary}--`);

    const raw = Buffer.from(mimeLines.join("\r\n")).toString("base64url");
    const accessToken = await getGmailAccessToken();
    const gmail = google.gmail("v1");
    const auth  = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    await gmail.users.messages.send({ userId: "me", requestBody: { raw }, auth });

    // Mark all sent invoices
    for (const inv of invoices) {
      await Invoice.findByIdAndUpdate(inv._id, {
        $set: { status: "sent", sentAt: new Date() },
        $push: { timeline: { action: "Invoice Sent", details: `Sent in bulk email for container load ${load.name}`, createdAt: new Date() } },
      });
    }

    res.json({ sent: invoices.length, to, attachments: attachments.map(a => a.filename) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/container-loads/by-order/:orderId — find which load contains this order
router.get("/by-order/:orderId", async (req, res) => {
  try {
    const load = await ContainerLoad.findOne({ orderIds: req.params.orderId }).lean();
    if (!load) return res.json(null);
    res.json({ _id: load._id, name: load.name, vessel: load.vessel, pol: load.pol, pod: load.pod,
      containerNumber: load.containerNumber, bookingNumber: load.bookingNumber, status: load.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

    // Auto-parse PDFs before uploading (read file while still on disk)
    let parsed = null;
    if (/pdf/i.test(req.file.mimetype)) {
      try {
        const pdfParse = require("pdf-parse");
        const buf  = fs.readFileSync(req.file.path);
        const data = await pdfParse(buf);
        const rawText = data.text || "";
        parsed = { ...parseBLText(rawText, req.file.originalname), _rawLines: rawText.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).slice(0,80) };
      } catch (_) { /* non-fatal */ }
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
    res.json({ ...populated, parsed });
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
    // Delete from Google Drive
    try { await drive.files.delete({ fileId: req.params.fileId }); } catch (_) {}
    load.files = (load.files || []).filter(f => f.driveFileId !== req.params.fileId);
    await load.save();
    const populated = await ContainerLoad.findById(load._id).populate("orderIds").lean();
    res.json(populated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/container-loads/:id/files/:fileId/rename
router.patch("/:id/files/:fileId/rename", express.json(), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    await drive.files.update({ fileId: req.params.fileId, requestBody: { name } });
    // Update name in load.files array too
    const load = await ContainerLoad.findById(req.params.id);
    if (load) {
      const f = (load.files || []).find(f => f.driveFileId === req.params.fileId);
      if (f) { f.filename = name; f.originalName = name; await load.save(); }
    }
    res.json({ success: true });
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

    const parsed = { ...parseBLText(text, req.file.originalname), _rawLines: text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).slice(0,80) };
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

  // Find value on the line AFTER the line matching a pattern
  const lineAfter = (...patterns) => {
    for (const pat of patterns) {
      for (let i = 0; i < lines.length - 1; i++) {
        if (pat.test(lines[i])) {
          const next = lines[i + 1].trim();
          if (next && next.length < 80) return next;
        }
      }
    }
    return "";
  };

  // Find inline value on same line
  const inline = (...patterns) => {
    for (const pat of patterns) {
      for (const line of lines) {
        const m = line.match(pat);
        if (m?.[1]) return m[1].trim();
      }
    }
    return "";
  };

  // Container: CNT: XXXX1234567
  const containerNumber =
    inline(/CNT[:\s]+([A-Z]{4}\d{7})/i) ||
    (t.match(/\b([A-Z]{4}\d{7})\b/)?.[1] || "");

  // Seal
  const sealNumber = inline(/SEAL[:\s]+(\S+)/i);

  // Booking / BL number — 10-digit number is most reliable
  const bookingNumber =
    inline(/(?:5\.\s*DOCUMENT\s+NUMBER|DOCUMENT\s+NUMBER)[:\s]*(\S+)/i) ||
    inline(/B\/?L\s*(?:NUMBER|NO)[:\s]*(\S+)/i) ||
    (t.match(/\b(\d{10})\b/)?.[1] || "");

  // Vessel + POL: In BL format the vessel line is "VESSELNAME / VOYAGEcode PORTCITY"
  // e.g. "OOCL SEOUL / 120E New York"
  // Voyage code always contains digits (120E, 526E, 0526) — this distinguishes it
  // from junk like "NOTIFY PARTY / INTERMEDIATE"
  let vessel = "", pol = "";
  for (const line of lines) {
    // Voyage code must contain a digit (120E, 526E, 0526) — filters out "NOTIFY PARTY / INTERMEDIATE"
    // City/POL is optional on the same line (may appear on the next line instead)
    const m = line.match(/^([A-Z][A-Z0-9 \-]{2,}?)\s*\/\s*([A-Z0-9]*\d[A-Z0-9]*)(?:\s+(.+))?$/);
    if (m) {
      vessel = `${m[1].trim()} / ${m[2].trim()}`;
      pol    = (m[3] || "").trim(); // city name appears after voyage code on same line
      break;
    }
  }

  // POD: usually the line right after the vessel line, sometimes repeated ("Tema Tema")
  let pod = "";
  for (let i = 0; i < lines.length - 1; i++) {
    if (vessel && lines[i].startsWith(vessel.split(" /")[0].trim())) {
      for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j++) {
        let candidate = lines[j].split(/\s+/)[0]; // first word (handles "Tema Tema")
        // Handle pdf-parse merging two-column duplicate like "TemaTema" → "Tema"
        const half = candidate.length / 2;
        if (half === Math.floor(half) && candidate.slice(0, half) === candidate.slice(half)) {
          candidate = candidate.slice(0, half);
        }
        if (/^[A-Z][a-z]/.test(candidate) && candidate.length > 2 &&
            !/CNT:|SEAL:|VIN:|NYCT|HS CODE|FREIGHT|SEAWAY/i.test(lines[j])) {
          pod = candidate;
          break;
        }
      }
      break;
    }
  }
  // If POL wasn't on the vessel line, try the line immediately after vessel in the text
  if (vessel && !pol) {
    const vi = lines.findIndex(l => l.startsWith(vessel.split(" /")[0].trim()));
    if (vi >= 0 && vi < lines.length - 1) {
      const cand = lines[vi + 1];
      if (/^[A-Z]/.test(cand) && cand.length < 40 && !/^\d+\./.test(cand)) pol = cand.trim();
    }
  }
  // Fallback: skip lines that look like numbered field labels (^\d+\. WORD...)
  const valueAfter = (...patterns) => {
    for (const pat of patterns) {
      for (let i = 0; i < lines.length - 1; i++) {
        if (pat.test(lines[i])) {
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const next = lines[j];
            if (!/^\d+\.\s+[A-Z]/.test(next) && next.length > 1 && next.length < 60) return next;
          }
        }
      }
    }
    return "";
  };
  if (!pol) pol = valueAfter(/15\.\s*PORT\s*OF\s*LOADING/i);
  if (!pod) pod = valueAfter(/16\.\s*FOREIGN\s*PORT/i);

  // AES ITN
  const aesItn = inline(/AES\s+ITN[:\s]+(\S+)/i) || inline(/ITN[:\s]+(X\d{14})/i);

  // VINs — 17-char
  const vins = [...new Set((t.match(/\bVIN[:\s]*([A-HJ-NPR-Z0-9]{17})\b/gi) || [])
    .map(v => v.replace(/VIN[:\s]*/i, "").trim()))];

  const clean = (s, max = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, max);

  return {
    containerNumber: clean(containerNumber, 20),
    sealNumber:      clean(sealNumber, 20),
    bookingNumber:   clean(bookingNumber, 30),
    vessel:          clean(vessel, 60),
    pol:             clean(pol, 40),
    pod:             clean(pod, 40),
    aesItn:          clean(aesItn, 20),
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
