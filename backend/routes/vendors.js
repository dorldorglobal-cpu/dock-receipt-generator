const express = require("express");
const router  = express.Router();
const Vendor  = require("../models/Vendor");
const Expense = require("../models/Expense");

const esc = (s) => (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── Wave paste parser ─────────────────────────────────────────────────────────
function parseWavePaste(text) {
  // Wave copies as a tab-separated table — normalise "Vendor\tName" → "Vendor\nName"
  const normalised = text.replace(/^vendor\t/gim, "Vendor\n");

  const lines = normalised.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const vendors = [];
  const SKIP = /^(vendor|type|name|email|direct deposit|actions|import from|add a vendor|not available|create bill|vendors|loading|\d+)$/i;

  let i = 0;
  while (i < lines.length) {
    if (/^vendor$/i.test(lines[i])) {
      const nameLine    = lines[i + 1] || "";
      const contactLine = lines[i + 2] || "";

      if (nameLine && !SKIP.test(nameLine)) {
        const isContact = contactLine &&
          !SKIP.test(contactLine) &&
          !/^vendor$/i.test(contactLine) &&
          !/\d{4,}/.test(contactLine) &&
          !/@/.test(contactLine) &&   // skip raw email addresses
          contactLine.length < 60;

        vendors.push({
          name:        nameLine,
          contactName: isContact ? contactLine : "",
          category:    "Towing / Transport",
        });
        i += isContact ? 3 : 2;
        continue;
      }
    }
    i++;
  }
  return vendors;
}

// ── Document parser (invoice / dispatch / bill paste) ────────────────────────
function parseDocument(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const full  = text;

  // ── Vendor name ────────────────────────────────────────────────────────────
  let vendor = "";

  // Central Dispatch carrier block
  const cdCarrier = lines.findIndex(l => /^carrier info$/i.test(l));
  if (cdCarrier !== -1 && lines[cdCarrier + 1]) {
    vendor = lines[cdCarrier + 1];
  }

  // "From:" or "Bill From:" or "Vendor:" patterns
  if (!vendor) {
    const fromLine = lines.find(l => /^(from|bill from|vendor|billed by|company)\s*:/i.test(l));
    if (fromLine) vendor = fromLine.replace(/^[^:]+:\s*/i, "").trim();
  }

  // Invoice header — first all-caps line that looks like a company
  if (!vendor) {
    const caps = lines.find(l => /^[A-Z][A-Z\s,\.]{5,}$/.test(l) && !/^(INVOICE|BILL|RECEIPT|STATEMENT|DATE|TOTAL|AMOUNT|DUE|FROM|TO|NOTE)/i.test(l));
    if (caps) vendor = caps;
  }

  // ── Contact name ───────────────────────────────────────────────────────────
  let contactName = "";
  if (cdCarrier !== -1) {
    const cLine = lines[cdCarrier + 2] || "";
    if (cLine && !/^[\d\(\-\+]/.test(cLine) && cLine.length < 50) contactName = cLine;
  }

  // ── Phone ──────────────────────────────────────────────────────────────────
  const phoneMatch = full.match(/\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0] : "";

  // ── Amount ─────────────────────────────────────────────────────────────────
  // Look for Load Info / Total / Amount Due / Invoice Total
  let amount = "";

  const loadInfo = lines.findIndex(l => /^load info$/i.test(l));
  if (loadInfo !== -1) {
    const next = lines[loadInfo + 1] || "";
    const m = next.match(/^\$?(\d+(?:\.\d{2})?)$/);
    if (m) amount = m[1];
  }

  if (!amount) {
    const totalLine = lines.find(l => /^(total|amount due|invoice total|balance due|subtotal)\s*:?\s*\$?([\d,]+(?:\.\d{2})?)/i.test(l));
    if (totalLine) {
      const m = totalLine.match(/\$?([\d,]+(?:\.\d{2})?)\s*$/);
      if (m) amount = m[1].replace(/,/g, "");
    }
  }

  if (!amount) {
    const dollarAmounts = full.match(/\$\s*([\d,]+(?:\.\d{2})?)/g) || [];
    if (dollarAmounts.length === 1) {
      amount = dollarAmounts[0].replace(/[$,\s]/g, "");
    } else if (dollarAmounts.length > 1) {
      // Take the largest amount (likely the total)
      const nums = dollarAmounts.map(s => parseFloat(s.replace(/[$,\s]/g, "")));
      amount = String(Math.max(...nums));
    }
  }

  // ── Date ───────────────────────────────────────────────────────────────────
  let date = "";
  const dateMatch = full.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
  if (dateMatch) {
    try { date = new Date(dateMatch[1]).toISOString().slice(0, 10); } catch {}
  }
  if (!date) {
    const isoMatch = full.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) date = isoMatch[1];
  }
  if (!date) date = new Date().toISOString().slice(0, 10);

  // ── Invoice number ─────────────────────────────────────────────────────────
  let invoiceNumber = "";
  const invLine = lines.find(l => /invoice\s*(?:no\.?|num(?:ber)?|#)?\s*:?\s*[\w\-]+/i.test(l));
  if (invLine) {
    const im = invLine.match(/invoice\s*(?:no\.?|num(?:ber)?|#)?\s*:?\s*([\w\-]+)/i);
    if (im) invoiceNumber = im[1];
  }
  // Also check standalone patterns like "#12345" or "INV-0042"
  if (!invoiceNumber) {
    const standalone = full.match(/\b(INV[-#]?\d+|\d{4,})\b/);
    if (standalone) invoiceNumber = standalone[1];
  }

  // ── Description ────────────────────────────────────────────────────────────
  let description = "";
  // Central Dispatch — vehicle info
  const vehicleLine = lines.find(l => /\b(VIN|vin)\b/.test(l) || /\b(20\d{2}|19\d{2})\s+[A-Z]/.test(l));
  if (vehicleLine) description = vehicleLine.trim();

  // Fall back to invoice line for description if nothing else found
  if (!description && invLine) description = invLine.trim();

  // ── Category guess ─────────────────────────────────────────────────────────
  let category = "General Overhead";
  if (/dispatch|carrier|pickup|delivery|tow|transport/i.test(full)) category = "Towing / Transport";
  else if (/ocean|vessel|sailing|booking|container|freight/i.test(full)) category = "Ocean Freight";
  else if (/port|terminal|storage|handling|dockage/i.test(full)) category = "Port / Terminal Fees";
  else if (/warehouse|loader|loading|lashing/i.test(full)) category = "Loaders & Warehouses";
  else if (/software|subscription|saas|license/i.test(full)) category = "Software";
  else if (/attorney|legal|law|counsel|notary/i.test(full)) category = "Legal Fees";
  else if (/fedex|usps|ups|dhl|postage|stamp|office supply|supplies|stationery|internet|phone|mobile|utility|bank fee|wire fee/i.test(full)) category = "Office & Admin";

  // ── Order ref ──────────────────────────────────────────────────────────────
  let orderRef = "";
  const refMatch = full.match(/ref(?:erence)?\s*#?\s*:?\s*([A-Z0-9\-]+)/i);
  if (refMatch) orderRef = refMatch[1];

  return { vendor, contactName, phone, amount, date, description, category, orderRef, invoiceNumber };
}

// ── GET /api/vendors ──────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { search, category } = req.query;
    const q = {};
    if (category) q.category = category;
    if (search) {
      const v = esc(search);
      q.$or = [
        { name:        { $regex: v, $options: "i" } },
        { contactName: { $regex: v, $options: "i" } },
        { email:       { $regex: v, $options: "i" } },
        { phone:       { $regex: v, $options: "i" } },
        { category:    { $regex: v, $options: "i" } },
      ];
    }

    const vendors = await Vendor.find(q).sort({ name: 1 }).lean();

    // Also pull every distinct vendor name from expense history and merge in
    // any that don't already have a Vendor record
    const expVendorNames = await Expense.distinct("vendor", { vendor: { $nin: ["", null] } });
    const knownNames = new Set(vendors.map(v => v.name.toLowerCase().trim()));
    for (const name of expVendorNames) {
      const key = (name || "").toLowerCase().trim();
      if (key && !knownNames.has(key)) {
        vendors.push({ _id: null, name, category: "", fromExpenses: true });
        knownNames.add(key);
      }
    }
    vendors.sort((a, b) => a.name.localeCompare(b.name));

    // Attach expense summary per vendor
    const allExpenses = await Expense.find({ vendor: { $nin: ["", null] } })
      .select("vendor amount status").lean();

    const expMap = {};
    for (const e of allExpenses) {
      const key = (e.vendor || "").toLowerCase().trim();
      if (!expMap[key]) expMap[key] = { total: 0, unpaid: 0, count: 0 };
      expMap[key].total  += e.amount || 0;
      expMap[key].count++;
      if (e.status === "unpaid") expMap[key].unpaid += e.amount || 0;
    }

    const result = vendors.map(v => {
      const key = v.name.toLowerCase().trim();
      const stats = expMap[key] || { total: 0, unpaid: 0, count: 0 };
      return { ...v, totalPaid: stats.total, unpaidAmount: stats.unpaid, expenseCount: stats.count };
    });

    res.json(result);
  } catch (err) {
    console.error("Vendors fetch error:", err);
    res.status(500).json({ error: "Failed to fetch vendors" });
  }
});

// ── GET /api/vendors/:id/expenses ─────────────────────────────────────────────
router.get("/:id/expenses", async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id).lean();
    if (!vendor) return res.status(404).json({ error: "Not found" });
    const expenses = await Expense.find({
      vendor: { $regex: `^${esc(vendor.name)}$`, $options: "i" }
    }).sort({ date: -1 }).lean();
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch vendor expenses" });
  }
});

// ── POST /api/vendors ─────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Vendor name is required." });
    const vendor = await Vendor.create(req.body);
    res.status(201).json(vendor);
  } catch (err) {
    console.error("Vendor create error:", err);
    res.status(500).json({ error: "Failed to create vendor" });
  }
});

