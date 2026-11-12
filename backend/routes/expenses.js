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
const Vendor       = require("../models/Vendor");
const { uploadBufferToDrive, getOrCreateFolder, deleteDriveFile } = require("../googleDrive");
const { extractContainerInvoiceFields } = require("../utils/llmExtract");
const { appendAchRows } = require("../utils/achSheet");

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

// ── Category / tax-category normalization, enforced server-side on every create/update
// so it can't drift regardless of which form or import path created the expense.
// Mirrors TAX_BY_CATEGORY in frontend/src/pages/Expenses.jsx — keep the two in sync.
const TAX_BY_CATEGORY = {
  "Towing / Transport":   "Cost of Goods Sold (COGS)",
  "Ocean Freight":        "Cost of Goods Sold (COGS)",
  "Storage":              "Cost of Goods Sold (COGS)",
  "Port / Terminal Fees": "Cost of Goods Sold (COGS)",
  "Loaders & Warehouses": "Cost of Goods Sold (COGS)",
  "Software":             "Cost of Goods Sold (COGS)",
  "Mailing Fees":         "Cost of Goods Sold (COGS)",
  "Legal Fees":           "Operating Expense",
  "Office & Admin":       "Operating Expense",
  "General Overhead":     "Operating Expense",
  "Ghana Office":         "Cost of Goods Sold (COGS)",
};

// An unpaid bill has nothing paid on it. Bills marked Unpaid before that
// cleared their history can still carry an old paidAmount/payments — drop
// them so a new payment isn't added on top of one that was undone.
function clearStalePayments(exp) {
  if (exp.status !== "unpaid") return;
  exp.paidAmount = 0;
  exp.payments   = [];
}

// ── Payment-proof matching helpers ────────────────────────────────────────────
// Vendor-name matching lives in utils/vendorMatch (shared with DR sends and trucker emails)
const { normVendorName, sameVendor, canonicalVendor } = require("../utils/vendorMatch");
const { parseAclChargeLines, parseSallaumTariffs, sallaumChargeLines, applyRatedBl } = require("../utils/ratedBl");

// Plain-text summary of an applied payment proof for the owner email:
// each vendor with its total, the order/amount lines under it, and a grand total.
function proofSummary(rows) {
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const owed  = (c) => c.status === "partial" ? c.amount - (c.paidAmount || 0) : c.amount;
  const byVendor = new Map();
  let total = 0, count = 0;
  for (const row of rows.filter(r => r.selected)) {
    const amt = Number(row.amount) || 0;
    let lines;
    if (row.splitBills?.length) {
      lines = row.splitBills.filter(s => Number(s.amount)).map(s => ({ ref: s.orderRef, amt: Number(s.amount) }));
    } else if ((row.matchedIds || []).length > 1) {
      const ids = row.matchedIds.map(String);
      const bills = (row.candidates || []).filter(c => ids.includes(String(c._id)));
      lines = bills.map(c => ({ ref: c.orderRef, amt: row.markPartial ? amt / bills.length : owed(c) }));
    } else {
      const bill = (row.candidates || []).find(c => String(c._id) === String(row.matchedIds?.[0]));
      lines = [{ ref: bill?.orderRef || row.orderRef, amt }];
    }
    const key = (row.payeeName || "—").trim();
    if (!byVendor.has(key)) byVendor.set(key, { total: 0, lines: [] });
    const v = byVendor.get(key);
    v.total += amt;
    v.lines.push(...lines);
    total += amt;
    count++;
  }
  const out = [];
  for (const [vendor, v] of byVendor) {
    out.push(`${vendor} — ${money(v.total)}`);
    for (const l of v.lines) out.push(`    #${l.ref || "—"}    ${money(l.amt)}`);
    out.push("");
  }
  out.push(`TOTAL: ${money(total)}  (${count} payment${count === 1 ? "" : "s"}, ${byVendor.size} vendor${byVendor.size === 1 ? "" : "s"})`);
  return out.join("\r\n");
}

// A proof reference is either one of our order refs ("13815") or a carrier
// booking ("S3-29771380") — resolve either to the order it belongs to.
async function resolveProofOrder(ref) {
  ref = (ref || "").trim();
  if (!ref) return null;
  const byRef = await Order.findOne({ refNumber: { $regex: `^${esc(ref)}$`, $options: "i" } }).select("_id refNumber").lean();
  if (byRef) return byRef;
  const digits = ref.replace(/^S3-?\s*/i, "").replace(/\s+/g, "");
  if (!/^\d{6,}$/.test(digits)) return null;
  return Order.findOne({ bookingNumber: { $regex: `(^|[^0-9])${digits}$`, $options: "i" } }).select("_id refNumber").lean();
}

// Before a payment proof creates a new bill, look for the bill that's already
// on file for that order and amount (any vendor spelling). Unpaid/partial ones
// come first — those should be paid, not duplicated.
async function findExistingProofBill(ref, amount, payeeName) {
  ref = (ref || "").trim();
  const order = await resolveProofOrder(ref);
  if (!amount || (!order && !/^\d{3,8}$/.test(ref))) return { order, bill: null };
  // Some bills carry only the order # (no linked order record), so match on that too
  const or = [{ orderRef: { $regex: `^${esc(order?.refNumber || ref)}$`, $options: "i" } }];
  if (order) or.push({ orderId: order._id });
  const bills = await Expense.find({
    $or: or,
    amount: { $gte: Number(amount) - 0.01, $lte: Number(amount) + 0.01 },
  }).sort({ createdAt: 1 });
  // Open bills before paid ones; within each, the payee's own bill first
  const rank = (b) => (b.status !== "paid" ? 0 : 2) + (sameVendor(b.vendor, payeeName) ? 0 : 1);
  return { order, bill: bills.sort((a, b) => rank(a) - rank(b))[0] || null };
}

// Record a proof payment on an existing bill (full remaining balance unless an amount is given)
function payFromProof(exp, { amount, date, method, receiptFields }) {
  clearStalePayments(exp);
  const prev = exp.paidAmount || 0;
  const amt  = amount != null ? Number(amount) : Math.max(exp.amount - prev, 0);
  exp.payments.push({ amount: amt, date, method, notes: "" });
  exp.paidAmount    = prev + amt;
  exp.paidDate      = date;
  exp.paymentMethod = method;
  exp.status        = exp.paidAmount >= exp.amount - 0.005 ? "paid" : "partial";
  if (exp.status === "paid") exp.toPay = false;
  if (receiptFields?.receiptDriveId) Object.assign(exp, receiptFields);
  return exp.save();
}

// Vendors that are always Loaders & Warehouses, regardless of what category the
// form/import submitted.
const LOADER_WAREHOUSE_VENDOR_RX = /e-?z\s*cargo|savannah|i-?ship|cedars/i;

// Shipping lines — always Ocean Freight, not Port / Terminal Fees.
const OCEAN_FREIGHT_VENDOR_RX = /sallaum|acl\b|grimaldi|wallenius|eukor/i;

