const express = require("express");
const Pricing = require("../models/Pricing");

const router = express.Router();

// GET ALL PRICING
router.get("/", async (req, res) => {
  try {
    const { type, search } = req.query;

    const filter = {};

    if (type) {
      filter.type = type;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { pickupLocation: { $regex: search, $options: "i" } },
        { deliveryLocation: { $regex: search, $options: "i" } },
        { shippingLine: { $regex: search, $options: "i" } },
        { pol: { $regex: search, $options: "i" } },
        { pod: { $regex: search, $options: "i" } },
      ];
    }

    const pricing = await Pricing.find(filter).sort({
      createdAt: -1,
    });

    res.json(pricing);
  } catch (err) {
    console.error("Get pricing error:", err);
    res.status(500).json({ error: "Failed to fetch pricing" });
  }
});

// CREATE PRICING
router.post("/", async (req, res) => {
  try {
    const pricing = await Pricing.create(req.body);
    res.status(201).json(pricing);
  } catch (err) {
    console.error("Create pricing error:", err);
    res.status(500).json({ error: "Failed to create pricing" });
  }
});

// UPDATE PRICING
router.put("/:id", async (req, res) => {
  try {
    const pricing = await Pricing.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!pricing) {
      return res.status(404).json({ error: "Pricing not found" });
    }

    res.json(pricing);
  } catch (err) {
    console.error("Update pricing error:", err);
    res.status(500).json({ error: "Failed to update pricing" });
  }
});

// DELETE PRICING
router.delete("/:id", async (req, res) => {
  try {
    const pricing = await Pricing.findByIdAndDelete(req.params.id);

    if (!pricing) {
      return res.status(404).json({ error: "Pricing not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete pricing error:", err);
    res.status(500).json({ error: "Failed to delete pricing" });
  }
});

module.exports = router;