// ── POST /api/vendors/import-wave — bulk import from Wave paste ───────────────
router.post("/import-wave", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    const parsed = parseWavePaste(text);
    let created = 0, skipped = 0;
    const newVendors = [];

    for (const v of parsed) {
      const exists = await Vendor.findOne({
        name: { $regex: `^${esc(v.name)}$`, $options: "i" }
      }).lean();
      if (exists) { skipped++; continue; }
      const vendor = await Vendor.create(v);
      newVendors.push(vendor);
      created++;
    }

    res.json({ created, skipped, total: parsed.length, vendors: newVendors });
  } catch (err) {
    console.error("Wave import error:", err);
    res.status(500).json({ error: "Import failed" });
  }
});

// ── POST /api/vendors/parse-document — parse invoice / dispatch text ──────────
router.post("/parse-document", (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });
    const result = parseDocument(text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Parse failed" });
  }
});

// ── PUT /api/vendors/:id ──────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const updated = await Vendor.findByIdAndUpdate(
      req.params.id, { $set: req.body }, { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update vendor" });
  }
});

// ── DELETE /api/vendors/:id ───────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id).lean();
    if (!vendor) return res.status(404).json({ error: "Not found" });

    const expCount = await Expense.countDocuments({
      vendor: { $regex: `^${esc(vendor.name)}$`, $options: "i" }
    });
    if (expCount > 0) {
      return res.status(400).json({
        error: `Cannot delete — this vendor has ${expCount} expense${expCount !== 1 ? "s" : ""} on record.`
      });
    }

    await Vendor.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete vendor" });
  }
});

module.exports = router;