function enforceVendorCategory(data) {
  if (LOADER_WAREHOUSE_VENDOR_RX.test(data.vendor || "")) {
    data.category = "Loaders & Warehouses";
  } else if (OCEAN_FREIGHT_VENDOR_RX.test(data.vendor || "")) {
    data.category = "Ocean Freight";
  }
  if (!data.taxCategory) {
    data.taxCategory = TAX_BY_CATEGORY[data.category] || "";
  }
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

// Auto-save vendor name to Vendor collection when a new one is used on an expense
async function ensureVendor(name, category) {
  if (!name?.trim()) return;
  try {
    await Vendor.findOneAndUpdate(
      { name: { $regex: `^${esc(name.trim())}$`, $options: "i" } },
      { $setOnInsert: { name: name.trim(), category: category || "" } },
      { upsert: true, new: false }
    );
  } catch (_) {}
}

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
    const { search, category, status, from, to, orderRef, vendor } = req.query;
    const q = {};

    if (category) q.category = category;
    if (status)   q.status   = status;
    if (vendor)   q.vendor   = { $regex: esc(vendor), $options: "i" };
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

// ── GET /api/expenses/by-ids — refresh candidate data for bill picker ────────
router.get("/by-ids", async (req, res) => {
  try {
    const ids = (req.query.ids || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.json([]);
    const exps = await Expense.find({ _id: { $in: ids } })
      .select("_id description vendor amount paidAmount status orderRef orderId")
      .populate("orderId", "bookingNumber").lean();
    res.json(exps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/expenses/to-pay — unpaid/partial trucking bills, one row per unit ─
// Feeds the "Truckers to Pay" list; the page groups the rows by vendor.
router.get("/to-pay", async (req, res) => {
  try {
    const bills = await Expense.find({ category: "Towing / Transport", status: { $in: ["unpaid", "partial"] } })
      .select("_id vendor amount paidAmount status orderRef orderId date invoiceNumber description toPay")
      .sort({ date: 1 }).lean();

    const refs   = [...new Set(bills.map(b => b.orderRef).filter(Boolean))];
    const orders = await Order.find({ refNumber: { $in: refs } })
      .select("refNumber year make model vin pickupCity pickupState pickupLocation").lean();
    const byRef  = Object.fromEntries(orders.map(o => [o.refNumber, o]));

    res.json(bills.map(b => {
      const o = byRef[b.orderRef] || {};
      return {
        _id:           b._id,
        vendor:        b.vendor || "—",
        orderRef:      b.orderRef || "",
        orderId:       b.orderId || null,
        invoiceNumber: b.invoiceNumber || "",
        description:   b.description || "",
        vehicle:       [o.year, o.make, o.model].filter(Boolean).join(" "),
        vin:           o.vin || "",
        pickup:        [o.pickupCity, o.pickupState].filter(Boolean).join(", ") || o.pickupLocation || "",
        date:          b.date,
        amount:        b.amount,
        status:        b.status,
        owed:          b.status === "partial" ? Math.max(b.amount - (b.paidAmount || 0), 0) : b.amount,
        toPay:         !!b.toPay,
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/expenses/to-pay — tick/untick bills on the Truckers to Pay list ─
// Body: { ids: [...], toPay: true|false }
router.patch("/to-pay", express.json(), async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: "No expense IDs provided" });
    const { modifiedCount } = await Expense.updateMany({ _id: { $in: ids } }, { $set: { toPay: !!req.body.toPay } });
    res.json({ updated: modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Duplicate bills ───────────────────────────────────────────────────────────
// Two bills for the same order, category and amount are almost always one bill
// entered twice — typically a payment proof that didn't match the existing bill
// and created a paid copy, leaving the original unpaid.
const DUP_FIELDS = "vendor amount status paidAmount paidDate paymentMethod payments invoiceNumber vin description date createdAt " +
  "orderRef orderId category billFileName billDriveId receiptFileName receiptDriveId";
const vinIn = (e) => (e.vin || (e.description || "").match(/VIN:\s*([A-HJ-NPR-Z0-9]{11,17})/i)?.[1] || "").toUpperCase();

// GET /api/expenses/duplicates — groups of likely-duplicate bills
router.get("/duplicates", async (req, res) => {
  try {
    const [bills, orders] = await Promise.all([
      Expense.find({}).select(DUP_FIELDS).lean(),
      Order.find({}).select("_id refNumber vin").lean(),
    ]);
    const refById  = Object.fromEntries(orders.map(o => [String(o._id), o.refNumber]));
    const refByVin = Object.fromEntries(orders.filter(o => (o.vin || "").length >= 11).map(o => [o.vin.toUpperCase(), o.refNumber]));
    const refOf = (e) => e.orderRef || refById[String(e.orderId)] || refByVin[vinIn(e)] || "";

    const groups = {};
    for (const e of bills) {
      const ref = refOf(e);
      if (!ref || !e.amount) continue;
      (groups[`${ref}|${e.category}|${Math.round(e.amount * 100)}`] ||= { orderRef: ref, category: e.category, amount: e.amount, bills: [] }).bills.push(e);
    }
    const out = Object.values(groups).filter(g => g.bills.length > 1).map(g => {
      // Compare the last 8 — imported VINs are sometimes missing a leading character
      const vins = new Set(g.bills.map(vinIn).filter(Boolean).map(v => v.slice(-8)));
      // Keep the bill with the most detail: invoice #, bill document, VIN, then the older one
      const score = (e) => (e.invoiceNumber ? 4 : 0) + (e.billDriveId || e.billFileName ? 2 : 0) + (vinIn(e) ? 1 : 0);
      const suggestedKeep = [...g.bills].sort((a, b) => score(b) - score(a) || new Date(a.createdAt) - new Date(b.createdAt))[0]._id;
      return { ...g, differentVehicles: vins.size > 1, suggestedKeep };
    }).sort((a, b) => a.orderRef.localeCompare(b.orderRef));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/expenses/duplicates/combine — fold one bill into another
// Body: { keepId, removeId }. The kept bill takes over the other's payment if it
// has none of its own, plus any document/invoice/VIN it's missing; the other is
// deleted. When both are paid it's one payment entered twice, so the kept
// bill's payment stands (not added together).
router.post("/duplicates/combine", express.json(), async (req, res) => {
  try {
    const { keepId, removeId } = req.body;
    if (!keepId || !removeId || keepId === removeId) return res.status(400).json({ error: "Pick two different bills." });
    const [keep, rm] = await Promise.all([Expense.findById(keepId), Expense.findById(removeId)]);
    if (!keep || !rm) return res.status(404).json({ error: "Bill not found — refresh the list." });

    if (keep.status === "unpaid" && rm.status !== "unpaid") {
      keep.status        = rm.status;
      keep.paidDate      = rm.paidDate;
      keep.paymentMethod = rm.paymentMethod;
      keep.paidAmount    = rm.paidAmount || (rm.status === "paid" ? keep.amount : 0);
      keep.payments      = rm.payments?.length ? rm.payments.map(p => p.toObject()) : [{
        amount: keep.paidAmount, date: rm.paidDate || rm.date, method: rm.paymentMethod || "",
        receiptFileName: rm.receiptFileName || "", receiptDriveId: rm.receiptDriveId || "",
        receiptDriveUrl: rm.receiptDriveUrl || "", receiptMime: rm.receiptMime || "",
      }];
      if (keep.status === "paid") keep.toPay = false;
    }
    for (const f of ["invoiceNumber", "vin", "orderRef", "orderId",
                     "billFileName", "billMime", "billDriveId", "billDriveUrl",
                     "receiptFileName", "receiptMime", "receiptDriveId", "receiptDriveUrl"]) {
      if (!keep[f] && rm[f]) keep[f] = rm[f];
    }
    await keep.save();
    await Expense.deleteOne({ _id: rm._id });
    res.json({ success: true, kept: keep });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
        { invoiceNumber: { $regex: v, $options: "i" } },
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
            vin, invoiceNumber, status, paidDate, notes, bankAccount, taxCategory,
            billDriveId, billDriveUrl } = req.body;

    if (!category || !description || !amount) {
      return res.status(400).json({ error: "Category, description, and amount are required." });
    }

    // Duplicate detection (skip if force=true)
    if (req.query.force !== "true" && amount && orderRef) {
      const checkDate = date ? new Date(date) : new Date();
      const window30  = 30 * 24 * 60 * 60 * 1000;
      const orderFilter = { orderRef: { $regex: `^${orderRef.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } };

      // VIN-based: same order + same amount (catches vendor name variations)
      const vinFromDesc = (description || "").match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i)?.[1] || vin || "";
      if (vinFromDesc) {
        const dupVin = await Expense.findOne({ ...orderFilter, vin: vinFromDesc, amount: parseFloat(amount) }).lean();
        if (dupVin) return res.status(409).json({ error: "Possible duplicate expense", existing: dupVin });
      }

      // Vendor + amount + date window
      if (vendor) {
        const existing = await Expense.findOne({
          ...orderFilter,
          vendor:   { $regex: `^${vendor.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
          amount:   parseFloat(amount),
          date:     { $gte: new Date(checkDate - window30), $lte: new Date(+checkDate + window30) },
        }).lean();
        if (existing) return res.status(409).json({ error: "Possible duplicate expense", existing });
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
      bankAccount:   bankAccount || "Metropolitan Bank 8042 (Business)",
      taxCategory:   taxCategory || "",
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

    enforceVendorCategory(data);

    // Duplicate guard: same orderRef + vendor + amount already exists and is unpaid
    if (data.orderRef && data.vendor && data.amount) {
      const dup = await Expense.findOne({
        orderRef: data.orderRef,
        vendor:   { $regex: `^${data.vendor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        amount:   data.amount,
        status:   { $ne: "paid" },
      }).lean();
      if (dup) {
        return res.status(409).json({ error: `Duplicate expense: an unpaid ${data.vendor} expense for $${data.amount} already exists on order ${data.orderRef} (ID: ${dup._id}).` });
      }
    }

    const expense = await Expense.create(data);
    ensureVendor(data.vendor, data.category);

    // When a Towing / Transport expense is created for an order, stamp the
    // trucker name onto the order so it's visible without opening expenses.
    if (data.category === "Towing / Transport" && data.vendor && resolvedOrderId) {
      Order.findByIdAndUpdate(resolvedOrderId, { dispatchCarrier: data.vendor }).catch(() => {});
    }
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
            invoiceNumber, status, paidDate, notes, vin, bankAccount, taxCategory } = req.body;

    let lineItems = [];
    if (req.body.lineItems) {
      try { lineItems = JSON.parse(req.body.lineItems); } catch {}
    }
    const extrasTotal = lineItems.reduce((s, l) => s + Number(l.amount || 0), 0);

    const update = {
      category, description, vendor, notes,
      vin:           vin !== undefined ? (vin || "") : undefined,
      invoiceNumber: invoiceNumber || "",
      bankAccount:   bankAccount || "",
      taxCategory:   taxCategory || "",
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

    const old = await Expense.findById(req.params.id)
      .select("receiptFileName billFileName receiptDriveId billDriveId orderId paidAmount status amount").lean();
    const linkedOrderId = orderId || old?.orderId || null;

    // If this bill already has a tracked payment and the form still says "paid",
    // don't trust that blindly — the total may have changed (e.g. a line item
    // added after the bill was fully paid). Recompute from the real paidAmount
    // so it correctly drops back to "partial" when the payment no longer covers
    // the new total. Falls back to old.amount when paidAmount wasn't tracked
    // (e.g. manually marked paid without going through the payment-proof flow).
    if (update.status === "paid" && update.amount != null) {
      const effectivePaid = old?.paidAmount > 0
        ? old.paidAmount
        : (old?.status === "paid" ? (old?.amount || 0) : 0);
      if (effectivePaid > 0) {
        update.status = effectivePaid >= update.amount - 0.005 ? "paid" : "partial";
        if (update.status === "partial") update.paidAmount = effectivePaid;
      }
    }

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

    enforceVendorCategory(update);
    const updated = await Expense.findByIdAndUpdate(
      req.params.id, { $set: update }, { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ error: "Expense not found" });
    ensureVendor(update.vendor, update.category);

    // Keep order's dispatchCarrier in sync when trucker name changes
    if (update.category === "Towing / Transport" && update.vendor && linkedOrderId) {
      Order.findByIdAndUpdate(linkedOrderId, { dispatchCarrier: update.vendor }).catch(() => {});
    }
    res.json(updated);
  } catch (err) {
    console.error("Expense update error:", err);
    res.status(500).json({ error: "Failed to update expense" });
  }
});

// ── POST /api/expenses/bulk-pay — mark many as paid, optional proof upload ────
router.post("/bulk-pay", upload.single("proof"), async (req, res) => {
  try {
    const ids             = JSON.parse(req.body.ids || "[]");
    const paidDate        = req.body.paidDate;
    const paymentMethod   = req.body.paymentMethod;
    const action          = req.body.action;
    const amountOverrides = req.body.amountOverrides ? JSON.parse(req.body.amountOverrides) : {};

    if (!ids || !ids.length) return res.status(400).json({ error: "No expense IDs provided" });
    const dateObj = paidDate ? new Date(paidDate) : new Date();

    if (action === "unpay") {
      // Undo the payments too — a leftover paidAmount would be added onto the next payment
      await Expense.updateMany({ _id: { $in: ids } }, { $set: { status: "unpaid", paidDate: null, paymentMethod: "", paidAmount: null, payments: [] } });
      return res.json({ updated: ids.length });
    }

    // Upload proof file once (if provided), attach to every expense being paid
    let proofFields = {};
    if (req.file) {
      try {
        const saved = await saveUploadedFile(req.file.buffer, req.file.originalname, req.file.mimetype, null);
        proofFields = { receiptFileName: saved.fname, receiptDriveId: saved.driveId, receiptDriveUrl: saved.driveUrl, receiptMime: req.file.mimetype };
      } catch (uploadErr) {
        console.warn("[bulk-pay] proof upload failed:", uploadErr.message);
      }
    }

    const setFields = {
      status: "paid",
      paidDate: dateObj,
      paymentMethod: paymentMethod || "",
      ...proofFields,
    };

    // Add a payment record to each expense
    const expenses = await Expense.find({ _id: { $in: ids } });
    await Promise.all(expenses.map(exp => {
      clearStalePayments(exp);
      const payAmt = amountOverrides[exp._id.toString()]
        ? parseFloat(amountOverrides[exp._id.toString()])
        : exp.amount;
      const isPartial = payAmt < exp.amount - 0.005;
      exp.payments.push({
        amount: payAmt,
        date:   dateObj,
        method: paymentMethod || "",
        notes:  "",
        ...proofFields,
      });
      const prevPaid = exp.paidAmount || 0;
      exp.paidAmount = prevPaid + payAmt;
      exp.status = exp.paidAmount >= exp.amount - 0.005 ? "paid" : "partial";
      exp.paidDate = dateObj;
      exp.paymentMethod = paymentMethod || "";
      if (proofFields.receiptFileName) Object.assign(exp, proofFields);
      return exp.save();
    }));

    res.json({ updated: ids.length });

    // Append to ACH PAYMENTS Google Sheet for Bank ACH payments
    if (paymentMethod && paymentMethod.toLowerCase().includes("ach")) {
      const achEntries = expenses.map(exp => ({
        paymentDate: dateObj,
        payee:       exp.vendor || exp.description || "",
        reference:   exp.orderRef || "",
        amount:      amountOverrides[exp._id.toString()]
                       ? parseFloat(amountOverrides[exp._id.toString()])
                       : exp.amount,
      }));
      appendAchRows(achEntries).catch(err =>
        console.warn("[bulk-pay] achSheet append failed:", err.message)
      );
    }
  } catch (err) {
    console.error("bulk-pay error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/expenses/:id — lightweight field update (e.g. assign orderRef) ─
router.patch("/:id", express.json(), async (req, res) => {
  try {
    const { orderRef } = req.body;
    const update = {};
    if (orderRef !== undefined) {
      update.orderRef = orderRef.trim();
      if (update.orderRef) {
        const o = await Order.findOne({ refNumber: { $regex: `^${update.orderRef}$`, $options: "i" } })
          .select("_id refNumber").lean();
        if (o) { update.orderId = o._id; update.orderRef = o.refNumber; }
      }
    }
    const exp = await Expense.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
    if (!exp) return res.status(404).json({ error: "Not found" });
    res.json(exp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/expenses/:id/pay — record a payment (full or partial) ─────────
router.patch("/:id/pay", upload.single("proof"), async (req, res) => {
  try {
    const { paidDate, paidAmount, paymentMethod, notes } = req.body;
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: "Not found" });
    clearStalePayments(expense);

    const payDate    = paidDate ? new Date(paidDate) : new Date();
    const payAmt     = paidAmount != null && paidAmount !== "" ? Number(paidAmount) : expense.amount;
    const prevPaid   = expense.paidAmount || 0;
    const newTotal   = prevPaid + payAmt;
    const isFullyPaid = newTotal >= expense.amount - 0.005;

    // Upload proof file to Drive if provided
    let proofFields = {};
    if (req.file) {
      try {
        const saved = await saveUploadedFile(req.file.buffer, req.file.originalname, req.file.mimetype, expense.orderId || null);
        proofFields = { receiptFileName: saved.fname, receiptDriveId: saved.driveId, receiptDriveUrl: saved.driveUrl, receiptMime: req.file.mimetype };
        // Also set as the top-level receipt if none exists
        if (!expense.receiptDriveId) {
          expense.receiptFileName = saved.fname;
          expense.receiptDriveId  = saved.driveId;
          expense.receiptDriveUrl = saved.driveUrl;
          expense.receiptMime     = req.file.mimetype;
        }
      } catch (uploadErr) {
        console.warn("[pay] proof upload failed:", uploadErr.message);
      }
    }

    expense.payments.push({
      amount: payAmt,
      date:   payDate,
      method: paymentMethod || expense.paymentMethod || "",
      notes:  notes || "",
      ...proofFields,
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

// ── GET /api/expenses/:id/payments/:idx/receipt — serve proof for one payment ─
router.get("/:id/payments/:idx/receipt", async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).lean();
    if (!expense) return res.status(404).json({ error: "Not found" });
    const payment = expense.payments?.[Number(req.params.idx)];
    if (!payment?.receiptDriveId) return res.status(404).json({ error: "No proof on file" });
    const { drive } = require("../googleDrive");
    const fileRes = await drive.files.get(
      { fileId: payment.receiptDriveId, alt: "media" },
      { responseType: "stream" }
    );
    res.setHeader("Content-Type", payment.receiptMime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${payment.receiptFileName || "proof"}"`);
    fileRes.data.pipe(res);
  } catch (err) {
    console.error("payment receipt error:", err.message);
    res.status(500).json({ error: "Failed to serve file" });
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

// ── POST /api/expenses/:id/attachments — upload a general attachment ──────────
router.post("/:id/attachments", upload.single("file"), async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: "Not found" });
    if (!req.file) return res.status(400).json({ error: "No file" });
    const saved = await saveUploadedFile(req.file.buffer, req.file.originalname, req.file.mimetype, expense.orderId || null);
    expense.attachments.push({ name: saved.fname, driveId: saved.driveId, driveUrl: saved.driveUrl, mime: req.file.mimetype });
    await expense.save();
    res.json(expense.attachments[expense.attachments.length - 1]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/expenses/:id/attachments/:idx — serve one attachment ─────────────
router.get("/:id/attachments/:idx", async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).lean();
    if (!expense) return res.status(404).json({ error: "Not found" });
    const att = expense.attachments?.[Number(req.params.idx)];
    if (!att?.driveId) return res.status(404).json({ error: "Not found" });
    const { drive } = require("../googleDrive");
    const fileRes = await drive.files.get({ fileId: att.driveId, alt: "media" }, { responseType: "stream" });
    res.setHeader("Content-Type", att.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${att.name}"`);
    fileRes.data.pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/expenses/:id/attachments/:idx — remove one attachment ─────────
router.delete("/:id/attachments/:idx", async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ error: "Not found" });
    const idx = Number(req.params.idx);
    const att = expense.attachments?.[idx];
    if (!att) return res.status(404).json({ error: "Not found" });
    if (att.driveId) { try { await deleteDriveFile(att.driveId); } catch (_) {} }
    expense.attachments.splice(idx, 1);
    await expense.save();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

    res.json({ invoiceNumber, invoiceDate, voyage, vessel, pol, pod, rows: result, tariffs: parseSallaumTariffs(text), billFileName: savedFile.fname, billDriveId: savedFile.driveId, billDriveUrl: savedFile.driveUrl, billMime: "application/pdf", sessionId });
  } catch (err) {
    console.error("parse-sallaum error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/apply-sallaum — bulk create expenses from parsed bill ──
router.post("/apply-sallaum", express.json(), async (req, res) => {
  try {
    const { invoiceNumber, invoiceDate, voyage, vessel, pol, pod, rows, tariffs,
            billFileName, billMime, billDriveId, billDriveUrl, sessionId } = req.body;
    const ratedChecks = [];
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

        // Split this car's charges (EBS + NR/FK lumped in "Other", EBS folded into a
        // newer BAF) and cross-check them against the order's charges + invoice.
        // Runs even when the expense is a duplicate.
        let ratedLines = [];
        if (orderId) {
          try {
            const ord = await Order.findById(orderId).select("pol").lean();
            ratedLines = sallaumChargeLines(row, tariffs || {}, pol || ord?.pol || "");
            if (ratedLines.length) {
              const r = await applyRatedBl(orderId, ratedLines, { source: `Sallaum ${invoiceNumber || ""}`.trim() });
              if (r.changed) ratedChecks.push({ orderRef, ...r });
            }
          } catch (e) { console.warn("[apply-sallaum] rated check failed:", e.message); }
        }

        // Skip creating a duplicate expense — check multiple signals
        const dupChecks = [];
        if (invoiceNumber && row.vin) dupChecks.push({ invoiceNumber, vin: row.vin });
        if (orderId) dupChecks.push({ orderId, category: "Ocean Freight", amount: row.total, vendor: "Sallaum Lines" });
        if (row.vin)  dupChecks.push({ vin: row.vin, category: "Ocean Freight", amount: row.total, vendor: "Sallaum Lines" });
        const duplicate = dupChecks.length
          ? await Expense.findOne({ $or: dupChecks }).lean()
          : null;

        // Build charge breakdown note
        const chargeParts = [];
        if (row.freight) chargeParts.push(`Freight: $${row.freight.toFixed(2)}`);
        if (row.baf)     chargeParts.push(`BAF: $${row.baf.toFixed(2)}`);
        if (row.thc)     chargeParts.push(`THC: $${row.thc.toFixed(2)}`);
        if (row.storage) chargeParts.push(`Storage: $${row.storage.toFixed(2)}`);
        if (row.other)   chargeParts.push(`Other/NR/FK: $${row.other.toFixed(2)}`);

        if (!duplicate) await Expense.create({
          category:      "Ocean Freight",
          taxCategory:   "Cost of Goods Sold (COGS)",
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
        if (!duplicate) {
          created.push(true);
          // Update order's oceanCost so it appears in P&L (only when the row couldn't be split)
          if (orderId && row.total && !ratedLines.length) {
            const ord = await Order.findById(orderId).select("charges").lean();
            const existing = parseFloat(ord?.charges?.oceanCost || 0);
            if (!existing || existing === 0) {
              await Order.findByIdAndUpdate(orderId, { $set: { "charges.oceanCost": String(row.total) } });
            }
          }
        }

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

    res.json({ created: created.length, ratedChecks });
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
        const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
        const vin = vinMatch?.[1] || "";

        // Total Price
        const priceMatch = text.match(/Total Price[\s\S]{0,30}?\$\s*([\d,]+(?:\.\d{2})?)/i)
          || text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
        const total = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : 0;

        // Load ID — just the numeric part e.g. "13744" from "13744/48096146 PORT"
        const loadMatch = text.match(/Load ID\s*\n\s*(\d+)/i)
          || text.match(/Dispatch Sheet Load\s+(\d+)/i)
          || text.match(/Load\s+(\d{4,})\//i);
        const loadId = loadMatch?.[1] || "";

        // pdf-parse puts each label on its own line, value on the next line
        const carrierM = text.match(/^Carrier\s*\n([^\n]+)/m);
        const carrier = carrierM ? carrierM[1].trim() : "Unknown Carrier";

        // Vehicle YMM
        const ymmRaw = text.match(/^Vehicle Year\/Make\/Model\s*\n([^\n]+)/im);
        const ymm = ymmRaw ? ymmRaw[1].trim() : "";

        // Origin — city on next line, auction/location on line after
        const originM = text.match(/^Origin\s*\n([^\n]+)\n([^\n]+)/m);
        const origin = originM ? (originM[1].replace(/-\s*$/, "").trim() + " " + originM[2].trim()).trim() : "";

        // Dispatch date
        const dateMatch = text.match(/Dispatch Date\s*\n(\d{2}\/\d{2}\/\d{4})/i)
          || text.match(/(\d{2}\/\d{2}\/\d{4})/);
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

      // Parse dispatch date — fall back to today if missing or unparseable
      let dateObj = new Date();
      if (row.dispatchDate) {
        const parts = row.dispatchDate.split("/");
        if (parts.length === 3) {
          const [m, d, y] = parts;
          const attempt = new Date(`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`);
          if (!isNaN(attempt)) dateObj = attempt;
        } else {
          const attempt = new Date(row.dispatchDate);
          if (!isNaN(attempt)) dateObj = attempt;
        }
      }

      const validExtras = (row.lineItems || []).filter(l => l.description?.trim() && Number(l.amount) > 0);
      const extrasTotal = validExtras.reduce((s, l) => s + Number(l.amount), 0);

      // Duplicate check: same order + load ID already exists
      if (orderId && row.loadId) {
        const dup = await Expense.findOne({ orderId, invoiceNumber: row.loadId }).lean();
        if (dup) continue;
      }
      if (orderId && row.total) {
        // Check by VIN + amount (catches same bill regardless of vendor name spelling)
        if (row.vin) {
          const dupVin = await Expense.findOne({
            orderId,
            vin:    row.vin,
            amount: row.total + extrasTotal,
          }).lean();
          if (dupVin) continue;
        }
        // Fallback: same order + same amount within 30 days (any vendor)
        const dup = await Expense.findOne({
          orderId,
          amount: row.total + extrasTotal,
          date:   { $gte: new Date(dateObj - 30*24*60*60*1000), $lte: new Date(+dateObj + 30*24*60*60*1000) },
          category: "Towing / Transport",
        }).lean();
        if (dup) continue;
      }

      const expense = await Expense.create({
        category:      "Towing / Transport",
        taxCategory:   "Cost of Goods Sold (COGS)",
        description:   `Transport — ${row.ymm || ""} — VIN: ${row.vin || ""} — ${row.origin || ""}`.trim().replace(/\s*—\s*$/, ""),
        vendor:        (await canonicalVendor(row.carrier)) || "Unknown Carrier",
        amount:        row.total + extrasTotal,
        date:          dateObj,
        orderId,
        orderRef,
        invoiceNumber: row.loadId || "",
        status:        "unpaid",
        toPay:         row.toPay !== false, // dispatch bills are queued to pay unless unticked
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
        const totalMatch =
          text.match(/TOTAL CHARGES PAYABLE AT ORIGIN IN USD[\s]+([\d,]+\.?\d*)/i) ||
          text.match(/TOTAL CHARGES PAYABLE AT\s+[\w ]+\s+USD\s+([\d,]+\.?\d*)/i) ||
          text.match(/TOTAL CHARGES\s+(?:USD\s*)?([\d,]+\.?\d*)/i);
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
        const chargeLines = parseAclChargeLines(text);

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

// ── POST /api/expenses/parse-acl-url — parse a Grimaldi/ACL rated BL already in Drive ──
// Body: { driveFileId, filename, orderId, orderRef }
router.post("/parse-acl-url", express.json(), async (req, res) => {
  try {
    const { driveFileId, filename, orderId, orderRef } = req.body;
    if (!driveFileId) return res.status(400).json({ error: "driveFileId required" });

    // Download the file from Drive into a temp buffer
    const { drive } = require("../googleDrive");
    const response = await drive.files.get(
      { fileId: driveFileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    const buffer = Buffer.from(response.data);

    const data = await pdfParse(buffer);
    const text = data.text;

    const vinMatch = text.match(/([A-HJ-NPR-Z0-9]{17})/);
    const vin = vinMatch?.[1] || "";

    const totalMatch =
      text.match(/TOTAL CHARGES PAYABLE AT ORIGIN IN USD[\s]+([\d,]+\.?\d*)/i) ||
      text.match(/TOTAL CHARGES PAYABLE AT\s+[\w ]+\s+USD\s+([\d,]+\.?\d*)/i) ||
      text.match(/TOTAL CHARGES\s+(?:USD\s*)?([\d,]+\.?\d*)/i);
    const total = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : 0;

    const refMatch = text.match(/Ref(?:erence)?\.?\s*No\.?\s*[:\s]*(\d{4,})/i) || text.match(/Ref#\s*[:\s]*(\d{4,})/i);
    const refNo = refMatch?.[1] || "";

    const bookingMatch = text.match(/S3[23]\d{7,}/);
    const bookingNo = bookingMatch?.[0] || "";

    const vvMatch = text.match(/([A-Z]{2,5}\d{4})\s*[-–]\s*((?:GRANDE|GOOD|AUTO|SPIRIT|ASIA|AFRICA|ATLANTIC|EURO|AMERICA|CONGO|\w+)[A-Z \w]*?)(?:\r?\n|$)/i);
    const voyage = vvMatch?.[1]?.trim() || "";
    const vessel = vvMatch?.[2]?.trim() || "";

    const polMatch = text.match(/\bPOL:\s*([^\n\r]+)/i) || text.match(/Port of loading\s*\r?\n([^\n]{3,60})/i);
    const podMatch = text.match(/\bPOD:\s*([^\n\r]+)/i) || text.match(/Port of discharge\s*\r?\n([^\n]{3,60})/i);
    const pol = (polMatch?.[1]?.trim() || "").replace(/\s+\d.*$/, "");
    const pod = (podMatch?.[1]?.trim() || "").replace(/\s+\d.*$/, "");

    const vehicleLineMatch = text.match(/\d USED UNPACKED VEHICLE.*?\n(.+?)\nModel Year (\d{4})/is);
    const ymm = vehicleLineMatch ? `${vehicleLineMatch[2]} ${vehicleLineMatch[1].trim()}` : "";

    let order = null;
    if (orderId) {
      order = await Order.findById(orderId).select("_id refNumber vin customerName year make model").lean();
    } else if (vin) {
      order = await Order.findOne({ vin: { $regex: `^${vin}$`, $options: "i" } }).select("_id refNumber vin customerName year make model").lean();
    }

    const row = {
      fileName: filename || driveFileId,
      vin, total, refNo, bookingNo, vessel, voyage, pol, pod, ymm, billDate: "",
      chargeLines: parseAclChargeLines(text),
      billFileName: filename || "", billDriveId: driveFileId, billDriveUrl: "", billMime: "application/pdf",
      orderId: order?._id || orderId || null,
      orderRef: order?.refNumber || orderRef || "",
      customerName: order?.customerName || "",
      matched: !!(order || orderId),
      skip: false,
      notes: "",
    };

    res.json({ rows: [row] });
  } catch (err) {
    console.error("parse-acl-url error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/expenses/apply-acl — bulk create ACL ocean freight expenses ──────
router.post("/apply-acl", express.json(), async (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: "No rows provided" });

    const created = [];
    const ratedChecks = [];
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

      // ACL's charge for this booking → the ACL BOOKED sheet's AMOUNT column (even on a re-import)
      if (row.total > 0 && (row.bookingNo || orderRef)) {
        try {
          const { setAclAmount } = require("../utils/aclSheet");
          await setAclAmount({ bookingNumber: row.bookingNo, refNumber: orderRef, amount: row.total });
        } catch (e) { console.warn("[apply-acl] sheet AMOUNT failed:", e.message); }
      }

      // Cross-check the rated BL's charge lines against the order + invoice (storage,
      // forklift, non-runner… become billed lines). Runs even when the bill is a dup.
      if (orderId && row.chargeLines?.length) {
        try {
          const r = await applyRatedBl(orderId, row.chargeLines, { source: `Rated BL ${row.bookingNo || ""}`.trim() });
          if (r.changed) ratedChecks.push({ orderRef, ...r });
        } catch (e) { console.warn("[apply-acl] rated BL check failed:", e.message); }
      }

      // Duplicate check — multiple layers so neither VIN nor orderId being missing lets a dup slip through
      if (orderId) {
        // 1. Same order + same amount + Ocean Freight category (catches re-runs regardless of VIN)
        const dupByOrder = await Expense.findOne({
          orderId, category: "Ocean Freight", amount: row.total,
          vendor: { $in: ["ACL / Grimaldi", "Grimaldi / ACL", "ACL", "Grimaldi"] },
        }).lean();
        if (dupByOrder) { console.log(`[apply-acl] skip dup orderId=${orderId} amount=${row.total}`); continue; }
      }
      if (row.vin) {
        // 2. Same VIN + same amount + Ocean Freight (catches when order wasn't linked yet on first run)
        const dupByVin = await Expense.findOne({
          vin: row.vin, category: "Ocean Freight", amount: row.total,
          vendor: { $in: ["ACL / Grimaldi", "Grimaldi / ACL", "ACL", "Grimaldi"] },
        }).lean();
        if (dupByVin) { console.log(`[apply-acl] skip dup vin=${row.vin} amount=${row.total}`); continue; }
      }

      const expense = await Expense.create({
        category:      "Ocean Freight",
        taxCategory:   "Cost of Goods Sold (COGS)",
        description:   `ACL Ocean Freight — ${row.ymm || ""} — VIN: ${row.vin || ""} — ${row.vessel || ""} ${row.voyage || ""}`.trim().replace(/\s*—\s*$/, ""),
        vendor:        "ACL / Grimaldi",
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

      // Update order's oceanCost so it shows in the order P&L (when the charge lines
      // weren't readable — otherwise applyRatedBl already set the split costs)
      if (orderId && row.total && !row.chargeLines?.length) {
        const ord = await Order.findById(orderId).select("charges").lean();
        const existing = parseFloat(ord?.charges?.oceanCost || 0);
        if (!existing || existing === 0) {
          await Order.findByIdAndUpdate(orderId, { $set: { "charges.oceanCost": String(row.total) } });
        }
      }
    }

    res.json({ created: created.length, ratedChecks });
  } catch (err) {
    console.error("apply-acl error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Container/freight invoice header + per-VIN extraction — regex implementation ──
// Kept intact (and still used by backend/scripts/try-llm-extraction.js for
// comparison) even though parse-container now calls the LLM version by default.
// Revert that one call below to switch back to this with no other changes needed.
function parseContainerInvoiceRegex(text) {
  // Invoice number — "Invoice no.: 30023" or "NUMBER\n015839" or EzCargo: dates+number concat
  const invMatch  = text.match(/Invoice\s+no\.?:?\s*(\d+)/i)
    || text.match(/NUMBER\s*\n\s*(\d+)/i)
    || text.match(/Invoice\s*\n(?:[A-Z][a-z]+\/\d{2}\/\d{4}){1,2}(\d{5,})/i)  // EzCargo: "Invoice\nJul/14/2026Jul/24/202655994"
    || text.match(/Invoice\s*\n[\w\/]+[\w\/]+(\d{5,})/i)
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

  return { invoiceNumber, billDate, vendor, container, booking, total, vinData };
}

// ── Same extraction via LLM (Groq/Llama) — see backend/utils/llmExtract.js ────
async function parseContainerInvoiceLLM(text) {
  const r = await extractContainerInvoiceFields(text);
  const vinData = {};
  for (const row of (r.rows || [])) {
    if (!row.vin) continue;
    const ymm = [row.year, row.make, row.model].filter(Boolean).join(" ").trim();
    vinData[row.vin.toUpperCase()] = { ymm, lineTotal: row.lineTotal || null, extra: Number(row.extraCharge) || 0 };
  }
  return {
    invoiceNumber: r.invoiceNumber || "",
    billDate:      r.billDate || "",
    vendor:        r.vendor || "",
    container:     r.container || "",
    booking:       r.booking || "",
    total:         Number(r.total) || 0,
    vinData,
  };
}

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

        let parsedInvoice;
        try {
          parsedInvoice = await parseContainerInvoiceLLM(text);
        } catch (e) {
          console.warn("[parse-container] LLM extraction failed, falling back to regex:", e.message);
          parsedInvoice = parseContainerInvoiceRegex(text);
        }
        const { invoiceNumber, billDate, vendor, container, booking, total, vinData } = parsedInvoice;

        const lines = text.split("\n");
        // Every full VIN printed on the invoice counts, even ones the parser missed
        // (the LLM sometimes drops a car from a 4-car container)
        const textVins = [...new Set((text.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || [])
          .filter(v => /[A-Z]/.test(v) && /\d/.test(v)))];
        for (const v of textVins) if (!vinData[v]) vinData[v] = {};
        // …and only real 17-character VINs (the LLM sometimes adds a last-6 like "014498" as its own car)
        if (textVins.length) for (const k of Object.keys(vinData)) if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(k)) delete vinData[k];
        const vins = Object.keys(vinData);

        // ── Per-VIN charges, read straight from the invoice lines ────────────────
        // A charge line that names one car — its full VIN or "VIN: F17426" — belongs
        // to that car (title service, storage, detention…); its line total is the
        // last amount on the line. A "Storage Fee" heading's detail can sit on the
        // next line. Everything else (freight, loading, fees) is shared. Identical
        // repeated lines (the same page printed twice) are counted once.
        const vinExtras = {};
        const vinParts  = {};  // vin → { storage, title } — the extras that get their own cost line on the order
        const seenLines = new Set();
        // The PDF text often glues the VIN to the numbers after it ("…HHF174261.00475.00"),
        // so a ref may run past the VIN — match it as a prefix too
        const vinOfRef = (ref) => vins.filter(v => { v = v.toUpperCase();
          return v.endsWith(ref) || ref.startsWith(v) || (ref.length >= 8 && v.includes(ref)); });
        for (let li = 0; li < lines.length; li++) {
          const lc = lines[li].trim().toLowerCase();
          const isHeading = ["storage fee", "storage", "detention", "extra charges"].includes(lc);
          const line = isHeading && li + 1 < lines.length ? lines[li + 1] : lines[li];
          const amounts = line.match(/\d[\d,]*\.\d{2}/g);
          if (!amounts) continue;
          // A car's own row in the vehicle table (iShip: "…VIN$0.00$1,175.00$1,175.00") is its
          // base price, not an extra charge — skip it
          if (/[A-HJ-NPR-Z0-9]{17}\s*\$/i.test(line)) continue;
          const refs = [
            ...(line.toUpperCase().match(/(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}/g) || []),
            ...[...line.matchAll(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{6,})/gi)].map(m => m[1].toUpperCase()),
          ];
          const hit = [...new Set(refs.flatMap(vinOfRef))];
          if (hit.length !== 1) continue;            // no car, or several cars on one line — shared
          const key = line.trim();
          if (seenLines.has(key)) continue;
          seenLines.add(key);
          if (isHeading) li++;                        // the detail line is consumed
          const amt = parseFloat(amounts[amounts.length - 1].replace(/,/g, ""));
          if (amt > 0) {
            vinExtras[hit[0]] = (vinExtras[hit[0]] || 0) + amt;
            // The section label is often the line above ("DOCUMENT" over "2017 Tucson VIN: …")
            const kind = isHeading ? lc : `${lines[li - 1] || ""} ${line}`.toLowerCase();
            const part = /storage/.test(kind) ? "storage" : /title|document/.test(kind) ? "title" : null;
            if (part) (vinParts[hit[0]] ||= {})[part] = ((vinParts[hit[0]] || {})[part] || 0) + amt;
          }
        }

        const storageTotal = Object.values(vinExtras).reduce((sum, n) => sum + n, 0);
        // The LLM's per-VIN prices are only trusted when they add up to the invoice total
        const llmSum = vins.reduce((s, v) => s + (vinData[v].lineTotal || 0), 0);
        const hasPerVinPricing = vins.every(v => vinData[v].lineTotal > 0) && Math.abs(llmSum + storageTotal - total) < 0.05;
        const baseTotal  = total - storageTotal;
        const equalSplit = vins.length > 0 ? Math.round((baseTotal / vins.length) * 100) / 100 : total;

        // Match orders
        const orders = await Order.find({ vin: { $in: vins } })
          .select("_id refNumber vin customerName year make model").lean();
        const orderByVin = {};
        for (const o of orders) orderByVin[o.vin?.toUpperCase()] = o;

        // Duplicate detection: find existing expenses for these orders matching this invoice or booking
        const orderIds = orders.map(o => o._id);
        const existingExpenses = orderIds.length
          ? await Expense.find({
              orderId: { $in: orderIds },
              $or: [
                { invoiceNumber },
                ...(booking ? [{ notes: { $regex: booking, $options: "i" } }] : []),
                ...(invoiceNumber ? [{ notes: { $regex: invoiceNumber, $options: "i" } }] : []),
                { category: "Loaders & Warehouses", vendor: { $regex: (vendor || "").split(" ")[0], $options: "i" } },
              ],
            }).select("orderId invoiceNumber notes vendor").lean()
          : [];
        console.log("[dup-check] invoiceNumber:", invoiceNumber, "booking:", booking, "vendor:", vendor, "orderIds:", orderIds.length, "found:", existingExpenses.length, existingExpenses.map(e => ({ inv: e.invoiceNumber, notes: e.notes?.slice(0,60), vendor: e.vendor })));
        const dupOrderIds = new Set(existingExpenses.map(e => String(e.orderId)));

        const rows = vins.map(vin => {
          const order = orderByVin[vin.toUpperCase()] || null;
          const d = vinData[vin] || {};
          const rowTotal = (hasPerVinPricing && d.lineTotal ? d.lineTotal : equalSplit)
            + (vinExtras[vin] || 0);
          const duplicate = dupOrderIds.has(String(order?._id));
          return {
            vin,
            ymm:          (order ? [order.year, order.make, order.model].filter(Boolean).join(" ") : "") || d.ymm,
            total:        rowTotal,
            storage:      vinParts[vin]?.storage || 0,   // → order's "Storage Fee – Warehouse" cost
            title:        vinParts[vin]?.title   || 0,   // → order's "Title Processing Fee" cost
            orderId:      order?._id || null,
            orderRef:     order?.refNumber || "",
            customerName: order?.customerName || "",
            matched:      !!order,
            duplicate,
            skip:         duplicate,
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

        // Duplicate check: same order + VIN + amount, or same order + amount within 30 days
        if (orderId && row.total) {
          if (row.vin) {
            const dupVin = await Expense.findOne({ orderId, vin: row.vin, amount: row.total }).lean();
            if (dupVin) continue;
          }
          const dup = await Expense.findOne({
            orderId,
            amount:   row.total,
            category: "Loaders & Warehouses",
            date:     { $gte: new Date(dateObj - 30*24*60*60*1000), $lte: new Date(+dateObj + 30*24*60*60*1000) },
          }).lean();
          if (dup) continue;
        }

        await Expense.create({
          category:      "Loaders & Warehouses",
          taxCategory:   "Cost of Goods Sold (COGS)",
          description:   `Container Loading — ${row.ymm || ""} — VIN: ${row.vin}`.trim().replace(/\s*—\s*$/, ""),
          vendor:        invoice.vendor || "Savannah Auto Export",
          amount:        row.total,
          date:          dateObj,
          orderId:       orderId || null,
          orderRef:      orderRef || "",
          vin:           row.vin || "",
          invoiceNumber: invoice.invoiceNumber || "",
          status:        "unpaid",
          notes:         [invoice.container ? `Container: ${invoice.container}` : "", invoice.booking ? `Booking: ${invoice.booking}` : "", row.notes || ""].filter(Boolean).join(" | "),
          billFileName:  invoice.billFileName || "",
          billMime:      invoice.billMime     || "",
        });

        // The bill is the real cost — it replaces the pricing-table estimate. Storage and
        // title service on the bill get their own cost lines; the rest is ocean freight.
        if (orderId && row.total) {
          const storage = Math.round((Number(row.storage) || 0) * 100) / 100;
          const title   = Math.round((Number(row.title)   || 0) * 100) / 100;
          const set = { "charges.oceanCost": String(Math.round((row.total - storage - title) * 100) / 100) };
          if (storage > 0) set["charges.storageWarehouseFeeCost"] = String(storage);
          if (title   > 0) set["charges.titleProcessingFeeCost"]  = String(title);
          await Order.findByIdAndUpdate(orderId, { $set: set });
        }
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

      const miscVendor = await canonicalVendor(row.vendor);

      // Duplicate check: same order + VIN + amount, or same order + vendor + amount within 30 days
      if (orderId && row.total) {
        if (row.vin) {
          const dupVin = await Expense.findOne({ orderId, vin: row.vin, amount: row.total }).lean();
          if (dupVin) continue;
        }
        const dup = await Expense.findOne({
          orderId,
          amount: row.total,
          vendor: miscVendor || "",
          date:   { $gte: new Date(dateObj - 30*24*60*60*1000), $lte: new Date(+dateObj + 30*24*60*60*1000) },
        }).lean();
        if (dup) continue;
      }

      const miscData = {
        category:      row.category || "Port / Terminal Fees",
        description:   `${row.description || row.vendor}${row.vin ? ` — VIN: ${row.vin}` : ""}`.trim(),
        vendor:        miscVendor || "",
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
      };
      enforceVendorCategory(miscData);
      await Expense.create(miscData);
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

    // Paid date for the whole batch = the day the payment was created/sent ("Created by … on MM/DD/YYYY").
    // The bank's "Payment Date" is the ACH settlement day (usually the next business day); it is kept
    // separately for the ACH PAYMENTS sheet, which derives its processing date from it.
    const payDateMatch = text.match(/Payment\s*Date\s*([\d]{1,2}\/[\d]{1,2}\/[\d]{4})/i);
    const createdMatch = text.match(/Created\s*by\s*\S*?\s*on\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const bankPaymentDate = payDateMatch?.[1] || "";
    const batchPaidDate = createdMatch?.[1] || bankPaymentDate;

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
      let orderRef = refMatch?.[1] || "";
      const note      = addenda; // always show the raw addenda for context

      // Multiple booking numbers (e.g. "S3-29358436 S3-29436152") or multiple
      // plain order refs (e.g. "13734 13754 13759") mean this single payment
      // covers more than one order — flag it so the UI can offer a split.
      const bookingNumbers = [...addenda.matchAll(/S3-\s*\d+/gi)].map(m => m[0].replace(/\s+/g, ""));
      // The carrier/steamship booking number the bank quotes alongside the ref,
      // e.g. "BK 272951625 REF 13855" or "BK# 24597256". One booking covers a
      // whole container (all its cars), so it's the key to pulling in siblings.
      // Written as "BK 123", "BK# 123", "BKG 123" or "BOOKING 12637982".
      const bkNumMatch = addenda.match(/\b(?:BK|BKG|BOOKING)\s*#?\.?:?\s*([A-Z]{0,4}\d{6,15})\b/i)
        // …or a bare 9-15 digit number with no label (E-Z Cargo: "2334908730") — too long
        // to be one of our order refs, so it's the container's booking
        || addenda.match(/(?:^|\s)(\d{9,15})(?=\s|$)/);
      const carrierBooking = bkNumMatch ? bkNumMatch[1] : "";
      // Exclude the digits already claimed by booking numbers so they don't
      // also get picked up as "plain order refs".
      let addendaSansBookings = addenda.replace(/S3-\s*\d+/gi, " ");
      if (carrierBooking) addendaSansBookings = addendaSansBookings.replace(bkNumMatch[0], " ");
      const plainRefs = [...new Set((addendaSansBookings.match(/\b\d{3,8}\b/g) || []))];
      const isMultiBooking = bookingNumbers.length > 1 || plainRefs.length > 1;
      // When multiple order refs are present, show all of them upfront
      if (plainRefs.length > 1) orderRef = plainRefs.join(" / ");
      // What to pre-fill the Split form with — real order refs are far more
      // useful than booking numbers when we have them.
      const splitSeed = plainRefs.length > 1 ? plainRefs : bookingNumbers;

      // A single carrier booking and no order ref (ACL: "S3-29771380") — the
      // booking belongs to one order, so match that order's bills.
      if (!orderRef && bookingNumbers.length === 1) {
        const o = await resolveProofOrder(bookingNumbers[0]);
        if (o) orderRef = o.refNumber;
      }

      // Find candidate unpaid expenses tied to this order ref
      let candidates = [];
      let matchedIds = [];
      let matchType = "none";
      let alreadyPaid = [];
      if (orderRef) {
        candidates = await Expense.find({
          orderRef: { $regex: `^${esc(orderRef)}$`, $options: "i" },
          status: { $in: ["unpaid", "partial"] },
        }).select("_id description vendor amount paidAmount status").lean();

        // If nothing unpaid/partial, check whether it was already fully paid
        if (!candidates.length) {
          alreadyPaid = await Expense.find({
            orderRef: { $regex: `^${esc(orderRef)}$`, $options: "i" },
            status: "paid",
          }).select("_id description vendor amount paidDate receiptFileName").lean();
        }

        if (candidates.length) {
          // For partial bills, the amount owed is the remaining balance
          const effectiveAmt = c => c.status === "partial" ? (c.amount - (c.paidAmount || 0)) : c.amount;
          // 1. Single expense exactly matching the payment amount (or its remaining balance)
          const exact = candidates.find(c => Math.abs(effectiveAmt(c) - amount) < 0.01);
          if (exact) {
            matchedIds = [exact._id];
            matchType = "exact";
          } else {
            // 2. Subset of candidates whose amounts sum to the payment amount
            const n = candidates.length;
            let found = null;
            for (let mask = 1; mask < (1 << n) && !found; mask++) {
              let sum = 0;
              const subset = [];
              for (let b = 0; b < n; b++) {
                if (mask & (1 << b)) { sum += effectiveAmt(candidates[b]); subset.push(candidates[b]); }
              }
              if (Math.abs(sum - amount) < 0.01) found = subset;
            }
            if (found) {
              matchedIds = found.map(c => c._id);
              matchType = "combined";
            } else {
              // 3. Single candidate and payment is less than its balance → partial payment
              if (candidates.length === 1 && amount < effectiveAmt(candidates[0]) - 0.005) {
                matchedIds = [candidates[0]._id];
                matchType = "partial";
              } else {
                matchType = "review"; // candidates exist but none sum to the amount
              }
            }
          }
        } else if (alreadyPaid.length) {
          const sumPaid = alreadyPaid.reduce((s, c) => s + c.amount, 0);
          matchType = Math.abs(sumPaid - amount) < 0.01 ? "already_paid" : "already_paid_mismatch";
        }
      }

      // Container payment: the bank references one order + one carrier booking,
      // but the money covers every car in that container. When the single-ref
      // lookup can't account for the whole amount, find the container load
      // (by carrier booking number, or by the order ref belonging to a load)
      // and pull in the unpaid bills of every sibling order.
      // A booking # alone (no order ref) is enough — "BOOKING 12637982" names the whole container.
      if ((matchType === "none" || matchType === "review") && (orderRef || carrierBooking) && plainRefs.length <= 1) {
        const ContainerLoad = require("../models/ContainerLoad");
        const loadOr = [];
        if (carrierBooking) loadOr.push({ bookingNumber: { $regex: esc(carrierBooking), $options: "i" } });
        // For loader/warehouse vendors (Savannah Auto, EZ Cargo, etc.) the addenda
        // often leads with a bare load/booking number (6+ digits, no prefix) before "REF xxxx".
        // Try it as a ContainerLoad booking number.
        if (LOADER_WAREHOUSE_VENDOR_RX.test(payeeName)) {
          const bareBooking = addenda.match(/^(\d{6,})\b/);
          if (bareBooking) loadOr.push({ bookingNumber: { $regex: esc(bareBooking[1]), $options: "i" } });
        }
        // The order ref itself may be a load member — resolve its Order _id.
        const selfOrder = orderRef ? await Order.findOne({ refNumber: { $regex: `^${esc(orderRef)}$`, $options: "i" } }).select("_id bookingNumber").lean() : null;
        if (selfOrder) {
          loadOr.push({ orderIds: selfOrder._id });
          if (selfOrder.bookingNumber) loadOr.push({ bookingNumber: { $regex: esc(selfOrder.bookingNumber), $options: "i" } });
        }
        const load = loadOr.length ? await ContainerLoad.findOne({ $or: loadOr }).select("orderIds name").lean() : null;
        // No container load on file — the orders carrying that booking # are the container
        let sibOrderIds = load?.orderIds?.length ? load.orderIds
          : carrierBooking ? (await Order.find({ bookingNumber: { $regex: `(^|[^0-9])${esc(carrierBooking)}$`, $options: "i" } }).select("_id").lean()).map(o => o._id)
          : [];
        // Neither a container load nor an order carries the booking — the container
        // bills themselves do ("Container: … | Booking: 2334908730" in their notes)
        if (!sibOrderIds.length && carrierBooking) {
          const billRefs = await Expense.distinct("orderRef", { notes: { $regex: `Booking:\\s*${esc(carrierBooking)}\\b`, $options: "i" } });
          if (billRefs.length) sibOrderIds = (await Order.find({ refNumber: { $in: billRefs } }).select("_id").lean()).map(o => o._id);
        }

        if (sibOrderIds.length) {
          const sibOrders = await Order.find({ _id: { $in: sibOrderIds } }).select("refNumber").lean();
          const sibRefs = sibOrders.map(o => o.refNumber).filter(Boolean);
          const sibExpenses = await Expense.find({
            orderRef: { $in: sibRefs.map(r => new RegExp(`^${esc(r)}$`, "i")) },
          }).select("_id description vendor amount paidAmount orderRef status paidDate receiptFileName").lean();

          const owed = c => c.status === "partial" ? c.amount - (c.paidAmount || 0) : c.amount;
          const sum  = (list) => list.reduce((s, c) => s + owed(c), 0);
          const allUnpaid = sibExpenses.filter(c => c.status === "unpaid" || c.status === "partial");
          // The payee's own bills first (iShip's loading bills, not the cars' towing bills)
          const payeeUnpaid = allUnpaid.filter(c => sameVendor(c.vendor, payeeName));
          const unpaidSib = payeeUnpaid.length ? payeeUnpaid : allUnpaid;
          const allPaid   = sibExpenses.filter(c => c.status === "paid");
          const payeePaid = allPaid.filter(c => sameVendor(c.vendor, payeeName));
          const paidSib   = payeePaid.length ? payeePaid : allPaid;
          const sumPaid   = paidSib.reduce((s, c) => s + c.amount, 0);

          if (unpaidSib.length) {
            candidates = unpaidSib;
            const exactSet = Math.abs(sum(unpaidSib) - amount) < 0.01 ? unpaidSib
              : Math.abs(sum(allUnpaid) - amount) < 0.01 ? allUnpaid : null;
            if (exactSet) {
              candidates = exactSet;
              matchedIds = exactSet.map(c => c._id);
              matchType  = exactSet.length === 1 ? "exact" : "combined";
            } else {
              matchType = "review";
            }
          } else if (paidSib.length && Math.abs(sumPaid - amount) < 0.01) {
            alreadyPaid = paidSib;
            matchType = "already_paid";
          }
        }
      }

      // Multiple plain order refs in one Addenda (e.g. "13734 13754 13759")
      // — try to find the bills across ALL of those orders before asking
      // the user to split manually.
      if ((matchType === "none" || matchType === "review") && plainRefs.length > 1) {
        const multi = await Expense.find({
          orderRef: { $in: plainRefs.map(r => new RegExp(`^${esc(r)}$`, "i")) },
        }).select("_id description vendor amount paidAmount orderRef status paidDate receiptFileName").lean();

        if (multi.length) {
          const allUnpaidMulti = multi.filter(c => c.status === "unpaid" || c.status === "partial");
          // The payee's own bills on those orders first (Hey's towing bills, not the ocean freight)
          const payeeMulti  = allUnpaidMulti.filter(c => sameVendor(c.vendor, payeeName));
          const owedMulti   = list => list.reduce((s, c) => s + (c.status === "partial" ? c.amount - (c.paidAmount||0) : c.amount), 0);
          const unpaidMulti = payeeMulti.length && Math.abs(owedMulti(payeeMulti) - amount) < 0.01 ? payeeMulti : allUnpaidMulti;
          const paidMulti   = multi.filter(c => c.status === "paid");
          const sumUnpaid   = owedMulti(unpaidMulti);
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

      // Fallback: vendor name + amount when no order ref in addenda.
      // Normalizes both sides: strips apostrophes/punctuation and suffixes
      // like LLC, INC, CORP so "JOLA LOGISTICS" matches "J'OLA LOGISTICS LLC".
      if (matchType === "none" && !orderRef) {
        const byVendorAmt = await Expense.find({
          amount: parseFloat(amount.toFixed(2)),
          status: { $in: ["unpaid", "partial"] },
        }).select("_id description vendor amount paidAmount status orderRef").lean();

        const vendorMatches = byVendorAmt.filter(c => sameVendor(c.vendor, payeeName));
        if (vendorMatches.length) {
          const exact = vendorMatches.find(c => Math.abs(c.amount - amount) < 0.01 && c.status !== "partial");
          if (exact) {
            candidates = vendorMatches;
            matchedIds = [exact._id];
            matchType  = "exact";
            // Back-fill orderRef from the matched bill so the UI shows it
            if (!orderRef && exact.orderRef) orderRef = exact.orderRef;
          } else {
            candidates = vendorMatches;
            matchType  = "review";
            if (!orderRef && vendorMatches[0].orderRef) orderRef = vendorMatches[0].orderRef;
          }
        }
      }

      // Fallback for multi-booking payments with no plain order ref (e.g. the
      // ACL "S3-xxxxx" case) — these get split into bills whose description
      // contains the booking number, so match on vendor + booking number
      // instead of order ref.
      if (matchType === "none" && bookingNumbers.length) {
        // Descriptions carry the booking with or without the dash ("BL S329771380")
        const bookingOr = bookingNumbers.map(bn => ({ description: { $regex: esc(bn).replace("-", "-?"), $options: "i" } }));
        const byBooking = (await Expense.find({ $or: bookingOr })
          .select("_id description vendor amount paidAmount status paidDate receiptFileName orderRef").lean())
          .filter(c => sameVendor(c.vendor, payeeName));

        if (byBooking.length) {
          const paidOnes   = byBooking.filter(c => c.status === "paid");
          const unpaidOnes = byBooking.filter(c => c.status === "unpaid" || c.status === "partial");
          const sumPaid    = paidOnes.reduce((s, c) => s + c.amount, 0);
          const sumUnpaid  = unpaidOnes.reduce((s, c) => s + (c.status === "partial" ? c.amount - (c.paidAmount||0) : c.amount), 0);

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
        bankPaymentDate,
        candidates,
        alreadyPaid,
        matchedIds,
        matchType,
        bookingNumbers,
        isMultiBooking,
        splitSeed,
        selected: matchType === "exact" || matchType === "combined" || matchType === "partial",
      });
    }

    res.json({ rows, batchPaidDate, totalPayments: rows.length, proofFile });
  } catch (err) {
    console.error("parse-payment-proof error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Trucker payment receipts ──────────────────────────────────────────────────
// GET /api/expenses/vendor-emails?names=A|B — email on file for each vendor name
router.get("/vendor-emails", async (req, res) => {
  try {
    const { vendorEmails } = require("../utils/vendorMatch");
    const names = (req.query.names || "").split("|").map(n => n.trim()).filter(Boolean);
    res.json(await vendorEmails(names));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/expenses/send-payment-receipts — multipart: optional "proof" file +
// "payload" JSON { paidDate, method, attachProof, vendors: [{ vendor, email,
// lines: [{ orderRef, vehicle, vin, amount }] }] }. One email per trucker
// listing what was paid; the address is remembered on their vendor record.
// One "Payment sent" email per vendor listing what was paid. Shared by Truckers to
// Pay and the bank payment-proof import.
//   dateStr: "11/5/2026"   vendors: [{ vendor, email, lines: [{ orderRef, vehicle, vin, amount }] }]
//   proof:   { buffer, name, mime } — attached to every email sent (caller decides when that's safe)
async function sendVendorReceipts({ dateStr, method, vendors = [], proof: sharedProof = null, proofFor = null }) {
  const { saveVendorEmail, emailList } = require("../utils/vendorMatch");
  const { getGmailAccessToken } = require("../utils/gmail");
  const { b64lines } = require("../utils/mime");
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const from = `Dor Ldor Global <${process.env.GMAIL_USER}>`;
  const token = await getGmailAccessToken();
  const results = [];

  for (const v of vendors) {
    const to = emailList(v.email);
    if (!to.length) { results.push({ vendor: v.vendor, sent: false, error: "no email" }); continue; }
    const total = (v.lines || []).reduce((s, l) => s + Number(l.amount || 0), 0);
    // This vendor's own (redacted) copy of the proof when a per-vendor builder is given
    const proof = proofFor ? await proofFor(v).catch(() => null) : sharedProof;
    const subject = `Payment sent — ${money(total)} — ${dateStr}`;
    const body = [
      `Hello ${v.vendor},`, ``,
      `We sent you a payment of ${money(total)}${method ? ` by ${method}` : ""} on ${dateStr} for:`, ``,
      ...(v.lines || []).map(l => `  • #${l.orderRef || "—"}${l.vehicle ? ` ${l.vehicle}` : ""}${l.vin ? ` (VIN …${String(l.vin).slice(-6)})` : ""} — ${money(l.amount)}`),
      ``, `Total: ${money(total)}`, ``,
      proof ? `Proof of payment is attached.` : ``,
      `Thank you,`, `Eli Levy`, `Dor Ldor Global`, `9172003998`, `DorLdorGlobal@gmail.com`,
    ].join("\r\n");

    const boundary = "DDG_RECEIPT_" + Date.now();
    const mime = proof ? [
      `From: ${from}`, `To: ${to.join(", ")}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `MIME-Version: 1.0`, `Content-Type: multipart/mixed; boundary="${boundary}"`, ``,
      `--${boundary}`, `Content-Type: text/plain; charset="UTF-8"`, ``, body,
      `--${boundary}`,
      `Content-Type: ${proof.mime || "application/pdf"}; name="${proof.name}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${proof.name}"`, ``,
      b64lines(proof.buffer.toString("base64")), `--${boundary}--`,
    ] : [
      `From: ${from}`, `To: ${to.join(", ")}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `MIME-Version: 1.0`, `Content-Type: text/plain; charset="UTF-8"`, ``, body,
    ];
    try {
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: Buffer.from(mime.join("\r\n")).toString("base64url") }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || `Gmail ${r.status}`);
      await saveVendorEmail(v.vendor, to.join(", "), v.category || "Towing / Transport").catch(() => {});
      results.push({ vendor: v.vendor, email: to.join(", "), sent: true, proofAttached: !!proof });
    } catch (e) {
      results.push({ vendor: v.vendor, email: to.join(", "), sent: false, error: e.message });
    }
  }
  return results;
}

router.post("/send-payment-receipts", memUpload.single("proof"), async (req, res) => {
  try {
    const { paidDate, method, attachProof, vendors = [] } = JSON.parse(req.body.payload || "{}");
    const d = paidDate && /^\d{4}-\d{2}-\d{2}$/.test(paidDate) ? paidDate.split("-") : null;
    const dateStr = d ? `${+d[1]}/${+d[2]}/${d[0]}` : new Date().toLocaleDateString("en-US");
    // Each trucker gets their own copy of the bank proof, redacted to just their payment.
    // A file that isn't a multi-payee bank proof (no block for that trucker) only goes
    // along when it's a single trucker being paid — never someone else's payments.
    const file = req.file ? { buffer: req.file.buffer, name: req.file.originalname, mime: req.file.mimetype } : null;
    const proofFor = file ? async (v) => {
      if (/pdf/i.test(file.mime || "") || /\.pdf$/i.test(file.name)) {
        try {
          const { redactProof } = require("../utils/releaseEmails");
          const { buffer } = await redactProof(file.buffer, [v.vendor]);
          return { buffer, name: file.name, mime: "application/pdf" };
        } catch { /* not a bank proof, or no payment to this trucker in it */ }
      }
      return vendors.length === 1 ? file : null;
    } : null;
    res.json({ results: await sendVendorReceipts({ dateStr, method, vendors, proofFor }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Group a payment-proof import's paid bills by vendor and email each one a receipt.
// The bank proof lists every payee in the batch, so it's attached only when the
// whole batch went to one vendor.
async function emailProofVendors({ paidLog, rows, proofFile, method }) {
  const { vendorEmail } = require("../utils/vendorMatch");
  const { releaseVendorFor, redactProof } = require("../utils/releaseEmails");
  const groups = new Map();
  for (const p of paidLog) {
    // Carriers / container loaders get a "PAYMENT FOR RELEASES" email instead
    if (releaseVendorFor(p.vendor) || releaseVendorFor(p.payee)) continue;
    const k = normVendorName(p.vendor);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, { vendor: p.vendor, category: p.category, lines: [], payees: new Set() });
    groups.get(k).lines.push(p);
    if (p.payee) groups.get(k).payees.add(p.payee);
  }
  if (!groups.size) return [];

  // Vehicle for each line, from its order
  const refs = [...new Set(paidLog.map(p => p.orderRef).filter(Boolean))];
  const orders = refs.length ? await Order.find({ refNumber: { $in: refs } }).select("refNumber year make model vin").lean() : [];
  const byRef = Object.fromEntries(orders.map(o => [o.refNumber, o]));

  const vendors = [];
  for (const g of groups.values()) {
    const email = await vendorEmail(g.vendor);
    vendors.push({
      vendor: g.vendor, category: g.category, email, payees: [...g.payees],
      lines: g.lines.map(l => {
        const o = byRef[l.orderRef];
        return { orderRef: l.orderRef, vehicle: o ? [o.year, o.make, o.model].filter(Boolean).join(" ") : "",
                 vin: l.vin || o?.vin || "", amount: l.amount };
      }),
    });
  }

  const pd = rows.find(r => r.selected && r.batchPaidDate)?.batchPaidDate;
  const d = pd ? new Date(pd) : new Date();
  const dateStr = (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();

  // The bank proof lists every payee — each vendor gets a copy redacted to just their
  // own payment (never the whole proof; no copy if it can't be redacted)
  let full = null;
  const withEmail = vendors.filter(v => (v.email || "").includes("@"));
  if (withEmail.length && proofFile?.driveId) {
    try {
      const { downloadDriveFile } = require("../googleDrive");
      const tmp = path.join(require("os").tmpdir(), "proof-vendor-" + Date.now() + ".pdf");
      await downloadDriveFile(proofFile.driveId, tmp);
      full = fs.readFileSync(tmp);
      try { fs.unlinkSync(tmp); } catch {}
    } catch (e) { console.warn("[emailProofVendors] proof download failed:", e.message); }
  }
  const proofFor = full ? async (v) => {
    const { buffer } = await redactProof(full, v.payees?.length ? v.payees : [v.vendor]);
    return { buffer, name: proofFile.fname || "payment-proof.pdf", mime: "application/pdf" };
  } : null;

  const sent = withEmail.length ? await sendVendorReceipts({ dateStr, method, vendors: withEmail, proofFor }) : [];
  return [...sent, ...vendors.filter(v => !(v.email || "").includes("@")).map(v => ({ vendor: v.vendor, sent: false, error: "no email" }))];
}

// ── Release requests (carriers / container loaders) ───────────────────────────
// Download the bank proof from Drive into memory
async function proofBuffer(driveId) {
  const { downloadDriveFile } = require("../googleDrive");
  const tmp = path.join(require("os").tmpdir(), "proof-rel-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".pdf");
  await downloadDriveFile(driveId, tmp);
  const buf = fs.readFileSync(tmp);
  try { fs.unlinkSync(tmp); } catch {}
  return buf;
}

// GET /api/expenses/release-proof?driveId=…&payees=A|B — the redacted proof one company would get
router.get("/release-proof", async (req, res) => {
  try {
    const { redactProof } = require("../utils/releaseEmails");
    const payees = String(req.query.payees || "").split("|").map(s => s.trim()).filter(Boolean);
    if (!req.query.driveId || !payees.length) return res.status(400).json({ error: "driveId and payees required" });
    const { buffer } = await redactProof(await proofBuffer(req.query.driveId), payees);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="proof-${payees[0].replace(/[^A-Za-z0-9]+/g, "-")}.pdf"`);
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/expenses/send-release-emails — { proofFile: { driveId, fname }, drafts: [{ key, company, to, subject, html, text, payees }] }
// Each company's email goes with its own redacted copy of the proof; nothing goes if it can't be redacted.
router.post("/send-release-emails", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const { redactProof, sendReleaseEmail } = require("../utils/releaseEmails");
    const { proofFile, drafts = [] } = req.body || {};
    if (!proofFile?.driveId) return res.status(400).json({ error: "No payment proof on file to attach" });
    const full = await proofBuffer(proofFile.driveId);
    const results = [];
    for (const d of drafts) {
      try {
        if (!d.to?.length) throw new Error("no release emails set on this vendor");
        const { buffer } = await redactProof(full, d.payees || []);
        await sendReleaseEmail(d, { buffer, name: proofFile.fname || "payment-proof.pdf" });
        results.push({ key: d.key, company: d.company, sent: true });
      } catch (e) {
        results.push({ key: d.key, company: d.company, sent: false, error: e.message });
      }
    }
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/expenses/apply-payment-proof — mark the matched bills paid ──────
router.post("/apply-payment-proof", express.json(), async (req, res) => {
  try {
    const { rows, paymentMethod, proofFile, emailVendors } = req.body;
    if (!rows?.length) return res.status(400).json({ error: "No rows provided" });

    // What this import actually paid, per bill — for the vendors' payment receipts
    const paidLog = [];
    let curPayee = "";   // the bank's payee name for the row being applied (used to redact the proof)
    const logPaid = (bill, amount) => {
      if (!bill || !(Number(amount) > 0)) return;
      paidLog.push({ vendor: bill.vendor || "", category: bill.category || "", orderRef: bill.orderRef || "",
        vin: bill.vin || "", amount: Number(amount), payee: curPayee });
    };
    const logPaidId = async (id, amount) => {
      const b = await Expense.findById(id).select("vendor category orderRef vin").lean().catch(() => null);
      logPaid(b, amount);
    };

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
      curPayee = row.payeeName || "";
      const dateObj = row.batchPaidDate ? new Date(row.batchPaidDate) : new Date();

      if (row.matchedIds?.length) {
        // Always record a traceable payment per bill and compute paid/partial
        // from the real numbers — never blindly set "paid". Three cases:
        //   1. Single matched bill -> the whole bank amount applies to it.
        //   2. markPartial + multiple bills -> this payment is only a partial
        //      installment split evenly across them.
        //   3. Multiple bills, not markPartial (the "combined" / candidate-
        //      picker case: several DIFFERENT bills whose amounts sum to the
        //      bank total) -> each bill is paid its OWN remaining amount, not
        //      the full bank total — applying the full amount to every bill
        //      here would wildly overstate paidAmount on each one.
        // Either way the resulting status must reflect what was actually
        // paid, since a bill's total can change later (e.g. a line item
        // added after the match) and only an honest paidAmount lets that be
        // caught on the next edit.
        const expenses = await Expense.find({ _id: { $in: row.matchedIds } });
        const bankAmt = Number(row.amount) || 0;
        for (const exp of expenses) {
          clearStalePayments(exp);
          const prev = exp.paidAmount || 0;
          const perAmt = expenses.length > 1
            ? (row.markPartial ? bankAmt / expenses.length : Math.max(exp.amount - prev, 0))
            : bankAmt;
          const newTotal = prev + perAmt;
          const fullyPaid = newTotal >= exp.amount - 0.005;
          exp.payments.push({ amount: perAmt, date: dateObj, method: paymentMethod || "Bank ACH", notes: "" });
          exp.paidAmount    = newTotal;
          exp.paidDate      = dateObj;
          exp.paymentMethod = paymentMethod || "Bank ACH";
          exp.status        = fullyPaid ? "paid" : "partial";
          if (receiptFields.receiptDriveId) Object.assign(exp, receiptFields);
          await exp.save();
          logPaid(exp, perAmt);
          updated++;
        }
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
          if (split.createBill === false && !split.existingExpenseId) continue;

          // 0. User manually picked an existing expense to mark paid
          if (split.existingExpenseId) {
            await Expense.updateOne(
              { _id: split.existingExpenseId },
              { $set: { status: "paid", paidDate: dateObj, paymentMethod: paymentMethod || "Bank ACH", ...receiptFields } }
            );
            await logPaidId(split.existingExpenseId, split.amount);
            updated++;
            continue;
          }

          const refKey = (split.orderRef || "").trim().toLowerCase();

          // 1. Prefer marking a known candidate for this order ref as paid
          if (refKey && candidateMap[refKey]) {
            await Expense.updateOne(
              { _id: candidateMap[refKey] },
              { $set: { status: "paid", paidDate: dateObj, paymentMethod: paymentMethod || "Bank ACH", ...receiptFields } }
            );
            await logPaidId(candidateMap[refKey], split.amount);
            updated++;
            continue;
          }

          // 2. The bill already on file for this order + amount (split lines are
          //    often keyed by booking number, and vendor spellings differ) — pay
          //    it if it's open, leave it alone if it's already paid.
          const { order: splitOrder, bill: existing } = await findExistingProofBill(split.orderRef, split.amount, row.payeeName);
          if (existing) {
            if (existing.status !== "paid") {
              await payFromProof(existing, { date: dateObj, method: paymentMethod || "Bank ACH", receiptFields });
              logPaid(existing, split.amount);
            }
            updated++;
          } else {
            // 3. No existing bill — create a new paid one
            const splitData = {
              category:      split.category || "Port / Terminal Fees",
              description:   split.description || row.payeeName,
              vendor:        await canonicalVendor(row.payeeName),
              amount:        Number(split.amount) || 0,
              date:          dateObj,
              orderId:       splitOrder?._id || null,
              orderRef:      splitOrder?.refNumber || split.orderRef || "",
              status:        "paid",
              paidDate:      dateObj,
              paymentMethod: paymentMethod || "Bank ACH",
              ...receiptFields,
            };
            enforceVendorCategory(splitData);
            await Expense.create(splitData);
            logPaid(splitData, splitData.amount);
            created++;
          }
        }
        continue;
      }

      // No bill on file at all — create one now from the payment proof details
      // User manually picked an existing expense to mark paid (single row)
      if (row.existingExpenseId) {
        await Expense.updateOne(
          { _id: row.existingExpenseId },
          { $set: { status: "paid", paidDate: dateObj, paymentMethod: paymentMethod || "Bank ACH", ...receiptFields } }
        );
        await logPaidId(row.existingExpenseId, row.amount);
        updated++;
        continue;
      }

      if (row.createBill) {
        // Duplicate guard: the bill may already be on file under another
        // vendor spelling or keyed by booking # — pay that one instead
        const ref = row.orderRef || (row.bookingNumbers?.length === 1 ? row.bookingNumbers[0] : "");
        const { order: billOrder, bill: existing } = await findExistingProofBill(ref, row.amount, row.payeeName);
        if (existing) {
          if (existing.status !== "paid") {
            await payFromProof(existing, { amount: row.amount, date: dateObj, method: paymentMethod || "Bank ACH", receiptFields });
            logPaid(existing, row.amount);
          }
          updated++;
          continue;
        }
        const newBillData = {
          category:      row.newCategory || "Port / Terminal Fees",
          description:   row.newDescription || row.payeeName,
          vendor:        await canonicalVendor(row.payeeName),
          amount:        row.amount,
          date:          dateObj,
          orderId:       billOrder?._id || null,
          orderRef:      billOrder?.refNumber || row.orderRef || "",
          status:        "paid",
          paidDate:      dateObj,
          paymentMethod: paymentMethod || "Bank ACH",
          ...receiptFields,
        };
        enforceVendorCategory(newBillData);
        await Expense.create(newBillData);
        logPaid(newBillData, newBillData.amount);
        created++;
      }
    }

    // Email each paid vendor a receipt (only vendors with an email on file)
    let vendorEmails = [];
    if (emailVendors && paidLog.length) {
      try {
        vendorEmails = await emailProofVendors({ paidLog, rows, proofFile, method: paymentMethod || "Bank ACH" });
      } catch (e) {
        console.warn("[apply-payment-proof] vendor receipts failed:", e.message);
        vendorEmails = [{ vendor: "—", sent: false, error: e.message }];
      }
    }

    // "PAYMENT FOR RELEASES" drafts for the carriers / container loaders paid here —
    // returned for review; sent from the screen with /send-release-emails
    let releaseDrafts = [];
    try {
      const { buildReleaseDrafts, releaseVendorFor } = require("../utils/releaseEmails");
      const relLog = paidLog.filter(p => releaseVendorFor(p.vendor) || releaseVendorFor(p.payee));
      if (relLog.length) {
        const pd = rows.find(r => r.selected && r.batchPaidDate)?.batchPaidDate;
        const d = pd ? new Date(pd) : new Date();
        releaseDrafts = await buildReleaseDrafts(relLog, `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`);
      }
    } catch (e) { console.warn("[apply-payment-proof] release drafts failed:", e.message); }

    res.json({ updated, created, attached, vendorEmails, releaseDrafts });

    // Append all approved rows to ACH PAYMENTS Google Sheet
    try {
      const achEntries = [];
      for (const row of rows) {
        if (!row.selected) continue;
        // Sheet keeps the bank's settlement date (processing date = that − 1 day)
        const sheetDate = row.bankPaymentDate || row.batchPaidDate;
        const dateObj = sheetDate ? new Date(sheetDate) : new Date();
        if (row.splitBills?.length) {
          for (const split of row.splitBills) {
            if (!split.amount) continue;
            achEntries.push({
              paymentDate: dateObj,
              payee:       row.payeeName || "",
              reference:   split.orderRef || row.orderRef || "",
              amount:      Number(split.amount) || 0,
            });
          }
        } else {
          achEntries.push({
            paymentDate: dateObj,
            payee:       row.payeeName || "",
            reference:   row.orderRef || "",
            amount:      Number(row.amount) || 0,
          });
        }
      }
      if (achEntries.length) appendAchRows(achEntries);
    } catch (sheetErr) {
      console.warn("[apply-payment-proof] achSheet append failed:", sheetErr.message);
    }

    // Email payment proof to owner
    try {
      if (proofFile?.driveId) {
        const { downloadDriveFile } = require("../googleDrive");
        const { getGmailAccessToken } = require("../utils/gmail");
        const { google } = require("googleapis");
        const os = require("os");
        const tmpPath = path.join(os.tmpdir(), `payment-proof-${Date.now()}.pdf`);
        await downloadDriveFile(proofFile.driveId, tmpPath);
        const buf = fs.readFileSync(tmpPath);
        try { fs.unlinkSync(tmpPath); } catch {}
        const b64 = buf.toString("base64");
        const wrappedB64 = b64.match(/.{1,76}/g).join("\r\n");
        // Use the batch payment date if available, else today
        const payDate = rows.find(r => r.selected && r.batchPaidDate)?.batchPaidDate;
        const d = payDate ? new Date(payDate) : new Date();
        const dateStr = `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
        const subject = `${dateStr} PAYMENTS`;
        const fname = proofFile.fname || "payment-proof.pdf";
        const to = process.env.GMAIL_USER || "dorldorglobal@gmail.com";
        const boundary = "DDG_PAYMENT_" + Date.now();
        const mimeLines = [
          `From: Dor Ldor Global <${to}>`, `To: ${to}`,
          `Subject: ${subject}`,
          `MIME-Version: 1.0`, `Content-Type: multipart/mixed; boundary="${boundary}"`,
          ``, `--${boundary}`, `Content-Type: text/plain; charset="UTF-8"`, ``,
          `Payment proof attached — ${subject}.`,
          ``,
          proofSummary(rows),
          `--${boundary}`,
          `Content-Type: application/pdf; name="${fname}"`,
          `Content-Transfer-Encoding: base64`,
          `Content-Disposition: attachment; filename="${fname}"`,
          ``, wrappedB64, ``, `--${boundary}--`,
        ];
        const raw = Buffer.from(mimeLines.join("\r\n")).toString("base64url");
        const accessToken = await getGmailAccessToken();
        const gmail = google.gmail("v1");
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });
        await gmail.users.messages.send({ userId: "me", requestBody: { raw }, auth });
      }
    } catch (emailErr) {
      console.warn("[apply-payment-proof] email failed:", emailErr.message);
    }
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


