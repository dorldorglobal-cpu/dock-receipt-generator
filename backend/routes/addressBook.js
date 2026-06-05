const express = require("express");
const AddressBook = require("../models/AddressBook");

const router = express.Router();

// DELETE ALL ADDRESS BOOK RECORDS
router.delete("/delete-all", async (req, res) => {
  try {
    const result = await AddressBook.deleteMany({});

    res.json({
      success: true,
      deleted: result.deletedCount,
    });
  } catch (err) {
    console.error("Delete all address book error:", err);

    res.status(500).json({
      error: "Failed to delete address book",
    });
  }
});

// SEARCH / LIST ADDRESSES
router.get("/", async (req, res) => {
  try {
    const { search, type } = req.query;

    const query = {};

    // Type filter — case-insensitive so "customer" matches "Customer", "USPPI" matches "usppi", etc.
    if (type) {
      query.type = { $regex: `^${type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" };
    }

    if (search) {
      // Fuzzy name variants so "ALL-SPECS" matches "ALL SPECS" and vice versa
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const v1 = esc(search);
      const v2 = esc(search.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim());
      const v3 = esc(search.replace(/\s+/g, "-"));
      const nameConditions = [...new Set([v1, v2, v3])].map(v => ({
        companyName: { $regex: v, $options: "i" },
      }));

      // Search ONLY on name, contactName, city, state — not address/zip/country/phone/email
      // This prevents irrelevant hits (e.g. typing "Nigeria" won't flood results with country matches)
      query.$or = [
        ...nameConditions,
        { contactName: { $regex: v1, $options: "i" } },
        { city:        { $regex: v1, $options: "i" } },
        { state:       { $regex: v1, $options: "i" } },
      ];
    }

    const addresses = await AddressBook.find(query)
      .sort({ companyName: 1 })
      .limit(25);

    res.json(addresses);
  } catch (err) {
    console.error("Search address error:", err);
    res.status(500).json({ error: "Failed to fetch addresses" });
  }
});

// CREATE ADDRESS BOOK ENTRY
router.post("/", async (req, res) => {
  try {
    const entry = await AddressBook.create(req.body);
    res.status(201).json(entry);
  } catch (err) {
    console.error("Create address error:", err);
    res.status(500).json({ error: "Failed to create address" });
  }
});

// ── PUT /api/address-book/:id — update entry ─────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const entry = await AddressBook.findByIdAndUpdate(
      req.params.id, req.body, { new: true, runValidators: false }
    );
    if (!entry) return res.status(404).json({ error: "Not found" });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to update address" });
  }
});

// ── PATCH /api/address-book/:id/add-buyer — append buyer account name ────────
router.patch("/:id/add-buyer", async (req, res) => {
  try {
    const { buyerName } = req.body;
    if (!buyerName?.trim()) return res.status(400).json({ error: "buyerName required" });
    const entry = await AddressBook.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { buyerAccounts: buyerName.trim() } },
      { new: true }
    );
    if (!entry) return res.status(404).json({ error: "Not found" });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: "Failed to add buyer account" });
  }
});

// ── GET /api/address-book/lookup-buyer?name=GOLDEN+NOOR ──────────────────────
// Returns the customer that owns this buyer account name
router.get("/lookup-buyer", async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.json({ customer: null });

    const needle = name.toLowerCase().replace(/[^a-z0-9]/g, "");

    // 1. Exact buyer account match
    const exact = await AddressBook.findOne({
      buyerAccounts: { $elemMatch: { $regex: name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      type: "customer",
    }).lean();
    if (exact) return res.json({ customer: exact });

    // 2. Fuzzy match against buyer accounts
    const allCustomers = await AddressBook.find({ type: "customer", buyerAccounts: { $exists: true, $not: { $size: 0 } } })
      .select("companyName phone email defaultPod buyerAccounts").lean();

    for (const c of allCustomers) {
      for (const acct of (c.buyerAccounts || [])) {
        const hay = acct.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (hay.includes(needle) || needle.includes(hay)) {
          return res.json({ customer: c });
        }
      }
    }

    res.json({ customer: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;