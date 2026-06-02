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

module.exports = router;