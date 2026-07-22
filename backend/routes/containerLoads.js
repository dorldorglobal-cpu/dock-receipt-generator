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

// Lazily resolved parent folder: My Drive → Dor L'Dor Global → Container Loads
let _containerParentFolderId = null;
async function getContainerParentFolder() {
  if (_containerParentFolderId) return _containerParentFolderId;
  const { getOrCreateFolder } = require("../googleDrive");
  const rootId  = process.env.DDG_ROOT_FOLDER_ID || "root";
  const ddgId   = await getOrCreateFolder("Dor L'Dor Global", rootId);
  const clId    = await getOrCreateFolder("Container Loads", ddgId.id || ddgId);
  _containerParentFolderId = clId.id || clId;
  return _containerParentFolderId;
}

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
      .select("_id refNumber customerName customerEmail year make model vin status charges").lean();

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

      // Include ocean freight cost from order.charges if set and no matching Expense record
      const syntheticExps = [...exps];
      const oceanCost = Number((o.charges || {}).oceanCost || 0);
      if (oceanCost > 0) {
        const alreadyHasOcean = exps.some(e => /ocean\s*freight/i.test(e.category || ""));
        if (!alreadyHasOcean) {
          syntheticExps.push({
            _id: null,
            vendor: "Ocean Freight (est.)",
            category: "Ocean Freight",
            amount: oceanCost,
            status: "unpaid",
            description: "Ocean freight cost from order charges",
            _synthetic: true,
          });
        }
      }

      const totalExpenses = syntheticExps.reduce((s, e) => s + (e.amount || 0), 0);
      const invoiceTotal  = inv?.total || 0;
      return {
        orderId:       o._id,
        refNumber:     o.refNumber,
        customerName:  o.customerName,
        customerEmail: (inv?.customerEmail || o.customerEmail || "").split(",")[0].trim(),
        vehicle:       [o.year, o.make, o.model].filter(Boolean).join(" "),
        vin:           o.vin,
        orderStatus:   o.status,
        expenses:      syntheticExps,
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

    // Generate all invoice PDFs
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

    // Attach Draft BL — check load files first, then fall back to any order's files
    try {
      const { downloadDriveFile } = require("../googleDrive");
      const fs = require("fs");
      const os = require("os");

      // Match by label OR by filename containing "draft"
      const isDraft = f => /^draft/i.test(f.label || "") || /draft/i.test(f.originalName || "") || /draft/i.test(f.filename || "");
      let draftFile = (load.files || []).find(isDraft);
      if (!draftFile) {
        for (const o of orders) {
          draftFile = (o.files || []).find(isDraft);
          if (draftFile) break;
        }
      }

      if (draftFile?.driveFileId) {
        const tmpPath = require("path").join(os.tmpdir(), `draft-bl-${Date.now()}.pdf`);
        await downloadDriveFile(draftFile.driveFileId, tmpPath);
        const buf = fs.readFileSync(tmpPath);
        fs.unlinkSync(tmpPath);
        attachments.push({ filename: draftFile.originalName || "Draft-BL.pdf", content: buf.toString("base64") });
      }
    } catch (draftErr) {
      console.warn("[send-all-invoices] Could not attach Draft BL:", draftErr.message);
    }

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

    const draftAttached = attachments.some(a => /draft/i.test(a.filename));
    res.json({ sent: invoices.length, to, attachments: attachments.map(a => a.filename), draftAttached });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/container-loads/:id/send-combined-invoice — merge all invoices into one PDF and send
router.post("/:id/send-combined-invoice", express.json(), async (req, res) => {
  try {
    const Invoice = require("../models/Invoice");
    const { getGmailAccessToken } = require("../utils/gmail");
    const { generateInvoicePdf } = require("./invoices");
    const { PDFDocument } = require("pdf-lib");
    const { google } = require("googleapis");

    const { to, subject, body } = req.body || {};
    if (!to) return res.status(400).json({ error: "to is required" });

    const load = await ContainerLoad.findById(req.params.id).lean();
    if (!load) return res.status(404).json({ error: "Not found" });

    const invoices = await Invoice.find({ orderId: { $in: load.orderIds }, status: { $ne: "paid" } }).lean();
    const orders   = await Order.find({ _id: { $in: load.orderIds } }).lean();
    const orderMap = {};
    for (const o of orders) orderMap[String(o._id)] = o;

    // Generate individual invoice PDFs then merge into one
    const merged = await PDFDocument.create();
    for (const inv of invoices) {
      try {
        const order = orderMap[String(inv.orderId)] || null;
        const pdfBuf = await generateInvoicePdf(inv, order);
        const src = await PDFDocument.load(pdfBuf);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      } catch (err) {
        console.warn(`PDF gen failed for ${inv.invoiceNumber}:`, err.message);
      }
    }

    if (merged.getPageCount() === 0) return res.status(400).json({ error: "No invoices to send" });

    const mergedBytes = await merged.save();
    const mergedBase64 = Buffer.from(mergedBytes).toString("base64");
    const mergedFilename = `Combined-Invoice-Load-${load.name}.pdf`;

    const attachments = [{ filename: mergedFilename, content: mergedBase64 }];

    // Build MIME email
    const from     = `Dor Ldor Global <${process.env.GMAIL_USER}>`;
    const boundary = "DDG_COMB_" + Date.now();
    const mimeLines = [
      `From: ${from}`, `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``, `--${boundary}`, `Content-Type: text/plain; charset="UTF-8"`, ``,
      body || "", ``,
      `--${boundary}`,
      `Content-Type: application/pdf; name="${mergedFilename}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${mergedFilename}"`,
      ``, mergedBase64, ``,
      `--${boundary}--`,
    ];

    const raw = Buffer.from(mimeLines.join("\r\n")).toString("base64url");
    const accessToken = await getGmailAccessToken();
    const gmail = google.gmail("v1");
    const auth  = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    await gmail.users.messages.send({ userId: "me", requestBody: { raw }, auth });

    for (const inv of invoices) {
      await Invoice.findByIdAndUpdate(inv._id, {
        $set: { status: "sent", sentAt: new Date() },
        $push: { timeline: { action: "Invoice Sent", details: `Sent as combined PDF for load ${load.name}`, createdAt: new Date() } },
      });
    }

    res.json({ sent: invoices.length, to, filename: mergedFilename });
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

// GET /api/container-loads/:id/files — list Drive files merged with stored labels
router.get("/:id/files", async (req, res) => {
  try {
    const load = await ContainerLoad.findById(req.params.id).lean();
    if (!load) return res.status(404).json({ error: "Not found" });
    if (!load.driveFolderId) return res.json([]);
    const driveFiles = await listFilesInFolder(load.driveFolderId);
    // Merge Drive metadata with stored labels from MongoDB
    const labelMap = {};
    for (const f of (load.files || [])) {
      if (f.driveFileId) labelMap[f.driveFileId] = f.label || "Document";
    }
    const merged = driveFiles.map(f => ({ ...f, label: labelMap[f.id] || "Document" }));
    res.json(merged);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/container-loads/:id/files/:fileId/label — update a file's label
router.patch("/:id/files/:fileId/label", express.json(), async (req, res) => {
  try {
    const { label } = req.body;
    if (!label) return res.status(400).json({ error: "label required" });
    const load = await ContainerLoad.findById(req.params.id);
    if (!load) return res.status(404).json({ error: "Not found" });
    const f = (load.files || []).find(f => f.driveFileId === req.params.fileId);
    if (f) { f.label = label; await load.save(); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/container-loads/:id/email-draft-bl — email Draft BL to customers
router.post("/:id/email-draft-bl", express.json(), async (req, res) => {
  try {
    const { to, subject, body } = req.body || {};
    if (!to) return res.status(400).json({ error: "to is required" });

    const load = await ContainerLoad.findById(req.params.id).lean();
    if (!load) return res.status(404).json({ error: "Not found" });

    // Find Draft BL file
    const isDraft = f => /^draft/i.test(f.label || "");
    const draftFile = (load.files || []).find(isDraft);
    if (!draftFile?.driveFileId) return res.status(400).json({ error: "No Draft BL found in this load's docs" });

    // Download Draft BL from Drive
    const { downloadDriveFile } = require("../googleDrive");
    const fsNode = require("fs");
    const os     = require("os");
    const tmpPath = require("path").join(os.tmpdir(), `draft-bl-${Date.now()}.pdf`);
    await downloadDriveFile(draftFile.driveFileId, tmpPath);
    const draftBuf = fsNode.readFileSync(tmpPath);
    fsNode.unlinkSync(tmpPath);

    // Send via Gmail
    const { getGmailAccessToken } = require("../utils/gmail");
    const { google } = require("googleapis");
    const from     = `Dor Ldor Global <${process.env.GMAIL_USER}>`;
    const boundary = "DDG_DRAFTBL_" + Date.now();
    const mimeLines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject || "Draft BL").toString("base64")}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      body || "",
      ``,
      `--${boundary}`,
      `Content-Type: application/pdf; name="${draftFile.originalName || "Draft-BL.pdf"}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${draftFile.originalName || "Draft-BL.pdf"}"`,
      ``,
      draftBuf.toString("base64"),
      ``,
      `--${boundary}--`,
    ];
    const raw = Buffer.from(mimeLines.join("\r\n")).toString("base64url");
    const accessToken = await getGmailAccessToken();
    const gmail = google.gmail("v1");
    const auth  = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    await gmail.users.messages.send({ userId: "me", requestBody: { raw }, auth });

    res.json({ ok: true, to });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/container-loads/:id/upload — upload a file to Drive
router.post("/:id/upload", upload.single("file"), async (req, res) => {
  try {
    const load = await ContainerLoad.findById(req.params.id);
    if (!load) return res.status(404).json({ error: "Not found" });

    // Create Drive folder if missing — nested under Dor L'Dor Global → Container Loads
    if (!load.driveFolderId) {
      const parentId = await getContainerParentFolder();
      const folderName = `Container ${load.name}`;
      const folder = await createDriveFolder(folderName, parentId);
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
  const clean = (s, max = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, max);

  const inline = (...patterns) => {
    for (const pat of patterns) {
      for (const line of lines) {
        const m = line.match(pat);
        if (m?.[1]) return m[1].trim();
      }
    }
    return "";
  };

  // ── Container number: 4 uppercase letters + 7 digits (ISO 6346) ──────────────
  let containerNumber =
    inline(/(?:CNTR?|CONTAINER)\s*(?:NO|NUMBER|#)[.:\s]+([A-Z]{4}\d{7})/i) ||
    (t.match(/\b([A-Z]{4}\d{7})\b/)?.[1] || "");
  // Hapag-Lloyd: "FANU  3598398" has double space — scan lines explicitly
  if (!containerNumber) {
    for (const line of lines) {
      const m = line.match(/\b([A-Z]{4})\s+(\d{7})\b/);
      if (m) { containerNumber = m[1] + m[2]; break; }
    }
  }

  // ── Seal: "SEAL: XXXXXXX" or after container on same line "SEKU4051437 /46048962/" ──
  let sealNumber = inline(/SEAL\s*(?:NO|NUMBER|#)?[.:\s]+(\d{5,})/i);
  if (!sealNumber && containerNumber) {
    for (const line of lines) {
      if (line.includes(containerNumber)) {
        const after = line.slice(line.indexOf(containerNumber) + containerNumber.length);
        const m = after.match(/[\/\s]+(\d{6,})/);
        if (m) { sealNumber = m[1]; break; }
      }
    }
  }
  // Hapag-Lloyd: "SEAL:\n120182" — label on one line, number on next
  if (!sealNumber) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^SEAL:?\s*$/i.test(lines[i])) {
        const m = lines[i + 1].match(/^(\d{5,})$/);
        if (m) { sealNumber = m[1]; break; }
      }
    }
  }

  // ── Booking number ────────────────────────────────────────────────────────────
  // Format A (OOCL): "BOOKING NO." header, numeric value on next line
  // Format B: "BOOKING NO: 2331483910" inline
  // Format C (Sallaum): "5. DOCUMENT NUMBER: XXXXX"
  // Format D (Hapag-Lloyd): "B/L-No. HLCUBSC2607BEAK3" alphanumeric
  let bookingNumber = inline(/BOOKING\s*(?:NO|NUMBER|#)[.:\s]+(\d{7,12})/i);
  if (!bookingNumber) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (/BOOKING\s*NO/i.test(lines[i])) {
        const m = lines[i + 1].match(/(?<![A-Z])(\d{7,12})(?!\d)/);
        if (m) { bookingNumber = m[1]; break; }
      }
    }
  }
  // Alphanumeric B/L number (Hapag-Lloyd, MSC, etc.)
  if (!bookingNumber) bookingNumber =
    inline(/B\/L[-\s]*No\.?\s+([A-Z0-9]{8,25})/i) ||
    inline(/B\/L\s*(?:NUMBER|NO|#)[.:\s]+([A-Z0-9]{6,25})/i) ||
    inline(/(?:5\.\s*DOCUMENT\s+NUMBER|DOCUMENT\s+NUMBER)[:\s]*(\S+)/i) ||
    inline(/B\/?L\s*(?:NUMBER|NO)[:\s]*(\S+)/i) ||
    (t.match(/\b(\d{10})\b/)?.[1] || "");
  // Hapag-Lloyd: "B/L-No." label alone on line, value appears many lines later as "HLCxxxPage"
  if (!bookingNumber) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^B\/L[-\s]*No\.?$/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
          const m = lines[j].match(/^([A-Z0-9]{12,20}?)(?:Page\d*)?$/);
          if (m) { bookingNumber = m[1]; break; }
        }
        break;
      }
    }
  }

  // ── Vessel + Voyage ───────────────────────────────────────────────────────────
  // Format A (OOCL page 2): "VESSEL: CMA CGM AMBITION VOYAGE: 013E B/L NO.: OOLU..."
  // Format B (OOCL page 1): line after "VESSEL/VOYAGE/FLAG..." header:
  //   "CMA CGM AMBITION 013E NEW YORK NEW YORK"  (vessel voyageCode POL POL)
  // Format C (slash style): "OOCL SEOUL / 120E New York"

  let vessel = "", voyage = "", pol = "";

  // Format A — "VESSEL [NAME]: X VOYAGE: Y" on same line (must have actual value after VESSEL keyword)
  const inlineVV = lines.find(l =>
    /VESSEL[:\s]/i.test(l) && /VOYAGE[:\s]/i.test(l) &&
    /VESSEL(?:\s+\w+)?[:\s]+[A-Z]/i.test(l)  // guard: must have a capital letter value after VESSEL
  );
  if (inlineVV) {
    // handles both "VESSEL: X VOYAGE: Y" and "VESSEL NAME: X VOYAGE: Y"
    const m = inlineVV.match(/VESSEL(?:\s+\w+)?[:\s]+([A-Z][A-Z0-9 \-]+?)\s+VOYAGE[:\s]+(\S+)/i);
    if (m) { vessel = m[1].trim(); voyage = m[2].trim(); }
  }

  // Format B — line immediately after a header row containing both VESSEL and VOYAGE
  // handles: "VESSEL/VOYAGE/FLAG", "Vessel(s): Voyage-No.:", etc.
  if (!vessel) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (/VESSEL/i.test(lines[i]) && /VOYAGE/i.test(lines[i]) && !/JAMAICA|EXPRESS|CMA|OOCL/i.test(lines[i])) {
        const val = lines[i + 1];
        // Skip if next line is clearly a form field label (has lowercase letters or colons), not a vessel name
        if (/[a-z]|:/.test(val)) continue;
        // Voyage code pattern: e.g. 013E, 629E, 120W, 526S
        const m = val.match(/^((?:[A-Z][A-Z0-9 \-]*?)+?)\s+(\d{3}[A-Z]\d*|[A-Z]{0,2}\d{3,4}[A-Z]?)\s*(.*)?$/);
        if (m) {
          vessel = m[1].trim();
          voyage = m[2].trim();
          pol    = (m[3] || "").trim();
        } else {
          vessel = val.trim();
        }
        break;
      }
    }
  }

  // Format C — slash-separated "VESSEL / VOYAGE [POL]"
  if (!vessel) {
    for (const line of lines) {
      const m = line.match(/^([A-Z][A-Z0-9 \-]{2,}?)\s*\/\s*([A-Z0-9]*\d[A-Z0-9]*)(?:\s+(.+))?$/);
      if (m) {
        vessel = m[1].trim();
        voyage = m[2].trim();
        pol    = (m[3] || "").trim();
        break;
      }
    }
  }

  // If pol looks like "NEW YORK NEW YORK" (doubled two-column merge), de-dup it
  if (pol) {
    const words = pol.trim().split(/\s+/);
    const h = words.length / 2;
    if (Number.isInteger(h) && h > 0 && words.slice(0, h).join(" ") === words.slice(h).join(" "))
      pol = words.slice(0, h).join(" ");
  }

  // ── POL fallback ──────────────────────────────────────────────────────────────
  if (!pol && vessel) {
    // The vessel line often contains: "VESSEL VOYAGE POL [POL]"
    // Find that line and strip out the known vessel+voyage to get the city
    const vesselBase = vessel.replace(` ${voyage}`, "").trim();
    for (const line of lines) {
      if (line.startsWith(vesselBase) && line.includes(voyage)) {
        const rest = line.slice(line.indexOf(voyage) + voyage.length).trim();
        if (rest) {
          // "NEW YORK NEW YORK" → de-dup → "NEW YORK"
          const words = rest.split(/\s+/);
          const h = Math.floor(words.length / 2);
          pol = (h > 0 && words.slice(0, h).join(" ") === words.slice(h).join(" "))
            ? words.slice(0, h).join(" ")
            : words.slice(0, Math.min(words.length, 3)).join(" "); // first 1-3 words
        }
        break;
      }
    }
  }
  if (!pol) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (/PORT\s+OF\s+LOADING/i.test(lines[i]) && !/DISCHARGE/i.test(lines[i])) {
        // Same-line: "PORT OF LOADING: HOUSTON, TX"
        const same = lines[i].match(/PORT\s+OF\s+LOADING[:\s]+([A-Z][A-Z0-9 ,]+)/i);
        if (same) { pol = same[1].trim().replace(/,\s*$/, ""); break; }
        // Next line: "Port of Loading:\nHOUSTON, TX"
        const next = lines[i + 1];
        if (next && /^[A-Z]/.test(next) && next.length < 60 && !/DISCHARGE|DELIVERY|NUMBER/i.test(next)) {
          pol = next.trim(); break;
        }
      }
    }
  }

  // ── POD: "PORT OF DISCHARGE" section ─────────────────────────────────────────
  let pod = "";
  for (let i = 0; i < lines.length; i++) {
    if (/PORT\s+OF\s+DISCHARGE/i.test(lines[i])) {
      // Same-line: "PORT OF DISCHARGE: TINCAN/LAGOS"
      const same = lines[i].match(/PORT\s+OF\s+DISCHARGE[:\s]+([A-Z][A-Z0-9\/\- ]+)/i);
      const raw = same ? same[1].trim() : (lines[i + 1] || "").trim();
      if (!raw) continue;
      // Skip if raw looks like a form field label (has lowercase or colons)
      if (/[a-z]|:/.test(raw)) continue;
      // "TINCAN/LAGOS" → take last segment after slash (actual port city)
      let candidate = raw.includes("/") ? raw.split("/").pop().trim() : raw;
      const words = candidate.split(/\s+/);
      // "TEMA TEMA FCL/FCL" → de-dup; strip FCL/CY suffixes
      if (words[0] === words[1]) candidate = words[0];
      candidate = candidate.replace(/\s*(FCL|CY\/CY|DCL|CY).*/i, "").trim();
      if (candidate && candidate.length > 1) { pod = candidate; break; }
    }
  }
  // Fallback for numbered-field formats
  if (!pod) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (/16\.\s*FOREIGN\s*PORT/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          if (!/^\d+\.\s+[A-Z]/.test(lines[j]) && lines[j].length > 1 && lines[j].length < 60) {
            pod = lines[j]; break;
          }
        }
        break;
      }
    }
  }
  // Hapag-Lloyd fallback: "TINCAN/LAGOS" standalone line — take last segment after slash
  if (!pod) {
    for (const line of lines) {
      if (/^[A-Z]{2,}\/[A-Z]{2,}$/.test(line) && !/FCL|DCL|CY|CFS/i.test(line)) {
        pod = line.split("/").pop().trim();
        break;
      }
    }
  }

  // ── Combine vessel + voyage for display ──────────────────────────────────────
  const vesselFull = vessel && voyage ? `${vessel} ${voyage}` : vessel;

  // ── AES ITN ───────────────────────────────────────────────────────────────────
  const aesItn = inline(/AES\s+ITN[:\s]+(\S+)/i) || inline(/ITN[:\s]+(X\d{14})/i);

  // ── VINs — 17-char ────────────────────────────────────────────────────────────
  const vins = [...new Set((t.match(/\bVIN[:\s]*([A-HJ-NPR-Z0-9]{17})\b/gi) || [])
    .map(v => v.replace(/VIN[:\s]*/i, "").trim()))];

  return {
    containerNumber: clean(containerNumber, 20),
    sealNumber:      clean(sealNumber, 20),
    bookingNumber:   clean(bookingNumber, 30),
    vessel:          clean(vesselFull, 60),
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
