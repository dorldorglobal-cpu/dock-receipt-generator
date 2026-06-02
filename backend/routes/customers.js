const express  = require("express");
const router   = express.Router();
const AddressBook = require("../models/AddressBook");
const Order       = require("../models/Order");

// ── Helper: escape regex special chars ───────────────────────────────────────
const esc = (s) => (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── GET /api/customers — all customers with order counts ─────────────────────
router.get("/", async (req, res) => {
  try {
    const { search } = req.query;
    const query = { type: { $regex: "^customer$", $options: "i" } };
    if (search) {
      const v = esc(search);
      query.$or = [
        { companyName: { $regex: v, $options: "i" } },
        { contactName: { $regex: v, $options: "i" } },
        { email:       { $regex: v, $options: "i" } },
        { phone:       { $regex: v, $options: "i" } },
      ];
    }

    // 1 query: all matching customers
    const customers = await AddressBook.find(query).sort({ companyName: 1 }).lean();

    // 1 query: all orders (only fields we need), sorted newest first
    const allOrders = await Order
      .find({})
      .sort({ createdAt: -1 })
      .select("customerName refNumber status createdAt pol pod year make model")
      .lean();

    // Group orders by normalised customer name in JS — O(orders) instead of O(customers × 2)
    const orderMap = {};
    for (const o of allOrders) {
      const key = (o.customerName || "").toLowerCase().trim();
      if (!orderMap[key]) orderMap[key] = { count: 0, last: null };
      orderMap[key].count++;
      if (!orderMap[key].last) orderMap[key].last = o; // already sorted desc
    }

    const result = customers.map((c) => {
      const key = (c.companyName || "").toLowerCase().trim();
      const stats = orderMap[key] || { count: 0, last: null };
      return { ...c, orderCount: stats.count, lastOrder: stats.last };
    });

    res.json(result);
  } catch (err) {
    console.error("Customers fetch error:", err);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

// ── GET /api/customers/:id/orders — orders for one customer ──────────────────
router.get("/:id/orders", async (req, res) => {
  try {
    const customer = await AddressBook.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    const orders = await Order.find({
      customerName: { $regex: `^${esc(customer.companyName)}$`, $options: "i" },
    }).sort({ createdAt: -1 }).select("refNumber status createdAt pol pod year make model vin");
    res.json(orders);
  } catch (err) {
    console.error("Customer orders error:", err);
    res.status(500).json({ error: "Failed to fetch customer orders" });
  }
});

// ── POST /api/customers/merge — merge two duplicate customers ────────────────
router.post("/merge", async (req, res) => {
  try {
    const { keepId, deleteId } = req.body;
    if (!keepId || !deleteId) return res.status(400).json({ error: "keepId and deleteId required" });

    const keep = await AddressBook.findById(keepId).lean();
    const del  = await AddressBook.findById(deleteId).lean();
    if (!keep || !del) return res.status(404).json({ error: "Customer not found" });

    // Fill blank fields on the keeper from the duplicate
    const fields = ["contactName","phone","email","address","city","state","postalCode","country","notes"];
    const updates = {};
    fields.forEach(f => { if (!keep[f] && del[f]) updates[f] = del[f]; });
    // Combine balance / overdue
    const newBalance = (keep.balance || 0) + (del.balance || 0);
    const newOverdue = (keep.overdue || 0) + (del.overdue || 0);
    if (newBalance) updates.balance = newBalance;
    if (newOverdue) updates.overdue = newOverdue;

    if (Object.keys(updates).length) {
      await AddressBook.findByIdAndUpdate(keepId, { $set: updates });
    }

    // Re-point all orders that used the deleted customer's name
    await Order.updateMany(
      { customerName: { $regex: `^${esc(del.companyName)}$`, $options: "i" } },
      { $set: { customerName: keep.companyName } }
    );

    await AddressBook.findByIdAndDelete(deleteId);
    res.json({ success: true });
  } catch (err) {
    console.error("Merge error:", err);
    res.status(500).json({ error: "Merge failed" });
  }
});

// ── POST /api/customers — create new customer ────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { companyName } = req.body;
    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ error: "Company name is required." });
    }
    // Check for duplicate
    const exists = await AddressBook.findOne({
      companyName: { $regex: `^${esc(companyName.trim())}$`, $options: "i" },
      type: "customer",
    });
    if (exists) {
      return res.status(400).json({ error: `A customer named "${companyName}" already exists.` });
    }
    const customer = await AddressBook.create({ ...req.body, type: "customer" });
    res.status(201).json(customer);
  } catch (err) {
    console.error("Customer create error:", err);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

// ── PUT /api/customers/:id — update customer info ────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const updated = await AddressBook.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    console.error("Customer update error:", err);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

// ── DELETE /api/customers/:id ────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const customer = await AddressBook.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: "Not found" });

    // Block deletion if orders exist under this customer's name
    const orderCount = await Order.countDocuments({
      customerName: { $regex: `^${esc(customer.companyName)}$`, $options: "i" },
    });
    if (orderCount > 0) {
      return res.status(400).json({
        error: `Cannot delete — this customer has ${orderCount} order${orderCount !== 1 ? "s" : ""} on record.`,
      });
    }

    await AddressBook.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete" });
  }
});

module.exports = router;
