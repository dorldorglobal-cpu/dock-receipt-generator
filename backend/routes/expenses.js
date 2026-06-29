const express      = require("express");
const router       = express.Router();
const multer       = require("multer");
const path         = require("path");
const fs           = require("fs");
const crypto       = require("crypto");
const { execFile } = require("child_process");
const pdfParse     = require("pdf-parse");
const Expense      = require("../models/Expense");
const Order        = require("../models/Order");
const { uploadBufferToDrive, getOrCreateFolder, deleteDriveFile } = require("../googleDrive");

const TEMP_DIR     = path.join(__dirname, "..", "temp");
const HIGHLIGHT_PY = path.join(__dirname, "..", "highlight_pdf.py");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Run highlight_pdf.py to add a yellow annotation on the VIN row
function highlightVinInPdf(inputPath, outputPath, vin) {
  return new Promise((resolve, reject) => {
    execFile("python3", [HIGHLIGHT_PY, inputPath, outputPath, vin], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(outputPath);
    });
  });
}

// ── Google Drive folders for expenses ────────────────────────────────────────
const DRIVE_RECEIPTS_FOLDER = "1zS9GARKen1KMucPSlm7ags9lq5LhS_Fv"; // Website > Expenses > Receipts
const DRIVE_BILLS_FOLDER    = "1QJuyyxY8Uumc7Zvhu1UUxqoTk67AbUTJ"; // Website > Expenses > Bills

// ── Upload to Drive helper ────────────────────────────────────────────────────
// If tied to an order, upload to that order's Drive folder; else use Expenses fallback
async function uploadFileToDriveExpenses(buffer, originalName, mimeType, type = "bill", orderId = null) {
  let folderId = type === "receipt" ? DRIVE_RECEIPTS_FOLDER : DRIVE_BILLS_FOLDER;

  if (orderId) {
    try {
      const order = await Order.findById(orderId).select("driveFolderId").lean();
      if (order?.driveFolderId) folderId = order.driveFolderId;
    } catch {}
  }

  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const ext = path.extname(originalName) || ".pdf";
  const fileName = unique + ext;
  return await uploadBufferToDrive(buffer, fileName, mimeType, folderId);
}

// ── Multer — memory storage (no local disk) ───────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|webp/i;
    if (allowed.test(path.extname(file.originalname)) && allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images and PDFs are allowed"));
    }
  },
});

const uploadFields = upload.fields([
  { name: "receipt", maxCount: 1 },
  { name: "bill",    maxCount: 1 },
]);

const esc = (s) => (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Legacy local file cleanup (for old records)
const uploadDir = path.join(__dirname, "../uploads/receipts");
function deleteFile(filename) {
  if (!filename) return;
  const p = path.join(uploadDir, filename);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

// ── GET /api/expenses — list with filters ─────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { search, category, status, from, to, orderRef } = req.query;
    const q = {};

    if (category) q.category = category;
    if (status)   q.status   = status;
    if (orderRef) q.orderRef = { $regex: `^${esc(orderRef)}$`, $options: "i" };
    if (from || to) {
      q.date = {};
      if (from) q.date.$gte = new Date(from);
      if (to)   q.date.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }
    if (search) {
      const v = esc(search);
      q.$or = [
        { description:   { $regex: v, $options: "i" } },
        { vendor:        { $regex: v, $options: "i" } },
        { orderRef:      { $regex: v, $options: "i" } },
        { invoiceNumber: { $regex: v, $options: "i" } },
        { notes:         { $regex: v, $options: "i" } },
      ];
    }

    const expenses = await Expense.find(q).sort({ date: -1, createdAt: -1 })
      .populate("orderId", "bookingNumber vin")
      .lean();
    res.json(expenses);
  } catch (err) {
    console.error("Expenses list error:", err);
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
});

// ── GET /api/expenses/summary — totals ────────────────────────────────────────
router.get("/summary", async (req, res) => {
  try {
    const all = await Expense.find({}).lean();

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalUnpaid = 0, totalPaidMonth = 0, totalAllTime = 0;
    const byCategory = {};

    for (const e of all) {
      totalAllTime += e.amount;
      if (e.status === "unpaid")  totalUnpaid += e.amount;
      if (e.status === "partial") totalUnpaid += (e.amount - (e.paidAmount || 0)); // remaining balance
      if (e.status === "paid" && e.paidDate && new Date(e.paidDate) >= monthStart) {
        totalPaidMonth += e.amount;
      }
      if (!byCategory[e.category]) byCategory[e.category] = 0;
      byCategory[e.category] += e.amount;
    }

    res.json({ totalUnpaid, totalPaidMonth, totalAllTime, byCategory, count: all.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

// ── GET /api/expenses/export — download as CSV ────────────────────────────────
router.get("/export", async (req, res) => {
  try {
    const { search, category, status, from, to, orderRef } = req.query;
    const q = {};
    if (category) q.category = category;
    if (status)   q.status   = status;
    if (orderRef) q.orderRef = { $regex: `^${esc(orderRef)}$`, $options: "i" };
    if (from || to) {
      q.date = {};
      if (from) q.date.$gte = new Date(from);
      if (to)   q.date.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }
    if (search) {
      const v = esc(search);
      q.$or = [
        { description:   { $regex: v, $options: "i" } },
        { vendor:        { $regex: v, $options: "i" } },
        { orderRef:      { $regex: v, $options: "i" } },
        { notes:         { $regex: v, $options: "i" } },
      ];
    }

    const expenses = await Expense.find(q).sort({ date: -1 }).lean();

    const csv$ = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
    const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-US") : "";

    const header = ["Date","Category","Description","Vendor","Amount","Order Ref","Invoice #","Status","Paid Date","Notes"].join(",");
    const rows   = expenses.map(e => [
      csv$(fmtD(e.date)),
      csv$(e.category),
      csv$(e.description),
      csv$(e.vendor),
      e.amount ?? 0,
      csv$(e.orderRef),
      csv$(e.invoiceNumber),
      csv$(e.status),
      csv$(fmtD(e.paidDate)),
      csv$(e.notes),
    ].join(","));

    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="expenses-${today}.csv"`);
    res.send([header, ...rows].join("\r\n"));
  } catch (err) {
    res.status(500).json({ error: "Export failed" });
  }
});

// ── POST /api/expenses — create ───────────────────────────────────────────────
router.post("/", uploadFields, async (req, res) => {
  try {
    const { category, description, vendor, amount, date, orderId, orderRef,
            vin, invoiceNumber, status, paidDate, notes,
            billDriveId, billDriveUrl } = req.body;

    if (!category || !description || !amount) {
      return res.status(400).json({ error: "Category, description, and amount are required." });
    }

    // Duplicate detection — same vendor + amount + date + order within 7 days (skip if force=true)
    if (req.query.force !== "true" && vendor && amount && orderRef) {
      const checkDate = date ? new Date(date) : new Date();
      const window7   = 7 * 24 * 60 * 60 * 1000;
      const existing  = await Expense.findOne({
        vendor:   { $regex: `^${vendor.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        amount:   parseFloat(amount),
        orderRef: { $regex: `^${orderRef.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        date:     { $gte: new Date(checkDate - window7), $lte: new Date(+checkDate + window7) },
      }).lean();
      if (existing) {
        return res.status(409).json({
          error:    "Possible duplicate expense",
          existing: { _id: existing._id, description: existing.description, amount: existing.amount,
                      date: existing.date, orderRef: existing.orderRef, status: existing.status },
        });
      }
    }

    // If VIN provided but no order link yet, auto-lookup the order
    let resolvedOrderId  = orderId  || null;
    let resolvedOrderRef = orderRef || "";
    if (vin && !resolvedOrderId && !resolvedOrderRef) {
      const vinOrder = await Order.findOne({ vin: { $regex: `^${vin.trim()}$`, $options: "i" } })
        .select("_id refNumber").lean();
      if (vinOrder) {
        resolvedOrderId  = vinOrder._id;
        resolvedOrderRef = vinOrder.refNumber;
      }
    }

    // Parse extra line items and add their amounts to the total
    let lineItems = [];
    if (req.body.lineItems) {
      try { lineItems = JSON.parse(req.body.lineItems); } catch {}
    }
    const extrasTotal = lineItems.reduce((s, l) => s + Number(l.amount || 0), 0);

    const data = {
      category, description, vendor, notes,
      vin:           (vin || "").toUpperCase().trim(),
      invoiceNumber: invoiceNumber || "",
      amount:        parseFloat(amount) + extrasTotal,
      date:          date ? new Date(date) : new Date(),
      orderId:       resolvedOrderId,
      orderRef:      resolvedOrderRef,
      status:        status || "unpaid",
      paidDate:      status === "paid" && paidDate ? new Date(paidDate) : null,
      lineItems:     lineItems.filter(l => l.description?.trim() && Number(l.amount) > 0),
    };

    if (req.files?.receipt?.[0]) {
      const f = req.files.receipt[0];
      const driveFile = await uploadFileToDriveExpenses(f.buffer, f.originalname, f.mimetype, "receipt", resolvedOrderId);
      data.receiptFileName = driveFile.name;
      data.receiptMime     = f.mimetype;
      data.receiptDriveId  = driveFile.id;
      data.receiptDriveUrl = driveFile.webViewLink;
    }
    if (req.files?.bill?.[0]) {
      const f = req.files.bill[0];
      const driveFile = await uploadFileToDriveExpenses(f.buffer, f.originalname, f.mimetype, "bill", resolvedOrderId);
      data.billFileName = driveFile.name;
      data.billMime     = f.mimetype;
      data.billDriveId  = driveFile.id;
      data.billDriveUrl = driveFile.webViewLink;
    } else if (billDriveId) {
      // Bill already lives in Drive (e.g. storage receipt uploaded to order docs)
      data.billDriveId  = billDriveId;
      data.billDriveUrl = billDriveUrl || "";
    }

    const expense = await Expense.create(data);
    res.status(201).json(expense);
  } catch (err) {
    console.error("Expense create error:", err);
    res.status(500).json({ error: "Failed to create expense" });
  }
});

// ── PUT /api/expenses/:id — update ────────────────────────────────────────────
router.put("/:id", uploadFields, async (req, res) => {
  try {
    const { category, description, vendor, amount, date, orderId, orderRef,
            invoiceNumber, status, paidDate, notes, vin } = req.body;

    let lineItems = [];
    if (req.body.lineItems) {
      try { lineItems = JSON.parse(req.body.lineItems); } catch {}
    }
    const extrasTotal = lineItems.reduce((s, l) => s + Number(l.amount || 0), 0);

    const update = {
      category, description, vendor, notes,
      vin:           vin !== undefined ? (vin || "") : undefined,
      invoiceNumber: invoiceNumber || "",
      amount:    parseFloat(amount) + extrasTotal,
      date:      date ? new Date(date) : undefined,
      orderId:   orderId || null,
      orderRef:  orderRef || "",
      status:    status || "unpaid",
      paidDate:  status === "paid" && paidDate ? new Date(paidDate) : null,
      lineItems: lineItems.filter(l => l.description?.trim() && Number(l.amount) > 0),
    };

    // Remove undefined keys
    Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);

    const old = await Expense.findById(req.params.id).select("receiptFileName billFileName receiptDriveId billDriveId orderId").lean();
    const linkedOrderId = orderId || old?.orderId || null;

    if (req.files?.receipt?.[0]) {
      if (old?.receiptDriveId) await deleteDriveFile(old.receiptDriveId);
      else deleteFile(old?.receiptFileName);
      const f = req.files.receipt[0];
      const driveFile = await uploadFileToDriveExpenses(f.buffer, f.originalname, f.mimetype, "receipt", linkedOrderId);
      update.receiptFileName = driveFile.name;
      update.receiptMime     = f.mimetype;
      update.receiptDriveId  = driveFile.id;
      update.receiptDriveUrl = driveFile.webViewLink;
    }
    if (req.files?.bill?.[0]) {
      if (old?.billDriveId) await deleteDriveFile(old.billDriveId);
      else deleteFile(old?.billFileName);
      const f = req.files.bill[0];
      const driveFile = await uploadFileToDriveExpenses(f.buffer, f.originalname, f.mimetype, "bill", linkedOrderId);
      update.billFileName = driveFile.name;
      update.billMime     = f.mimetype;
      update.billDriveId  = driveFile.id;
      update.billDriveUrl = driveFile.webViewLink;
    }

    const updated = await Expense.findByIdAndUpdate(
      req.params.id, { $set: update }, { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ error: "Expense not found" });
    res.json(updated);
  } catch (err) {
    console.error("Expense update error:", err);
    res.status(500).json({ error: "Failed to update expense" });
  }
});

// ── POST /api/expenses/bulk-pay — mark many as paid in one shot ───────────────
router.post("/bulk-pay", async (req, res) => {
  try {
    const { ids, paidDate, paymentMethod, action } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: "No expense IDs provided" });
    const dateObj = paidDate ? new Date(paidDate) : new Date();
    const update = action === "unpay"
      ? { $set: { status: "unpaid", paidDate: null, paymentMethod: "" } }
      : { $set: { status: "paid", paidDate: dateObj, paymentMethod: paymentMethod || "" } };
    const result = await Expense.updateMany({ _id: { $in: ids } }, update);
    res.json({ updated: result.modifiedCount });
  } catch (err) {
    console.error("bulk-pay error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/expenses/:id/pay — record a payment (full or partial) ─────────
router.patch("/:id/pay", async (req, res) => {
  try {
    const { paidDate, paidAmount, paymentMethod, notes } = req.body;
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: "Not found" });

    const payDate    = paidDate ? new Date(paidDate) : new Date();
    const payAmt     = paidAmount != null && paidAmount !== "" ? Number(paidAmount) : expense.amount;
    const prevPaid   = expense.paidAmount || 0;
    const newTotal   = prevPaid + payAmt;
    const isFullyPaid = newTotal >= expense.amount - 0.005;

    // Add to payment history
    expense.payments.push({
      amount: payAmt,
      date:   payDate,
      method: paymentMethod || expense.paymentMethod || "",
      notes:  notes || "",
    });

    expense.paidAmount    = newTotal;
    expense.paidDate      = payDate;
    expense.paymentMethod = paymentMethod || expense.paymentMethod || "";
    expense.status        = isFullyPaid ? "paid" : "partial";

    await expense.save();
    res.json(expense);
  } catch (err) {
    console.error("pay error:", err);
    res.status(500).json({ error: "Failed to record payment" });
  }
});

// ── File serving helpers ──────────────────────────────────────────────────────
function serveFile(fieldName) {
  return async (req, res) => {
    try {
      const driveUrlField = `${fieldName}DriveUrl`;
      const driveIdField  = `${fieldName}DriveId`;
      const fileField     = `${fieldName}FileName`;
      const mimeField     = `${fieldName}Mime`;
      const expense = await Expense.findById(req.params.id).lean();
      if (!expense) return res.status(404).json({ error: "Not found" });

      // New Drive-based files — redirect to Drive
      if (expense[driveIdField]) {
        const { drive } = require("../googleDrive");
        const fileRes = await drive.files.get(
          { fileId: expense[driveIdField], alt: "media" },
          { responseType: "stream" }
        );
        res.setHeader("Content-Type", expense[mimeField] || "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename="${expense[fileField] || fieldName}"`);
        fileRes.data.pipe(res);
        return;
      }

      // Legacy local files
      const fn = expense?.[fileField];
      if (!fn) return res.status(404).json({ error: "No file" });
      const filePath = path.join(uploadDir, fn);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found on disk" });
      res.setHeader("Content-Type", expense[mimeField] || "application/octet-stream");
      res.sendFile(filePath);
    } catch (err) {
      console.error("serveFile error:", err.message);
      res.status(500).json({ error: "Failed to serve file" });
    }
  };
}

function deleteFileRoute(fieldName) {
  return async (req, res) => {
    try {
      const driveIdField = `${fieldName}DriveId`;
      const fileField    = `${fieldName}FileName`;
      const mimeField    = `${fieldName}Mime`;
      const expense = await Expense.findById(req.params.id);
      if (!expense) return res.status(404).json({ error: "Not found" });
      if (expense[driveIdField]) await deleteDriveFile(expense[driveIdField]);
      else deleteFile(expense[fileField]);
      expense[fileField]    = "";
      expense[mimeField]    = "";
      expense[driveIdField] = "";
      expense[`${fieldName}DriveUrl`] = "";
      await expense.save();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to remove file" });
    }
  };
}

// ── GET  /api/expenses/:id/receipt ────────────────────────────────────────────
router.get("/:id/receipt", serveFile("receipt"));

// ── DELETE /api/expenses/:id/receipt ─────────────────────────────────────────
router.delete("/:id/receipt", deleteFileRoute("receipt"));

// ── GET  /api/expenses/:id/bill ───────────────────────────────────────────────
router.get("/:id/bill", serveFile("bill"));

// ── DELETE /api/expenses/:id/bill ─────────────────────────────────────────────
router.delete("/:id/bill", deleteFileRoute("bill"));

// ── Helper: save buffer to Drive and return filename ─────────────────────────
// If orderId is given, the file is saved into that order's own Drive folder;
// otherwise it falls back to the general Expenses > Bills folder.
async function saveUploadedFile(buffer, originalName, mimeType, orderId = null) {
  const driveFile = await uploadFileToDriveExpenses(buffer, originalName, mimeType || "application/pdf", "bill", orderId);
  return { fname: driveFile.name, driveId: driveFile.id, driveUrl: driveFile.webViewLink };
}

// VIN check-digit validation (NHTSA algorithm — works for all NA-market VINs)
const VIN_CHAR_VALS = {
  A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,
  J:1,K:2,L:3,M:4,N:5,P:7,R:9,
  S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9,
};
const VIN_WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
function vinChecksumValid(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const val = /\d/.test(c) ? parseInt(c, 10) : (VIN_CHAR_VALS[c] || 0);
    sum += val * VIN_WEIGHTS[i];
  }
  const rem = sum % 11;
  const expected = rem === 10 ? "X" : String(rem);
  return vin[8] === expected;
}

// ── POST /api/expenses/parse-sallaum — parse PDF, return VIN rows + order matches ──
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post("/parse-sallaum", memUpload.single("invoice"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    // Save a temp copy so apply-sallaum can produce per-order highlighted PDFs
    const sessionId = crypto.randomUUID();
    const tempPdfPath = path.join(TEMP_DIR, `sallaum-${sessionId}.pdf`);
    fs.writeFileSync(tempPdfPath, req.file.buffer);

    const savedFile = await saveUploadedFile(req.file.buffer, req.file.originalname);

    const data = await pdfParse(req.file.buffer);
    const text = data.text;

    // Extract invoice metadata from page 1
    const invoiceMatch = text.match(/Invoice No\.:\s*([\w-]+)/);
    const dateMatch    = text.match(/Date:\s*(\d{2}\.\d{2}\.\d{4})/);
    const voyageMatch  = text.match(/Voyage:\s*(\S+)/);
    const vesselMatch  = text.match(/Vessel:\s*(.+)/);
    const polMatch     = text.match(/Port of Load:\s*(\S+)/);
    const podMatch     = text.match(/Port of Discharge:\s*(\S+)/);

    const invoiceNumber = invoiceMatch?.[1] || "";
    const invoiceDate   = dateMatch?.[1] || "";
    const voyage        = voyageMatch?.[1] || "";
    const vessel        = vesselMatch?.[1]?.trim() || "";
    const pol           = polMatch?.[1] || "";
    const pod           = podMatch?.[1] || "";

    // Parse VIN rows from page 2 table
    // Each row contains a 17-char VIN followed by numeric columns ending in the total
    const VIN_RE = /[A-HJ-NPR-Z0-9]{17}/g;
    const rows = [];
    const lines = text.split("\n");

    for (const line of lines) {
      // Overlapping scan: find the first 17-char candidate that passes VIN checksum.
      // This handles two PDF concatenation artifacts:
      //   • model names ending in digits (RAV4, C300) bleed into VIN from the left
      //   • volume column digits (11.08 → "11") bleed into VIN from the right
      // Take the LAST checksum-passing candidate: for left-bleed the real VIN is further
      // right; for right-bleed only one candidate passes so last = first = correct.
      let vin = null;
      for (let ci = 0; ci <= line.length - 17; ci++) {
        const sub = line.substring(ci, ci + 17);
        if (/^[A-HJ-NPR-Z0-9]{17}$/.test(sub) && vinChecksumValid(sub)) {
          vin = sub; // keep scanning — rightmost winner wins
        }
      }
      if (!vin) continue;

      // Extract all decimal amounts from the line.
      // Column order after VIN: Volume(CBM), Freight, BAF, THC, Storage, Other(NR/FK), Total
      const nums = line.match(/[\d,]+\.\d{2}/g);
      if (!nums || nums.length < 2) continue;
      const pf = s => parseFloat(s.replace(/,/g, ""));
      const total   = pf(nums[nums.length - 1]);
      if (!total || total <= 0) continue;
      const freight = nums.length >= 7 ? pf(nums[nums.length - 6]) : 0;
      const baf     = nums.length >= 6 ? pf(nums[nums.length - 5]) : 0;
      const thc     = nums.length >= 5 ? pf(nums[nums.length - 4]) : 0;
      const storage = nums.length >= 4 ? pf(nums[nums.length - 3]) : 0;
      const other   = nums.length >= 3 ? pf(nums[nums.length - 2]) : 0;
      const hasExtraCharges = thc > 0 || storage > 0 || other > 0;

      // Extract booking number (SLSE######) from this row
      const bookingMatch = line.match(/SLSE\d+/i);
      const bookingRef = bookingMatch ? bookingMatch[0].replace(/^SLSE/i, "SLSE-") : "";

      // Extract vehicle description: text between booking number and VIN position
      let ymm = "";
      if (bookingRef && vin) {
        const rawRef = bookingRef.replace("-", ""); // match original SLSE without dash
        const refIdx = line.indexOf(rawRef);
        if (refIdx >= 0) {
          const afterBooking = line.substring(refIdx + rawRef.length);
          const vinIdx = afterBooking.indexOf(vin);
          if (vinIdx > 0) {
            ymm = afterBooking.substring(0, vinIdx).replace(/[^a-zA-Z0-9\s\-]/g, " ").replace(/\s+/g, " ").trim();
          }
        }
      }

      rows.push({ vin, total, freight, baf, thc, storage, other, hasExtraCharges, ymm, bookingRef });
    }

    // Match each VIN to an order
    const vins = rows.map(r => r.vin);
    const [orders, existingExpenses] = await Promise.all([
      Order.find({ vin: { $in: vins } }).select("_id refNumber vin customerName year make model").lean(),
      Expense.find({ invoiceNumber, vin: { $in: vins } }).select("vin").lean(),
    ]);

    const orderByVin = {};
    for (const o of orders) orderByVin[o.vin?.toUpperCase()] = o;
    const dupVins = new Set(existingExpenses.map(e => e.vin?.toUpperCase()));

    const result = rows.map(r => {
      const order = orderByVin[r.vin.toUpperCase()] || null;
      const ymmFromOrder = order ? [order.year, order.make, order.model].filter(Boolean).join(" ") : "";
      return {
        vin:             r.vin,
        total:           r.total,
        freight:         r.freight,
        baf:             r.baf,
        thc:             r.thc,
        storage:         r.storage,
        other:           r.other,
        hasExtraCharges: r.hasExtraCharges,
        ymm:             ymmFromOrder || r.ymm,
        bookingRef:      r.bookingRef,
        orderId:         order?._id || null,
        orderRef:        order?.refNumber || "",
        customerName:    order?.customerName || "",
        matched:         !!order,
        duplicate:       dupVins.has(r.vin.toUpperCase()),
      };
    });

    res.json({ invoiceNumber, invoiceDate, voyage, vessel, pol, pod, rows: result, billFileName: savedFile.fname, billDriveId: savedFile.driveId, billDriveUrl: savedFile.driveUrl, billMime: "application/pdf", sessionId });
  } catch (err) {
    console.error("parse-sallaum error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/apply-sallaum — bulk create expenses from parsed bill ──
router.post("/apply-sallaum", express.json(), async (req, res) => {
  try {
    const { invoiceNumber, invoiceDate, voyage, vessel, pol, pod, rows,
            billFileName, billMime, billDriveId, billDriveUrl, sessionId } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: "No rows provided" });

    const dateObj = invoiceDate
      ? new Date(invoiceDate.split(".").reverse().join("-"))
      : new Date();

    const created = [];
    for (const row of rows) {
      if (!row.skip && row.total > 0) {
        let orderId  = row.orderId || null;
        let orderRef = row.orderRef || "";
        if (!orderId && orderRef) {
          const o = await Order.findOne({ refNumber: { $regex: `^${orderRef}$`, $options: "i" } })
            .select("_id refNumber").lean();
          if (o) { orderId = o._id; orderRef = o.refNumber; }
        }

        // Skip creating a duplicate expense (same invoice + VIN already exists)
        const duplicate = await Expense.findOne({ invoiceNumber, vin: row.vin }).lean();

        // Build charge breakdown note
        const chargeParts = [];
        if (row.freight) chargeParts.push(`Freight: $${row.freight.toFixed(2)}`);
        if (row.baf)     chargeParts.push(`BAF: $${row.baf.toFixed(2)}`);
        if (row.thc)     chargeParts.push(`THC: $${row.thc.toFixed(2)}`);
        if (row.storage) chargeParts.push(`Storage: $${row.storage.toFixed(2)}`);
        if (row.other)   chargeParts.push(`Other/NR/FK: $${row.other.toFixed(2)}`);

        if (!duplicate) await Expense.create({
          category:      "Ocean Freight",
          description:   `Ocean Freight — ${row.ymm || ""} — VIN: ${row.vin}${row.bookingRef ? " — Booking: " + row.bookingRef : ""} — ${vessel || voyage}`.trim().replace(/\s*—\s*$/, ""),
          vendor:        "Sallaum Lines",
          amount:        row.total,
          date:          dateObj,
          orderId,
          orderRef,
          invoiceNumber,
          vin:           row.vin       || "",
          status:        "unpaid",
          notes:         `Voyage: ${voyage} | POL: ${pol || ""} | POD: ${pod || ""}${chargeParts.length ? " | " + chargeParts.join(", ") : ""}`,
          billFileName:  billFileName  || "",
          billMime:      billMime      || "",
          billDriveId:   billDriveId   || "",
          billDriveUrl:  billDriveUrl  || "",
        });
        if (!duplicate) created.push(true);

        // Attach the invoice PDF to the matched order's docs as "Rated Draft".
        // If we have the session temp file, produce a highlighted copy first.
        if (orderId) {
          const order = await Order.findById(orderId);
          if (order) {
            let attachDriveId  = billDriveId;
            let attachDriveUrl = billDriveUrl;
            const fname = billFileName || `Invoice_${invoiceNumber}.pdf`;
            const hName = `Invoice_${invoiceNumber}_${row.vin}.pdf`;

            const tempPdfPath = sessionId
              ? path.join(TEMP_DIR, `sallaum-${sessionId}.pdf`)
              : null;

            if (tempPdfPath && fs.existsSync(tempPdfPath) && order.driveFolderId && row.vin) {
              const hlPath = path.join(TEMP_DIR, `sallaum-hl-${crypto.randomUUID()}.pdf`);
              try {
                await highlightVinInPdf(tempPdfPath, hlPath, row.vin);
                const hlBytes = fs.readFileSync(hlPath);
                const uploaded = await uploadBufferToDrive(
                  hlBytes, hName, "application/pdf", order.driveFolderId
                );
                attachDriveId  = uploaded.id;
                attachDriveUrl = uploaded.webViewLink;
              } catch (hlErr) {
                console.warn("highlight failed, falling back to plain invoice:", hlErr.message);
              } finally {
                try { fs.unlinkSync(hlPath); } catch {}
              }
            }

            // Only attach if this invoice isn't already in the order's docs
            const alreadyAttached = order.files.some(
              f => f.originalName === hName || (f.driveFileId && f.driveFileId === attachDriveId)
            );
            if (attachDriveId && attachDriveUrl && !alreadyAttached) {
              order.files.push({
                label:        "Rated Draft",
                originalName: hName,
                filename:     hName,
                driveFileId:  attachDriveId,
                path:         attachDriveUrl,
                mimetype:     "application/pdf",
              });
              order.timeline.push({
                action:    "Document Added",
                details:   `Sallaum invoice ${invoiceNumber} attached as Rated Draft (VIN row highlighted)`,
                createdAt: new Date(),
              });
              await order.save();
            }
          }
        }
      }
    }

    // Clean up temp session PDF
    if (sessionId) {
      try { fs.unlinkSync(path.join(TEMP_DIR, `sallaum-${sessionId}.pdf`)); } catch {}
    }

    res.json({ created: created.length });
  } catch (err) {
    console.error("apply-sallaum error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/parse-dispatch-url — parse dispatch PDF already on disk ──
router.post("/parse-dispatch-url", express.json(), async (req, res) => {
  try {
    const { url, filename, orderRef, orderId } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });

    // Extract file path from URL: http://localhost:4000/uploads/{orderId}/{filename}
    const urlPath = new URL(url).pathname; // /uploads/{orderId}/{filename}
    const baseUploads = path.join(__dirname, "../uploads");
    const filePath = path.join(baseUploads, ...urlPath.replace(/^\/uploads\//, "").split("/").map(decodeURIComponent));

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found on disk" });

    const buffer = fs.readFileSync(filePath);
    const savedFile = await saveUploadedFile(buffer, filename || path.basename(filePath));
    const data = await pdfParse(buffer);
    const text = data.text;

    const vinMatch = text.match(/\bVIN\b[\s\S]{0,30}?([A-HJ-NPR-Z0-9]{17})/i) || text.match(/([A-HJ-NPR-Z0-9]{17})/);
    const vin = vinMatch?.[1] || "";
    const priceMatch = text.match(/Total Price[\s\S]{0,20}?\$\s*([\d,]+(?:\.\d{2})?)/i) || text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
    const total = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : 0;
    const loadMatch = text.match(/Load ID\s*\n\s*(\d+)/i) || text.match(/Load\s+(\d{4,})\//i);
    const loadId = loadMatch?.[1] || "";

    // Re-use the same parsing helpers from parse-dispatch
    const ymmMatch = text.match(/(\d{4})\s+([A-Z][a-zA-Z]+)\s+([A-Z][a-zA-Z0-9 ]+?)(?:\n|VIN|$)/m);
    const ymm = ymmMatch ? `${ymmMatch[1]} ${ymmMatch[2]} ${ymmMatch[3].trim()}` : "";
    const dispatchDateMatch = text.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
    const dispatchDate = dispatchDateMatch?.[0] || "";
    const originMatch = text.match(/Origin[\s\S]{0,5}?\n([^\n]+)/i);
    const origin = originMatch?.[1]?.trim() || "";

    // Try to match order by VIN
    let matchedOrder = null;
    if (orderId) {
      const Order = require("../models/Order");
      matchedOrder = await Order.findById(orderId).select("refNumber _id").lean();
    } else if (vin) {
      const Order = require("../models/Order");
      matchedOrder = await Order.findOne({ vin: { $regex: vin, $options: "i" } }).select("refNumber _id").lean();
    }

    const row = {
      vin, ymm, total, loadId, dispatchDate, origin,
      billFileName: savedFile.fname, billDriveId: savedFile.driveId, billDriveUrl: savedFile.driveUrl, billMime: "application/pdf",
      orderId:  matchedOrder?._id  || orderId  || null,
      orderRef: matchedOrder?.refNumber || orderRef || "",
      matched:  !!(matchedOrder || orderId),
      notes: `Load ID: ${loadId}`,
    };

    res.json([row]);
  } catch (err) {
    console.error("parse-dispatch-url error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/parse-dispatch — parse one or many Central Dispatch PDFs ──
router.post("/parse-dispatch", memUpload.array("invoices", 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: "No PDFs uploaded" });

    const results = [];

    for (const file of req.files) {
      try {
        const savedFile = await saveUploadedFile(file.buffer, file.originalname);
        const data = await pdfParse(file.buffer);
        const text = data.text;

        // VIN
        const vinMatch = text.match(/\bVIN\b[\s\S]{0,30}?([A-HJ-NPR-Z0-9]{17})/i)
          || text.match(/([A-HJ-NPR-Z0-9]{17})/);
        const vin = vinMatch?.[1] || "";

        // Total Price — "$300" or "Total Price\n$300"
        const priceMatch = text.match(/Total Price[\s\S]{0,20}?\$\s*([\d,]+(?:\.\d{2})?)/i)
          || text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
        const total = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : 0;

        // Load ID — text format is "Load ID\n13744/48096146 PORT"
        // Extract just the number before the "/"
        const loadMatch = text.match(/Load ID\s*\n\s*(\d+)/i)                 // "Load ID\n13744/..."
          || text.match(/Load\s+(\d{4,})\//i);                                // "Load 13744/..."
        const loadId = loadMatch?.[1] || "";

        // Carrier name
        const carrierMatch = text.match(/Carrier\s+([A-Z][^\n]{3,60}LLC|[A-Z][^\n]{3,60}Inc|[A-Z][^\n]{3,60}Corp|[A-Z][^\n]{3,60}Trucking[^\n]*)/i)
          || text.match(/Carrier\s*\n([^\n]{3,60})/i);
        const carrier = carrierMatch?.[1]?.trim() || "Unknown Carrier";

        // Vehicle YMM
        const ymmMatch = text.match(/Vehicle Year\/Make\/Model\s*\n?([^\n]{5,60})/i);
        const ymm = ymmMatch?.[1]?.trim() || "";

        // Origin city (pickup)
        const originMatch = text.match(/Origin\s*\n([^\n]{3,80})/i);
        const origin = originMatch?.[1]?.trim() || "";

        // Dispatch date
        const dateMatch = text.match(/Dispatch Date\s*\n?(\d{2}\/\d{2}\/\d{4})/i);
        const dispatchDate = dateMatch?.[1] || "";

        // Match to order by VIN
        let order = null;
        if (vin) {
          order = await Order.findOne({ vin: { $regex: `^${vin}$`, $options: "i" } })
            .select("_id refNumber vin customerName year make model")
            .lean();
        }

        results.push({
          fileName:    file.originalname,
          vin,
          total,
          loadId,
          carrier,
          ymm,
          origin,
          dispatchDate,
          billFileName: savedFile.fname, billDriveId: savedFile.driveId, billDriveUrl: savedFile.driveUrl,
          billMime:     "application/pdf",
          orderId:      order?._id || null,
          orderRef:     order?.refNumber || "",
          customerName: order?.customerName || "",
          matched:      !!order,
          skip:         false,
          notes:        "",
        });
      } catch (parseErr) {
        results.push({ fileName: file.originalname, error: parseErr.message, skip: true });
      }
    }

    res.json({ rows: results });
  } catch (err) {
    console.error("parse-dispatch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/apply-dispatch — bulk create transport expenses ─────────
router.post("/apply-dispatch", express.json(), async (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: "No rows provided" });

    const created = [];
    for (const row of rows) {
      if (row.skip || !row.total) continue;

      // Re-lookup orderId if only orderRef was provided (manual entry)
      let orderId = row.orderId || null;
      let orderRef = row.orderRef || "";
      if (!orderId && orderRef) {
        const o = await Order.findOne({ refNumber: { $regex: `^${orderRef}$`, $options: "i" } })
          .select("_id refNumber").lean();
        if (o) { orderId = o._id; orderRef = o.refNumber; }
      }

      // Parse dispatch date
      let dateObj = new Date();
      if (row.dispatchDate) {
        const [m, d, y] = row.dispatchDate.split("/");
        dateObj = new Date(`${y}-${m}-${d}`);
      }

      const validExtras = (row.lineItems || []).filter(l => l.description?.trim() && Number(l.amount) > 0);
      const extrasTotal = validExtras.reduce((s, l) => s + Number(l.amount), 0);

      const expense = await Expense.create({
        category:      "Towing / Transport",
        description:   `Transport — ${row.ymm || ""} — VIN: ${row.vin || ""} — ${row.origin || ""}`.trim().replace(/\s*—\s*$/, ""),
        vendor:        row.carrier || "Unknown Carrier",
        amount:        row.total + extrasTotal,
        date:          dateObj,
        orderId,
        orderRef,
        invoiceNumber: row.loadId || "",
        status:        "unpaid",
        notes:         row.notes || "",
        billFileName:  row.billFileName || "",
        billMime:      row.billMime     || "",
        lineItems:     validExtras,
      });
      created.push(expense._id);
    }

    res.json({ created: created.length });
  } catch (err) {
    console.error("apply-dispatch error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/parse-acl — parse one or many Grimaldi/ACL rated bills ──
router.post("/parse-acl", memUpload.array("invoices", 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: "No PDFs uploaded" });

    const results = [];

    for (const file of req.files) {
      try {
        const savedFile = await saveUploadedFile(file.buffer, file.originalname);
        const data = await pdfParse(file.buffer);
        const text = data.text;

        // VIN — 17 char
        const vinMatch = text.match(/([A-HJ-NPR-Z0-9]{17})/);
        const vin = vinMatch?.[1] || "";

        // Total charges
        const totalMatch = text.match(/TOTAL CHARGES PAYABLE AT ORIGIN IN USD[\s]+([\d,]+\.?\d*)/i);
        const total = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : 0;

        // Ref No (their internal ref e.g. 13548)
        const refMatch = text.match(/Ref(?:erence)?\.?\s*No\.?\s*[:\s]*(\d{4,})/i)
          || text.match(/Ref#\s*[:\s]*(\d{4,})/i);
        const refNo = refMatch?.[1] || "";

        // Booking No
        const bookingMatch = text.match(/Booking\s+No\.?\s*([A-Z0-9]{6,})/i);
        const bookingNo = bookingMatch?.[1] || "";

        // Vessel + Voyage
        // Page 2 has a clean "GTE0326 - GRANDE TEMA" pattern — use that first
        const vvMatch = text.match(/([A-Z]{2,5}\d{4})\s*[-–]\s*((?:GRANDE|GOOD|AUTO|SPIRIT|ASIA|AFRICA|ATLANTIC|EURO|AMERICA|CONGO|\w+)[A-Z \w]*?)(?:\r?\n|$)/i);
        let voyage = vvMatch?.[1]?.trim() || "";
        let vessel = vvMatch?.[2]?.trim() || "";
        // Fallback: page 1 layout "Ocean vessel CODE\nVESSEL NAME" (code and name on separate lines)
        if (!vessel) {
          const vmLines = text.match(/Ocean vessel\s+([A-Z]{2,5}\d{4})\s*\r?\n\s*([A-Z][A-Z ]+)/i);
          if (vmLines) { voyage = voyage || vmLines[1]; vessel = vmLines[2].trim(); }
        }

        // POL / POD — page 2 uses "POL: VALUE" / "POD: VALUE" labels (most reliable)
        const polMatch = text.match(/\bPOL:\s*([^\n\r]+)/i)
          || text.match(/Port of loading\s*\r?\n([^\n]{3,60})/i);
        const podMatch = text.match(/\bPOD:\s*([^\n\r]+)/i)
          || text.match(/Port of discharge\s*\r?\n([^\n]{3,60})/i);
        const pol = (polMatch?.[1]?.trim() || "").replace(/\s+\d.*$/, ""); // strip any page numbers
        const pod = (podMatch?.[1]?.trim() || "").replace(/\s+\d.*$/, "");

        // Individual charge line items (Basic Frt, BAF, Emergency Bunker, MDR, Low Sulphur, etc.)
        const chargeLines = [];
        const chargeRe = /^\s*([A-Za-z][A-Za-z /().-]{2,35?})\s+([\d,]+\.\d{2})\s+USD/gm;
        let cm;
        while ((cm = chargeRe.exec(text)) !== null) {
          const label = cm[1].trim();
          const amt   = parseFloat(cm[2].replace(/,/g, ""));
          if (/TOTAL/i.test(label)) continue; // skip the total summary line
          chargeLines.push({ label, amount: amt });
        }

        // YMM
        const vehicleLineMatch = text.match(/\d USED UNPACKED VEHICLE.*?\n(.+?)\nModel Year (\d{4})/is);
        const ymm = vehicleLineMatch
          ? `${vehicleLineMatch[2]} ${vehicleLineMatch[1].trim()}`
          : "";

        // Date (shipped on board)
        const dateMatch = text.match(/Shipped on board date\s*\n?(\d{2}\/\d{2}\/\d{4})/i)
          || text.match(/(\d{2}\/\d{2}\/\d{4})/);
        const billDate = dateMatch?.[1] || "";

        // Match order by VIN
        let order = null;
        if (vin) {
          order = await Order.findOne({ vin: { $regex: `^${vin}$`, $options: "i" } })
            .select("_id refNumber vin customerName year make model").lean();
        }

        results.push({
          fileName:     file.originalname,
          vin,
          total,
          refNo,
          bookingNo,
          vessel,
          voyage,
          pol,
          pod,
          ymm,
          billDate,
          chargeLines,
          billFileName: savedFile.fname, billDriveId: savedFile.driveId, billDriveUrl: savedFile.driveUrl,
          billMime:     "application/pdf",
          orderId:      order?._id || null,
          orderRef:     order?.refNumber || "",
          customerName: order?.customerName || "",
          matched:      !!order,
          skip:         false,
          notes:        "",
        });
      } catch (parseErr) {
        results.push({ fileName: file.originalname, error: parseErr.message, skip: true });
      }
    }

    res.json({ rows: results });
  } catch (err) {
    console.error("parse-acl error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/apply-acl — bulk create ACL ocean freight expenses ──────
router.post("/apply-acl", express.json(), async (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: "No rows provided" });

    const created = [];
    for (const row of rows) {
      if (row.skip || !row.total) continue;

      let orderId  = row.orderId || null;
      let orderRef = row.orderRef || "";
      if (!orderId && orderRef) {
        const o = await Order.findOne({ refNumber: { $regex: `^${orderRef}$`, $options: "i" } })
          .select("_id refNumber").lean();
        if (o) { orderId = o._id; orderRef = o.refNumber; }
      }

      let dateObj = new Date();
      if (row.billDate) {
        const [m, d, y] = row.billDate.split("/");
        if (m && d && y) dateObj = new Date(`${y}-${m}-${d}`);
      }

      const expense = await Expense.create({
        category:      "Ocean Freight",
        description:   `ACL Ocean Freight — ${row.ymm || ""} — VIN: ${row.vin || ""} — ${row.vessel || ""} ${row.voyage || ""}`.trim().replace(/\s*—\s*$/, ""),
        vendor:        "Grimaldi / ACL",
        amount:        row.total,
        date:          dateObj,
        orderId,
        orderRef,
        invoiceNumber: row.refNo || row.bookingNo || "",
        status:        "unpaid",
        notes:         [
          row.bookingNo ? `Booking: ${row.bookingNo}` : "",
          row.pol && row.pod ? `${row.pol} → ${row.pod}` : "",
          row.chargeLines?.length
            ? row.chargeLines.map(c => `${c.label}: $${c.amount.toFixed(2)}`).join(", ")
            : "",
          row.notes || "",
        ].filter(Boolean).join(" | "),
        billFileName:  row.billFileName || "",
        billMime:      row.billMime     || "",
      });
      created.push(expense._id);
    }

    res.json({ created: created.length });
  } catch (err) {
    console.error("apply-acl error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/parse-container — parse Savannah-style container invoice ──
router.post("/parse-container", memUpload.array("invoices", 20), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: "No PDFs uploaded" });

    const results = [];

    for (const file of req.files) {
      try {
        const savedFile = await saveUploadedFile(file.buffer, file.originalname);
        const data = await pdfParse(file.buffer);
        const text = data.text;

        // Invoice number — "Invoice no.: 30023" or "NUMBER\n015839" or EzCargo: dates+number concat
        const invMatch  = text.match(/Invoice\s+no\.?:?\s*(\d+)/i)
          || text.match(/NUMBER\s*\n\s*(\d+)/i)
          || text.match(/Invoice\s*\n[\w\/]+[\w\/]+(\d{5,})/i)   // EzCargo: "Invoice\ndate1date2NNNNN"
          || text.match(/INVOICE[^\d]{0,40}(\d{5,})/i);
        const invoiceNumber = invMatch?.[1] || "";

        // Date — "Invoice date: 06/05/2026" or "APR 06 2026"
        const dateMatch = text.match(/Invoice\s+date:?\s*(\d{2}\/\d{2}\/\d{4})/i)
          || text.match(/ENTRY\s+DATE\s*\n?\s*([A-Z]{3}\s+\d{2}\s+\d{4})/i);
        const billDate  = dateMatch?.[1] || "";

        // Vendor name — try multiple patterns
        // 1. Savannah: company name right after INVOICE header
        const vSavannah = text.match(/^INVOICE\s*[\r\n]+([A-Z][^\r\n]{3,60}(?:LLC|INC|CORP|LTD)[^\r\n]*)/im);
        // 2. iShip / Cedars: company name before address at bottom
        const vBottom   = text.match(/[\r\n]([A-Z][A-Z\s]{2,30}(?:INC|LLC|CORP|LTD)\.?)\s*[\r\n]\d{3,5}/i)
          || text.match(/[\r\n]([A-Z][A-Z\s]{2,40}(?:INC|LLC|CORP|LTD)\.?)\s*[\r\n](?:OFFICE|TEL|PHONE)/i);
        // 3. Full name in body text (Cedars: "CEDARS EXPRESS INTERNATIONAL INC SHALL NOT...")
        const vBody     = text.match(/([A-Z][A-Z\s]{5,50}(?:INC|LLC|CORP|LTD)\.?)\s+SHALL\s+NOT/i);
        // 4. First non-blank line that looks like a company (handles "E-Z CARGO INC.", hyphens, periods)
        const vFirst    = text.match(/^\n*([A-Z][A-Z0-9\s\-\.&]{3,50}(?:LLC|INC|CORP|LTD|INC\.))\s*\n/im);
        // 5. Website URL fallback
        const vWeb      = text.match(/WWW\.([A-Z]+?)(?:INC)?\.COM/i);
        const vendorRaw = vSavannah?.[1] || vBody?.[1] || vBottom?.[1] || vFirst?.[1] || (vWeb?.[1] ? vWeb[1] + " INC" : "");
        const vendor    = vendorRaw.trim().replace(/\s+/g, " ");

        // Container number — handles "CONTAINER: XXXX", "CONT# XXXX", "Container #:XXXX"
        const containerMatch = text.match(/(?:CONTAINER|CONT)\s*[:#\s]{0,3}([A-Z]{4}\d{7})/i);
        const container = containerMatch?.[1] || "";

        // Booking / BL number — allow alphanumeric (e.g. NYC078040243)
        const bookingMatch = text.match(/Booking\s+Number\s*:?\s*([A-Z0-9]{6,})/i)
          || text.match(/BOOKING\s*[:#]?\s*([A-Z0-9]{6,})/i)
          || text.match(/AWB\/BL\s*:?\s*([A-Z0-9]{6,})/i)
          || text.match(/BL\s*[:#]?\s*(\d{6,})/i);
        const booking = bookingMatch?.[1] || "";

        // Total — try specific patterns before falling back to max
        // Total — try most specific patterns first
        const totalMatch = text.match(/TOTAL\s+(?:INVOICE\s+AMOUNT|AMOUNT\s+DUE)[\s\S]{0,10}?([\d,]+\.\d{2})/i)
          || text.match(/OCEAN\s+FREIGHT\s+SALES[\s\S]{0,10}?([\d,]+\.\d{2})/i)
          || text.match(/PLEASE\s+PAY\s+THIS\s+AMOUNT[\s\S]{0,30}?([\d,]+\.\d{2})/i)  // EzCargo
          || text.match(/Total[\r\n][\s$]*([\d,]+\.\d{2})/i);           // Savannah: "Total\n$3,950.00"

        // Cedars: "Balance Due" appears as label then value at end — grab the last occurrence
        const balanceDueMatches = [...text.matchAll(/Balance\s+Due[\s\S]{0,30}?([\d,]+\.\d{2})/gi)];
        const balanceDue = balanceDueMatches.length
          ? parseFloat(balanceDueMatches[balanceDueMatches.length - 1][1].replace(/,/g, ""))
          : 0;

        const total = totalMatch
          ? parseFloat(totalMatch[1].replace(/,/g, ""))
          : balanceDue || (() => {
              const allNums = (text.match(/[\d,]+\.\d{2}/g) || []).map(n => n.replace(/,/g,""));
              const freq = {};
              allNums.forEach(n => { freq[n] = (freq[n]||0) + 1; });
              const repeated = Object.entries(freq).filter(([,c]) => c >= 2).map(([n]) => parseFloat(n));
              return repeated.length ? Math.max(...repeated) : Math.max(...allNums.map(parseFloat));
            })();

        const lines = text.split("\n");
        const vinData = {};

        // ── EzCargo pre-pass: semicolon-separated or space-inside VINs ──────────
        for (const line of lines) {
          const t = line.trim();
          // VIN with embedded space (e.g. "KM8J3CA44HU5 85616") — line is just the VIN
          const spaceVin = t.match(/^([A-HJ-NPR-Z0-9]+)\s([A-HJ-NPR-Z0-9]+)$/);
          if (spaceVin && (spaceVin[1]+spaceVin[2]).length === 17) {
            const vin = spaceVin[1]+spaceVin[2];
            if (!vinData[vin]) vinData[vin] = { ymm: "", lineTotal: null };
            continue;
          }
          // Semicolon-separated VINs
          if (t.includes(';')) {
            t.split(';').forEach(part => {
              const v = part.trim().match(/[A-HJ-NPR-Z0-9]{17}/);
              if (v && !vinData[v[0]]) vinData[v[0]] = { ymm: "", lineTotal: null };
            });
          }
        }

        for (const line of lines) {
          // Method 1: VIN immediately before first $ on the line
          const beforeDollar = line.match(/([A-HJ-NPR-Z0-9]{17})\$/);
          // Method 2: standalone 17-char VIN token (space/start/end bounded)
          const standalone  = line.match(/(?:^|\s)([A-HJ-NPR-Z0-9]{17})(?:\s|$)/);
          const vinMatch    = beforeDollar || standalone;
          if (!vinMatch) continue;
          const vin = vinMatch[1];
          if (vinData[vin]) continue;

          // Per-VIN price: last number on the line before newline
          const lineNums = line.match(/[\d,]+\.\d{2}/g);
          const lineTotal = lineNums ? parseFloat(lineNums[lineNums.length - 1].replace(/,/g, "")) : null;

          // YMM: year + text before VIN, strip color words and VIN# prefix
          const lineIdx = lines.indexOf(line);
          const vinIdx  = line.indexOf(vin);
          // Try same line first (iShip concatenated style)
          let before = line.slice(0, vinIdx)
            .replace(/\d+\s*kg\s*/gi, "")
            .replace(/VIN\s*#?\s*:?\s*/gi, "")
            .replace(/BLACK|WHITE|GRAY|GREY|SILVER|BLUE|RED|GREEN|GOLD|BROWN|BEIGE|ORANGE|PURPLE|YELLOW/gi, "")
            .replace(/[#*]/g, "")
            .trim();
          // Look at previous line only if it contains a vehicle year (19xx/20xx)
          if ((!before || before.length < 4 || !/\d/.test(before)) && lineIdx > 0) {
            const prevLine = lines[lineIdx - 1]
              .replace(/\d+\s*kg\s*/gi, "")
              .replace(/VIN\s*#?\s*:?\s*/gi, "")
              .replace(/[#*]/g, "")
              .trim();
            if (/(?:19|20)\d{2}/.test(prevLine)) before = prevLine;
          }
          const ymmRaw = before.match(/(\d{4})\s*(.{2,40})/);
          const ymm = ymmRaw ? `${ymmRaw[1]} ${ymmRaw[2].trim()}`.replace(/\s+/g, " ").trim() : "";

          vinData[vin] = { ymm, lineTotal };
        }

        const vins = Object.keys(vinData);

        // ── Per-VIN storage/extra charges ────────────────────────────────────────
        // "Storage Fee" heading appears on its own line; the detail (with partial VIN + amount)
        // is on the NEXT line. Also handle inline storage/extra charge lines.
        const vinExtras = {};
        let storageTotal = 0;
        const seenPartials = new Set(); // dedupe duplicate pages

        for (let li = 0; li < lines.length; li++) {
          const lc = lines[li].toLowerCase();
          const isHeading = lc.trim() === "storage fee" || lc.trim() === "storage"
            || lc.trim() === "detention" || lc.trim() === "extra charges";
          // Candidate line: either the heading's next line, or a line that mentions storage + has VIN ref
          const candidates = isHeading && li + 1 < lines.length
            ? [lines[li + 1]]
            : (lc.includes("storage") || lc.includes("detention") ? [lines[li]] : []);

          for (const cline of candidates) {
            const lineNums = cline.match(/[\d,]+\.\d{2}/g);
            if (!lineNums) continue;
            const lineAmt = parseFloat(lineNums[lineNums.length - 1].replace(/,/g, ""));
            if (!lineAmt) continue;

            // Find partial VIN reference (after "VIN:" or standalone 6-char hex-like)
            const pm = cline.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{4,})/i)
              || cline.match(/\b([A-HJ-NPR-Z0-9]{6})\b/g);
            const partials = pm
              ? (Array.isArray(pm) ? pm.map(m => m.replace(/VIN[:\s#]*/i, "").toUpperCase()) : [pm[1].toUpperCase()])
              : [];

            for (const partial of partials) {
              const key = partial + lineAmt;
              if (seenPartials.has(key)) continue; // skip duplicate page
              const matchedVin = vins.find(v => v.toUpperCase().endsWith(partial) || v.toUpperCase().includes(partial));
              if (matchedVin) {
                seenPartials.add(key);
                vinExtras[matchedVin] = (vinExtras[matchedVin] || 0) + lineAmt;
                storageTotal += lineAmt;
              }
            }
          }
        }

        const hasPerVinPricing = vins.some(v => vinData[v].lineTotal && vinData[v].lineTotal > 0);
        const baseTotal  = total - storageTotal;
        const equalSplit = vins.length > 0 ? Math.round((baseTotal / vins.length) * 100) / 100 : total;

        // Match orders
        const orders = await Order.find({ vin: { $in: vins } })
          .select("_id refNumber vin customerName year make model").lean();
        const orderByVin = {};
        for (const o of orders) orderByVin[o.vin?.toUpperCase()] = o;

        const rows = vins.map(vin => {
          const order = orderByVin[vin.toUpperCase()] || null;
          const d = vinData[vin] || {};
          const rowTotal = (hasPerVinPricing && d.lineTotal ? d.lineTotal : equalSplit)
            + (vinExtras[vin] || 0);
          return {
            vin,
            ymm:          d.ymm || (order ? [order.year, order.make, order.model].filter(Boolean).join(" ") : ""),
            total:        rowTotal,
            orderId:      order?._id || null,
            orderRef:     order?.refNumber || "",
            customerName: order?.customerName || "",
            matched:      !!order,
            skip:         false,
            notes:        "",
          };
        });

        results.push({ fileName: file.originalname, invoiceNumber, billDate, vendor, container, booking, total, rows, billFileName: savedFile.fname, billDriveId: savedFile.driveId, billDriveUrl: savedFile.driveUrl, billMime: "application/pdf" });
      } catch (e) {
        results.push({ fileName: file.originalname, error: e.message, rows: [] });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error("parse-container error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/apply-container ───────────────────────────────────────
router.post("/apply-container", express.json(), async (req, res) => {
  try {
    const { results } = req.body;
    if (!results?.length) return res.status(400).json({ error: "No data" });

    let created = 0;
    for (const invoice of results) {
      for (const row of (invoice.rows || [])) {
        if (row.skip || !row.total) continue;

        let orderId = row.orderId || null;
        let orderRef = row.orderRef || "";
        if (!orderId && orderRef) {
          const o = await Order.findOne({ refNumber: { $regex: `^${orderRef}$`, $options: "i" } })
            .select("_id refNumber").lean();
          if (o) { orderId = o._id; orderRef = o.refNumber; }
        }

        let dateObj = new Date();
        if (invoice.billDate) {
          const [m, d, y] = invoice.billDate.split("/");
          if (m && d && y) dateObj = new Date(`${y}-${m}-${d}`);
        }

        await Expense.create({
          category:      "Loaders & Warehouses",
          description:   `Container Loading — ${row.ymm || ""} — VIN: ${row.vin}`.trim().replace(/\s*—\s*$/, ""),
          vendor:        invoice.vendor || "Savannah Auto Export",
          amount:        row.total,
          date:          dateObj,
          orderId:       orderId || null,
          orderRef:      orderRef || "",
          invoiceNumber: invoice.booking || invoice.invoiceNumber || "",
          status:        "unpaid",
          notes:         [invoice.container ? `Container: ${invoice.container}` : "", invoice.booking ? `Booking: ${invoice.booking}` : "", row.notes || ""].filter(Boolean).join(" | "),
          billFileName:  invoice.billFileName || "",
          billMime:      invoice.billMime     || "",
        });
        created++;
      }
    }

    res.json({ created });
  } catch (err) {
    console.error("apply-container error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/parse-misc — generic parser for any misc invoice ──────
router.post("/parse-misc", memUpload.array("invoices", 50), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: "No PDFs uploaded" });

    const results = [];

    for (const file of req.files) {
      try {
        const data = await pdfParse(file.buffer);
        const text = data.text;

        // ── FedEx Transaction Record — dedicated parsing path ──────────────────
        if (/fedex/i.test(text) && /tracking\s*no\.?/i.test(text)) {
          // Header labels and values appear together, e.g.:
          //   TRACKING NO.: SHIP DATE: ESTIMATED TOTAL COST:
          //   872844321616 Jun 9, 2026 10.95 USD
          // pdf-parse sometimes drops whitespace, merging the year and amount
          // (e.g. "202610.95") — anchor the year to exactly 4 digits so the
          // amount never absorbs it.
          const headerBlock = text.match(
            /TRACKING\s*NO\.?:?\s*SHIP\s*DATE:?\s*ESTIMATED\s*TOTAL\s*COST:?\s*(\d{8,14})\D*?([A-Za-z]{3,9})\.?\s*(\d{1,2}),?\s*(\d{4})\D{0,3}(\d{1,5}\.\d{2})\s*USD/i
          );

          const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
          let trackingNo = "", billDate = "", total = 0;

          if (headerBlock) {
            trackingNo = headerBlock[1];
            const mon = headerBlock[2].toLowerCase().slice(0, 3);
            if (months[mon]) billDate = `${months[mon]}/${headerBlock[3].padStart(2, '0')}/${headerBlock[4]}`;
            total = parseFloat(headerBlock[5]);
          } else {
            // Fallbacks if the combined pattern doesn't match
            const trackMatch = text.match(/Tracking\s*No\.?:?\s*\n?\s*(\d{10,14})/i);
            trackingNo = trackMatch?.[1] || "";
            const dateMatch = text.match(/Ship\s*Date:?\s*\n?\s*([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
            if (dateMatch) {
              const mon = dateMatch[1].toLowerCase().slice(0, 3);
              if (months[mon]) billDate = `${months[mon]}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3]}`;
            }
            const totalM = text.match(/([\d,]{1,7}\.\d{2})\s*USD/i);
            total = totalM ? parseFloat(totalM[1].replace(/,/g, "")) : 0;
          }

          const refMatch  = text.match(/Your\s+reference:?\s*\n?\s*([A-Za-z0-9\-]+)/i);
          const orderRef = refMatch?.[1]?.trim() || "";

          let order = null;
          if (orderRef) {
            order = await Order.findOne({ refNumber: { $regex: `^${esc(orderRef)}$`, $options: "i" } })
              .select("_id refNumber vin customerName year make model").lean();
          }

          // Save the file to Drive — to the matched order's folder if found, else the general Bills folder
          let billFile = null;
          try { billFile = await saveUploadedFile(file.buffer, file.originalname, "application/pdf", order?._id || null); } catch {}

          results.push({
            fileName:     file.originalname,
            invoiceNumber: trackingNo,
            billDate,
            vendor:       "FedEx",
            total,
            category:     "Office & Admin",
            description:  "FedEx Shipping" + (orderRef ? ` — Ref #${orderRef}` : ""),
            isPaid:       true, // FedEx One Rate is billed to card on file at ship time
            vin:          "",
            billFileName: billFile?.fname || "",
            billDriveId:  billFile?.driveId || "",
            billDriveUrl: billFile?.driveUrl || "",
            orderId:      order?._id || null,
            orderRef:     order?.refNumber || orderRef,
            customerName: order?.customerName || "",
            ymm:          order ? [order.year, order.make, order.model].filter(Boolean).join(" ") : "",
            matched:      !!order,
            skip:         false,
            notes:        "",
          });
          continue;
        }

        // Invoice number — handles "Invoice #29135Paid", "Invoice Number: 000255", etc.
        const invMatch = text.match(/Invoice\s*#\s*(\d+)/i)
          || text.match(/Invoice\s*(?:Number|No\.?)\s*[:\n\r]\s*([A-Z0-9\-]{3,20})/i)
          || text.match(/Invoice\s+(?:Number\s*\n\s*)?([A-Z0-9]{3,15})\n/i);
        const invoiceNumber = invMatch?.[1]?.trim() || "";

        // Date — handles "May 28, 2020", "12/05/2024", "Apr/10/2026" etc.
        const dateMatch = text.match(/Date\s+of\s+Issue\s*[:\n]\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)
          || text.match(/Invoice\s+Date\s*[:\n]\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)
          || text.match(/Date\s*\n\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i)
          || text.match(/trans\.\s*date\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i)
          || text.match(/(\d{2}\/\d{2}\/\d{4})/);
        let billDate = dateMatch?.[1] || "";
        // Convert "May 28, 2020" → "05/28/2020"
        if (billDate && /[A-Za-z]/.test(billDate)) {
          const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
          const mp = billDate.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
          if (mp) billDate = `${months[mp[1].toLowerCase().slice(0,3)]}/${mp[2].padStart(2,'0')}/${mp[3]}`;
        }

        // Vendor — first non-empty line that looks like a company (not date, order#, receipt header)
        const firstLines = text.split("\n").map(l => l.trim()).filter(Boolean);
        const vendorLine = firstLines.find(l =>
          l.length > 3 && l.length < 60 &&
          !/^(order|receipt|invoice|date|ref|bill|paid|bond|april|may|june|july|august|september|october|november|december|january|february|march|\d)/i.test(l) &&
          !/\$|^\d|\d{4}/.test(l) // skip lines with dollar signs or numbers
        );
        // Extract from filename: "WX7CCEC7FE_Surety_Bonds_Direct_Receipt_WX4FAF2F3E" → "Surety Bonds Direct"
        const fnMatch = file.originalname.match(/[A-Z0-9]+_([A-Za-z][A-Za-z_]+?)_(?:Receipt|Invoice)/i);
        const fnVendor = fnMatch ? fnMatch[1].replace(/_/g, " ").trim() : null;
        // Also try "INVOICE_30023_from_SAVANNAH..." → "SAVANNAH AUTO EXPORT LLC"
        const fromMatch = file.originalname.match(/_from_([^_\.]+(?:_[^_\.]+)*?)(?:_\d|\.\w)/i);
        const fromVendor = fromMatch ? fromMatch[1].replace(/_/g," ").trim() : null;
        const vendor = fnVendor || fromVendor || vendorLine || "";

        // Total — "Amount Due", "Total Cost", or paid amount
        const amtMatch = text.match(/Amount\s+Due\s*(?:\(USD\))?\s*[\$]?\s*([\d,]+\.\d{2})/i)
          || text.match(/Total\s+Cost\s*[\$]?\s*([\d,]+\.\d{2})/i)
          || text.match(/Total\s*\n\s*([\d,]+\.\d{2})/i)
          || text.match(/TOTAL\s+([\d,]+\.\d{2})/i)
          || text.match(/Amount\s*([\d,]+\.\d{2})/i);
        const total = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, "")) : 0;

        // Already paid?
        const isPaid = /PAID\s+IN\s+FULL|paid\s+in\s+full/i.test(text);

        // Category guess from content
        let category = "Port / Terminal Fees";
        const lc = text.toLowerCase();
        if (lc.includes("bond") || lc.includes("surety") || lc.includes("legal") || lc.includes("nvocc") || lc.includes("oti bond")) category = "Legal Fees";
        else if (lc.includes("software") || lc.includes("subscription") || lc.includes("saas")) category = "Software";
        else if (lc.includes("towing") || lc.includes("transport") || lc.includes("dispatch") || lc.includes("delivery")) category = "Towing / Transport";
        else if (lc.includes("loading") || lc.includes("warehouse") || lc.includes("storage") || lc.includes("port del")) category = "Loaders & Warehouses";
        else if (lc.includes("ocean freight") || lc.includes("shipping fee")) category = "Ocean Freight";
        else if (lc.includes("office") || lc.includes("admin") || lc.includes("postage")) category = "Office & Admin";

        // Description — bond type, first line item, or vendor
        const descMatch = text.match(/Receipt\s+for\s+([^\n]{5,80})/i)
          || text.match(/Description\s*Rate\s*Qty[^\n]*\n([^\n]{5,80})/i)
          || text.match(/(?:PORT|LOADING|TOWING|STORAGE|OCEAN|BOND|PREMIUM)\s+[^\n]{3,60}/i);
        const description = descMatch?.[1]?.trim() || vendor;

        // Try full VIN first
        const fullVin = text.match(/[A-HJ-NPR-Z0-9]{17}/)?.[0] || "";

        // Partial VIN — "VIN XXXXXX" or "Reference: XXXXXX" (6+ alphanum)
        const partialMatch = text.match(/VIN\s+([A-HJ-NPR-Z0-9]{6,})/i)
          || text.match(/Reference\s*[:\n]\s*([A-HJ-NPR-Z0-9]{6,})/i);
        const partialVin = partialMatch?.[1]?.trim() || "";

        // Match order — by full VIN first, then by partial (last N chars)
        let order = null;
        if (fullVin) {
          order = await Order.findOne({ vin: { $regex: `^${fullVin}$`, $options: "i" } })
            .select("_id refNumber vin customerName year make model").lean();
        }
        if (!order && partialVin) {
          order = await Order.findOne({ vin: { $regex: `${partialVin}$`, $options: "i" } })
            .select("_id refNumber vin customerName year make model").lean();
        }

        // Save the file to Drive — to the matched order's folder if found, else the general Bills folder
        let billFile = null;
        try { billFile = await saveUploadedFile(file.buffer, file.originalname, "application/pdf", order?._id || null); } catch {}

        results.push({
          fileName:     file.originalname,
          invoiceNumber,
          billDate,
          vendor,
          total,
          category,
          description,
          isPaid,
          vin:          fullVin || partialVin,
          billFileName: billFile?.fname || "",
          billDriveId:  billFile?.driveId || "",
          billDriveUrl: billFile?.driveUrl || "",
          orderId:      order?._id || null,
          orderRef:     order?.refNumber || "",
          customerName: order?.customerName || "",
          ymm:          order ? [order.year, order.make, order.model].filter(Boolean).join(" ") : "",
          matched:      !!order,
          skip:         false,
          notes:        "",
        });
      } catch (e) {
        results.push({ fileName: file.originalname, error: e.message, skip: true, total: 0 });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error("parse-misc error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/apply-misc ─────────────────────────────────────────────
router.post("/apply-misc", express.json(), async (req, res) => {
  try {
    const { results } = req.body;
    if (!results?.length) return res.status(400).json({ error: "No data" });

    let created = 0;
    for (const row of results) {
      if (row.skip || !row.total) continue;

      let orderId = row.orderId || null;
      let orderRef = row.orderRef || "";
      if (!orderId && orderRef) {
        const o = await Order.findOne({ refNumber: { $regex: `^${orderRef}$`, $options: "i" } })
          .select("_id refNumber").lean();
        if (o) { orderId = o._id; orderRef = o.refNumber; }
      }

      let dateObj = new Date();
      if (row.billDate) {
        const [m, d, y] = row.billDate.split("/");
        if (m && d && y) dateObj = new Date(`${y}-${m}-${d}`);
      }

      await Expense.create({
        category:      row.category || "Port / Terminal Fees",
        description:   `${row.description || row.vendor}${row.vin ? ` — VIN: ${row.vin}` : ""}`.trim(),
        vendor:        row.vendor || "",
        amount:        row.total,
        date:          dateObj,
        orderId:       orderId || null,
        orderRef:      orderRef || "",
        invoiceNumber: row.invoiceNumber || "",
        status:        row.isPaid ? "paid" : "unpaid",
        paidDate:      row.isPaid ? dateObj : null,
        notes:         row.notes || "",
        billFileName:  row.billFileName || "",
        billDriveId:   row.billDriveId  || "",
        billDriveUrl:  row.billDriveUrl || "",
        billMime:      row.billFileName ? "application/pdf" : "",
      });
      created++;
    }

    res.json({ created });
  } catch (err) {
    console.error("apply-misc error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/parse-payment-proof — parse a bank "Operation Proof" /
//     ACH batch payment confirmation PDF and match each payee line to the
//     matching unpaid bill(s) on file by order ref (the "Addenda" field).
router.post("/parse-payment-proof", memUpload.single("proof"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    // Save the proof PDF once — it covers the whole batch, so it lives in the
    // general Receipts folder and gets linked as the receipt on every bill
    // it pays, rather than duplicated into each order's own folder.
    let proofFile = null;
    try {
      const driveFile = await uploadFileToDriveExpenses(req.file.buffer, req.file.originalname, "application/pdf", "receipt", null);
      proofFile = { fname: driveFile.name, driveId: driveFile.id, driveUrl: driveFile.webViewLink };
    } catch (e) { console.warn("[Payment Proof] Drive upload failed:", e.message); }

    const data = await pdfParse(req.file.buffer);
    // Strip the repeating page header/footer boilerplate ("Operation Proof",
    // bank name/address/URL, "Processed by computer | date | Page X of Y").
    // Without this, a payee block that spans a page break swallows the next
    // page's header text into whatever field comes right after it.
    const text = data.text
      .replace(/Processed by computer\s*\|[^\n]*\|\s*Page\s*\d+\s*of\s*\d+/gi, " ")
      .replace(/Metropolitan Commercial Bank/gi, " ")
      .replace(/99 Park Ave,?\s*New York,?\s*NY\s*10016/gi, " ")
      .replace(/https?:\/\/mcbankny\.com\/?/gi, " ")
      .replace(/^Operation Proof\s*$/gim, " ");

    // Payment date for the whole batch (used as default paidDate)
    const payDateMatch = text.match(/Payment\s*Date\s*([\d]{1,2}\/[\d]{1,2}\/[\d]{4})/i);
    const batchPaidDate = payDateMatch?.[1] || "";

    const FIELD_BOUNDARY = "(?=Payee Name|Account Number|Amount|Destination Bank Name|Routing Number|Addenda|Recurrence|Payment Date|Total Payments|Authorizations|$)";
    const grab = (str, label) => {
      const re = new RegExp(label + "\\s*([\\s\\S]*?)" + FIELD_BOUNDARY, "i");
      const m = str.match(re);
      return m ? m[1].replace(/\s+/g, " ").trim() : "";
    };

    // Split into one chunk per "Payee Name" occurrence
    const idxs = [];
    const peRe = /Payee Name/gi;
    let pm;
    while ((pm = peRe.exec(text))) idxs.push(pm.index);
    idxs.push(text.length);

    const rows = [];
    for (let i = 0; i < idxs.length - 1; i++) {
      const chunk = text.slice(idxs[i], idxs[i + 1]);
      const payeeName  = grab(chunk, "Payee Name");
      const amountStr  = grab(chunk, "Amount");
      const amountM    = amountStr.match(/([\d,]+\.\d{2})/);
      const amount     = amountM ? parseFloat(amountM[1].replace(/,/g, "")) : 0;
      const addenda    = grab(chunk, "Addenda");
      if (!payeeName || !amount) continue;

      // Addenda formats seen in practice:
      //   "13798"                       — plain order ref
      //   "13825 PLUS WRAPPING"         — order ref + note (combined charges)
      //   "BK 87000667 REF 13315"       — bank's own ref, then our order ref after "REF"
      //   "BK# 24597256 REF# 13038"     — same, but with "#" after the labels
      //   "S3-29358436 S3-29436152"     — booking number(s) only, no order ref
      // Long Addenda values can wrap across a PDF line break, which collapses
      // to a literal space mid-token after whitespace normalization (e.g.
      // "S3-29305517" → "S3- 29305517") — tolerate that with \s* and strip it
      // back out so the stored value is clean.
      const refMatch = addenda.match(/^(\d{3,8})\b/) || addenda.match(/REF\.?#?:?\s*(\d{3,8})\b/i);
      const orderRef = refMatch?.[1] || "";
      const note      = addenda; // always show the raw addenda for context

      // Multiple booking numbers (e.g. "S3-29358436 S3-29436152") or multiple
      // plain order refs (e.g. "13734 13754 13759") mean this single payment
      // covers more than one order — flag it so the UI can offer a split.
      const bookingNumbers = [...addenda.matchAll(/S3-\s*\d+/gi)].map(m => m[0].replace(/\s+/g, ""));
      // Exclude the digits already claimed by booking numbers so they don't
      // also get picked up as "plain order refs".
      const addendaSansBookings = addenda.replace(/S3-\s*\d+/gi, " ");
      const plainRefs = [...new Set((addendaSansBookings.match(/\b\d{3,8}\b/g) || []))];
      const isMultiBooking = bookingNumbers.length > 1 || plainRefs.length > 1;
      // What to pre-fill the Split form with — real order refs are far more
      // useful than booking numbers when we have them.
      const splitSeed = plainRefs.length > 1 ? plainRefs : bookingNumbers;

      // Find candidate unpaid expenses tied to this order ref
      let candidates = [];
      let matchedIds = [];
      let matchType = "none";
      let alreadyPaid = [];
      if (orderRef) {
        candidates = await Expense.find({
          orderRef: { $regex: `^${esc(orderRef)}$`, $options: "i" },
          status: "unpaid",
        }).select("_id description vendor amount").lean();

        // If nothing unpaid, check whether it was already paid (covers bills
        // marked paid manually before this proof was uploaded)
        if (!candidates.length) {
          alreadyPaid = await Expense.find({
            orderRef: { $regex: `^${esc(orderRef)}$`, $options: "i" },
            status: "paid",
          }).select("_id description vendor amount paidDate receiptFileName").lean();
        }

        if (candidates.length) {
          // 1. Single expense exactly matching the payment amount
          const exact = candidates.find(c => Math.abs(c.amount - amount) < 0.01);
          if (exact) {
            matchedIds = [exact._id];
            matchType = "exact";
          } else {
            // 2. Subset of candidates whose amounts sum to the payment amount
            //    (covers combined payments, e.g. "PLUS WRAPPING")
            const n = candidates.length;
            let found = null;
            for (let mask = 1; mask < (1 << n) && !found; mask++) {
              let sum = 0;
              const subset = [];
              for (let b = 0; b < n; b++) {
                if (mask & (1 << b)) { sum += candidates[b].amount; subset.push(candidates[b]); }
              }
              if (Math.abs(sum - amount) < 0.01) found = subset;
            }
            if (found) {
              matchedIds = found.map(c => c._id);
              matchType = "combined";
            } else {
              matchType = "review"; // candidates exist but none sum to the amount
            }
          }
        } else if (alreadyPaid.length) {
          const sumPaid = alreadyPaid.reduce((s, c) => s + c.amount, 0);
          matchType = Math.abs(sumPaid - amount) < 0.01 ? "already_paid" : "already_paid_mismatch";
        }
      }

      // Multiple plain order refs in one Addenda (e.g. "13734 13754 13759")
      // — try to find the bills across ALL of those orders before asking
      // the user to split manually.
      if ((matchType === "none" || matchType === "review") && plainRefs.length > 1) {
        const multi = await Expense.find({
          orderRef: { $in: plainRefs.map(r => new RegExp(`^${esc(r)}$`, "i")) },
        }).select("_id description vendor amount orderRef status paidDate receiptFileName").lean();

        if (multi.length) {
          const unpaidMulti = multi.filter(c => c.status === "unpaid");
          const paidMulti   = multi.filter(c => c.status === "paid");
          const sumUnpaid   = unpaidMulti.reduce((s, c) => s + c.amount, 0);
          const sumPaid     = paidMulti.reduce((s, c) => s + c.amount, 0);

          if (unpaidMulti.length && Math.abs(sumUnpaid - amount) < 0.01) {
            candidates = unpaidMulti;
            matchedIds = unpaidMulti.map(c => c._id);
            matchType = "combined";
          } else if (!unpaidMulti.length && paidMulti.length) {
            alreadyPaid = paidMulti;
            matchType = Math.abs(sumPaid - amount) < 0.01 ? "already_paid" : "already_paid_mismatch";
          } else {
            candidates = multi;
            matchType = "review";
          }
        }
      }

      // Fallback for multi-booking payments with no plain order ref (e.g. the
      // ACL "S3-xxxxx" case) — these get split into bills whose description
      // contains the booking number, so match on vendor + booking number
      // instead of order ref.
      if (matchType === "none" && bookingNumbers.length) {
        const bookingOr = bookingNumbers.map(bn => ({ description: { $regex: esc(bn), $options: "i" } }));
        const byBooking = await Expense.find({
          vendor: { $regex: `^${esc(payeeName)}$`, $options: "i" },
          $or: bookingOr,
        }).select("_id description vendor amount status paidDate receiptFileName orderRef").lean();

        if (byBooking.length) {
          const paidOnes   = byBooking.filter(c => c.status === "paid");
          const unpaidOnes = byBooking.filter(c => c.status === "unpaid");
          const sumPaid    = paidOnes.reduce((s, c) => s + c.amount, 0);
          const sumUnpaid  = unpaidOnes.reduce((s, c) => s + c.amount, 0);

          if (paidOnes.length && Math.abs(sumPaid - amount) < 0.01 && !unpaidOnes.length) {
            alreadyPaid = paidOnes;
            matchType = "already_paid";
          } else if (unpaidOnes.length) {
            candidates = unpaidOnes;
            if (Math.abs(sumUnpaid - amount) < 0.01) {
              matchedIds = unpaidOnes.map(c => c._id);
              matchType = unpaidOnes.length === 1 ? "exact" : "combined";
            } else {
              matchType = "review";
            }
          } else if (paidOnes.length) {
            alreadyPaid = paidOnes;
            matchType = "already_paid_mismatch";
          }
        }
      }

      rows.push({
        payeeName,
        amount,
        orderRef,
        note,
        batchPaidDate,
        candidates,
        alreadyPaid,
        matchedIds,
        matchType,
        bookingNumbers,
        isMultiBooking,
        splitSeed,
        selected: matchType === "exact" || matchType === "combined",
      });
    }

    res.json({ rows, batchPaidDate, totalPayments: rows.length, proofFile });
  } catch (err) {
    console.error("parse-payment-proof error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/apply-payment-proof — mark the matched bills paid ──────
router.post("/apply-payment-proof", express.json(), async (req, res) => {
  try {
    const { rows, paymentMethod, proofFile } = req.body;
    if (!rows?.length) return res.status(400).json({ error: "No rows provided" });

    const receiptFields = proofFile?.driveId ? {
      receiptFileName: proofFile.fname || "",
      receiptDriveId:  proofFile.driveId,
      receiptDriveUrl: proofFile.driveUrl || "",
      receiptMime:     "application/pdf",
    } : {};

    let updated = 0;
    let created = 0;
    let attached = 0;
    for (const row of rows) {
      if (!row.selected) continue;
      const dateObj = row.batchPaidDate ? new Date(row.batchPaidDate) : new Date();

      if (row.matchedIds?.length) {
        const result = await Expense.updateMany(
          { _id: { $in: row.matchedIds } },
          { $set: { status: "paid", paidDate: dateObj, paymentMethod: paymentMethod || "Bank ACH", ...receiptFields } }
        );
        updated += result.modifiedCount;
        continue;
      }

      // Already marked paid manually — just attach the proof, don't touch status/paidDate
      if (row.attachOnly && row.alreadyPaid?.length && Object.keys(receiptFields).length) {
        const ids = row.alreadyPaid.map(c => c._id);
        const result = await Expense.updateMany(
          { _id: { $in: ids } },
          { $set: receiptFields }
        );
        attached += result.modifiedCount;
        continue;
      }

      // Payment covers multiple orders — create one bill per split line
      if (row.splitBills?.length) {
        // Build a map of orderRef → candidate _id for unpaid candidates on this row
        const candidateMap = {};
        for (const c of (row.candidates || [])) {
          if (c.status !== "paid" && c.orderRef) {
            candidateMap[c.orderRef.trim().toLowerCase()] = c._id;
          }
        }

        for (const split of row.splitBills) {
          if (!split.amount) continue;
          if (split.createBill === false) continue;

          const refKey = (split.orderRef || "").trim().toLowerCase();

          // 1. Prefer marking a known candidate for this order ref as paid
          if (refKey && candidateMap[refKey]) {
            await Expense.updateOne(
              { _id: candidateMap[refKey] },
              { $set: { status: "paid", paidDate: dateObj, paymentMethod: paymentMethod || "Bank ACH", ...receiptFields } }
            );
            updated++;
            continue;
          }

          // 2. Fall back: look for any existing unpaid bill with same vendor + orderRef
          const existingQuery = {
            vendor: { $regex: `^${esc((row.payeeName || "").trim())}$`, $options: "i" },
            status: { $in: ["unpaid", "partial"] },
          };
          if (split.orderRef) existingQuery.orderRef = { $regex: `^${esc(split.orderRef.trim())}$`, $options: "i" };
          const existing = await Expense.findOne(existingQuery).lean();

          if (existing) {
            await Expense.updateOne(
              { _id: existing._id },
              { $set: { status: "paid", paidDate: dateObj, paymentMethod: paymentMethod || "Bank ACH", ...receiptFields } }
            );
            updated++;
          } else {
            // 3. No existing bill found — create a new paid one
            let orderId = null;
            if (split.orderRef) {
              const o = await Order.findOne({ refNumber: { $regex: `^${esc(split.orderRef)}$`, $options: "i" } })
                .select("_id refNumber").lean();
              if (o) orderId = o._id;
            }
            await Expense.create({
              category:      split.category || "Port / Terminal Fees",
              description:   split.description || row.payeeName,
              vendor:        row.payeeName,
              amount:        Number(split.amount) || 0,
              date:          dateObj,
              orderId,
              orderRef:      split.orderRef || "",
              status:        "paid",
              paidDate:      dateObj,
              paymentMethod: paymentMethod || "Bank ACH",
              ...receiptFields,
            });
            created++;
          }
        }
        continue;
      }

      // No bill on file at all — create one now from the payment proof details
      if (row.createBill) {
        let orderId = null;
        if (row.orderRef) {
          const o = await Order.findOne({ refNumber: { $regex: `^${esc(row.orderRef)}$`, $options: "i" } })
            .select("_id refNumber").lean();
          if (o) orderId = o._id;
        }
        await Expense.create({
          category:      row.newCategory || "Port / Terminal Fees",
          description:   row.newDescription || row.payeeName,
          vendor:        row.payeeName,
          amount:        row.amount,
          date:          dateObj,
          orderId,
          orderRef:      row.orderRef || "",
          status:        "paid",
          paidDate:      dateObj,
          paymentMethod: paymentMethod || "Bank ACH",
          ...receiptFields,
        });
        created++;
      }
    }

    res.json({ updated, created, attached });
  } catch (err) {
    console.error("apply-payment-proof error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/parse-storage-url — parse Copart/auction storage receipt ──
router.post("/parse-storage-url", express.json(), async (req, res) => {
  try {
    const { url, filename, orderRef, orderId } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });

    // Fetch from Google Drive proxy
    const Order = require("../models/Order");
    const { drive } = require("../googleDrive");

    // Extract Drive file ID from the webViewLink
    const driveIdMatch = url.match(/\/d\/([^/?]+)/) || url.match(/[?&]id=([^&]+)/);
    if (!driveIdMatch) return res.status(400).json({ error: "Cannot resolve Drive file ID from URL" });
    const driveId = driveIdMatch[1];

    // Use the existing Drive client (same one used by the proxy endpoint)
    const fileRes = await drive.files.get({ fileId: driveId, alt: "media" }, { responseType: "arraybuffer" });
    const buffer = Buffer.from(fileRes.data);

    const pdfParse = require("pdf-parse");
    const { text } = await pdfParse(buffer);

    // Parse Copart-style storage receipt
    const amountMatch = text.match(/\$([\d,]+(?:\.\d{2})?)\s*USD/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : 0;

    const lotMatch = text.match(/Invoice\s*\/\s*lot\s*#\s*[:\-]?\s*(\d+)/i);
    const lotNumber = lotMatch?.[1] || "";

    const dateMatch = text.match(/Date\s+submitted\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const date = dateMatch?.[1] || "";

    const ymmMatch = text.match(/(\d{4})\s+([A-Z][A-Z0-9a-z]+)\s+([A-Z0-9a-z ]+?)(?:\n|Sale yard|$)/m);
    const ymm = ymmMatch ? `${ymmMatch[1]} ${ymmMatch[2]} ${ymmMatch[3].trim()}` : "";

    const yardMatch = text.match(/Sale\s+yard\s*[:\-]?\s*([^\n]+)/i);
    const yard = yardMatch?.[1]?.trim() || "";

    const vendor = text.toLowerCase().includes("copart") ? "Copart" :
                   text.toLowerCase().includes("iaai") ? "IAAI" : "Auction";

    // Try to match order: 1) by orderId passed in, 2) by ref# in filename, 3) by lot number
    let matchedOrder = null;
    if (orderId) {
      matchedOrder = await Order.findById(orderId).select("refNumber _id").lean();
    }
    if (!matchedOrder && filename) {
      // Extract leading number from filename e.g. "13809 storage paid.pdf" → "13809"
      const refFromName = (filename || "").match(/^(\d+)/);
      if (refFromName) {
        matchedOrder = await Order.findOne({
          refNumber: { $regex: refFromName[1], $options: "i" }
        }).select("refNumber _id").lean();
      }
    }
    if (!matchedOrder && lotNumber) {
      matchedOrder = await Order.findOne({ lotNumber }).select("refNumber _id").lean();
    }

    res.json({
      amount, lotNumber, date, ymm, yard, vendor,
      orderId:  matchedOrder?._id  || orderId  || null,
      orderRef: matchedOrder?.refNumber || orderRef || "",
    });
  } catch (err) {
    console.error("parse-storage-url error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/expenses/:id ──────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: "Not found" });
    if (expense.status === "paid") return res.status(403).json({ error: "Cannot delete a paid expense. Mark it unpaid first." });
    deleteFile(expense.receiptFileName);
    deleteFile(expense.billFileName);
    await Expense.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

module.exports = router;


