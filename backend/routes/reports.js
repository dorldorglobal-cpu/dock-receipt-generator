const express = require("express");
const router  = express.Router();
const Order   = require("../models/Order");
const Expense = require("../models/Expense");
const Invoice = require("../models/Invoice");

// ── Helpers ───────────────────────────────────────────────────────────────────
const orderTotal = (o) =>
  Object.values(o.charges || {}).reduce((s, v) => s + Number(v || 0), 0);

const dateQ = (from, to, field) => {
  const q = {};
  if (from || to) {
    q[field] = {};
    if (from) q[field].$gte = new Date(from);
    if (to)   q[field].$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
  }
  return q;
};

// ── GET /api/reports/income-by-customer ───────────────────────────────────────
router.get("/income-by-customer", async (req, res) => {
  try {
    const { from, to } = req.query;
    const orders = await Order.find(dateQ(from, to, "createdAt")).lean();
    const map = {};
    for (const o of orders) {
      const key = (o.customerName || "—").trim();
      if (!map[key]) map[key] = { customer: key, orders: 0, billed: 0, collected: 0, outstanding: 0 };
      map[key].orders++;
      const amt = orderTotal(o);
      map[key].billed += amt;
      if (o.status === "Completed") map[key].collected += amt;
      else map[key].outstanding += amt;
    }
    const rows   = Object.values(map).sort((a, b) => b.billed - a.billed);
    const totals = rows.reduce((t, r) => ({
      orders: t.orders + r.orders, billed: t.billed + r.billed,
      collected: t.collected + r.collected, outstanding: t.outstanding + r.outstanding,
    }), { orders: 0, billed: 0, collected: 0, outstanding: 0 });
    res.json({ rows, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/income-by-destination ────────────────────────────────────
router.get("/income-by-destination", async (req, res) => {
  try {
    const { from, to } = req.query;
    const orders = await Order.find(dateQ(from, to, "createdAt")).lean();
    const map = {};
    for (const o of orders) {
      const key = (o.pod || "Unknown").trim();
      if (!map[key]) map[key] = { destination: key, orders: 0, completed: 0, billed: 0 };
      map[key].orders++;
      map[key].billed += orderTotal(o);
      if (o.status === "Completed") map[key].completed++;
    }
    const rows   = Object.values(map).sort((a, b) => b.billed - a.billed);
    const totals = { orders: rows.reduce((s, r) => s + r.orders, 0), billed: rows.reduce((s, r) => s + r.billed, 0) };
    res.json({ rows, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/income-by-route ─────────────────────────────────────────
router.get("/income-by-route", async (req, res) => {
  try {
    const { from, to } = req.query;
    const orders = await Order.find(dateQ(from, to, "createdAt")).lean();
    const map = {};
    for (const o of orders) {
      const pol = o.pol || "?", pod = o.pod || "?";
      const key = `${pol} > ${pod}`;
      if (!map[key]) map[key] = { route: key, pol, pod, orders: 0, billed: 0 };
      map[key].orders++;
      map[key].billed += orderTotal(o);
    }
    const rows   = Object.values(map).sort((a, b) => b.billed - a.billed);
    const totals = { orders: rows.reduce((s, r) => s + r.orders, 0), billed: rows.reduce((s, r) => s + r.billed, 0) };
    res.json({ rows, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/aged-receivables ────────────────────────────────────────
router.get("/aged-receivables", async (req, res) => {
  try {
    const orders = await Order.find({ status: { $nin: ["Completed"] } }).lean();
    const rows = [];
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    for (const o of orders) {
      const amt = orderTotal(o);
      if (!amt) continue;
      const age    = Math.floor((Date.now() - new Date(o.createdAt)) / 86400000);
      const bucket = age <= 30 ? "0-30" : age <= 60 ? "31-60" : age <= 90 ? "61-90" : "90+";
      buckets[bucket] += amt;
      rows.push({
        customer: o.customerName || "—",
        refNumber: o.refNumber || "—",
        vehicle: [o.year, o.make, o.model].filter(Boolean).join(" ") || "—",
        status: o.status,
        amount: amt, age, bucket,
        createdAt: o.createdAt,
      });
    }
    rows.sort((a, b) => b.age - a.age);
    res.json({ rows, buckets, total: rows.reduce((s, r) => s + r.amount, 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/aged-payables ───────────────────────────────────────────
router.get("/aged-payables", async (req, res) => {
  try {
    const expenses = await Expense.find({ status: "unpaid" }).lean();
    const rows = [];
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    for (const e of expenses) {
      const age    = Math.floor((Date.now() - new Date(e.date || e.createdAt)) / 86400000);
      const bucket = age <= 30 ? "0-30" : age <= 60 ? "31-60" : age <= 90 ? "61-90" : "90+";
      buckets[bucket] += e.amount;
      rows.push({
        vendor: e.vendor || "—",
        description: e.description,
        category: e.category,
        invoiceNumber: e.invoiceNumber || "—",
        amount: e.amount,
        date: e.date,
        age, bucket,
        orderRef: e.orderRef || "",
      });
    }
    rows.sort((a, b) => b.age - a.age);
    res.json({ rows, buckets, total: rows.reduce((s, r) => s + r.amount, 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/purchases-by-vendor ─────────────────────────────────────
router.get("/purchases-by-vendor", async (req, res) => {
  try {
    const { from, to } = req.query;
    const expenses = await Expense.find(dateQ(from, to, "date")).lean();
    const map = {};
    for (const e of expenses) {
      const key = (e.vendor || "Unknown").trim();
      if (!map[key]) map[key] = { vendor: key, category: e.category, bills: 0, total: 0, paid: 0, unpaid: 0 };
      map[key].bills++;
      map[key].total += e.amount;
      if (e.status === "paid") map[key].paid += e.amount;
      else map[key].unpaid += e.amount;
    }
    const rows   = Object.values(map).sort((a, b) => b.total - a.total);
    const totals = rows.reduce((t, r) => ({
      bills: t.bills + r.bills, total: t.total + r.total,
      paid: t.paid + r.paid, unpaid: t.unpaid + r.unpaid,
    }), { bills: 0, total: 0, paid: 0, unpaid: 0 });
    res.json({ rows, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/expenses-by-category ────────────────────────────────────
router.get("/expenses-by-category", async (req, res) => {
  try {
    const { from, to } = req.query;
    const expenses = await Expense.find(dateQ(from, to, "date")).sort({ date: -1 }).lean();
    const map = {};
    for (const e of expenses) {
      const key = e.category || "Uncategorized";
      if (!map[key]) map[key] = { category: key, bills: 0, total: 0, paid: 0, unpaid: 0, items: [] };
      map[key].bills++;
      map[key].total += e.amount;
      if (e.status === "paid" || e.status === "partial") map[key].paid += e.paidAmount || (e.status === "paid" ? e.amount : 0);
      if (e.status !== "paid") map[key].unpaid += e.amount - (e.paidAmount || 0);
      map[key].items.push({
        _id:           e._id,
        date:          e.date,
        vendor:        e.vendor || "—",
        description:   e.description,
        orderRef:      e.orderRef || "",
        invoiceNumber: e.invoiceNumber || "",
        amount:        e.amount,
        paidAmount:    e.paidAmount || 0,
        status:        e.status,
      });
    }
    const total = Object.values(map).reduce((s, r) => s + r.total, 0);
    const rows  = Object.values(map)
      .map(r => ({ ...r, pct: total > 0 ? +((r.total / total) * 100).toFixed(1) : 0 }))
      .sort((a, b) => b.total - a.total);
    res.json({ rows, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/profit-loss?basis=accrual|cash ──────────────────────────
router.get("/profit-loss", async (req, res) => {
  try {
    const { from, to, basis = "accrual" } = req.query;
    const expFilter = basis === "cash"
      ? { ...dateQ(from, to, "paidDate"), status: "paid" }
      : dateQ(from, to, "date");

    const revByType = { "Towing / Transport": 0, "Ocean Freight": 0, "Other Revenue": 0 };
    let totalRevenue = 0;
    let orderCount = 0;

    if (basis === "cash") {
      // Cash basis: revenue from paid invoices only
      const invFilter = { status: "paid", ...dateQ(from, to, "updatedAt") };
      const paidInvoices = await Invoice.find(invFilter).lean();
      orderCount = paidInvoices.length;
      for (const inv of paidInvoices) {
        // Pull charge breakdown from the linked order if available
        const linkedOrder = inv.orderId
          ? await Order.findById(inv.orderId).select("charges").lean().catch(() => null)
          : null;
        if (linkedOrder) {
          const c   = linkedOrder.charges || {};
          const tow = Number(c.towingCharge || 0);
          const oce = Number(c.oceanFreight || 0);
          const oth = Object.entries(c)
            .filter(([k]) => !["towingCharge","oceanFreight"].includes(k) && !k.endsWith("Cost") && !k.endsWith("Desc") && !k.endsWith("Category"))
            .reduce((s,[,v]) => s + Number(v||0), 0);
          revByType["Towing / Transport"] += tow;
          revByType["Ocean Freight"]       += oce;
          revByType["Other Revenue"]       += oth;
          totalRevenue += tow + oce + oth;
        } else {
          revByType["Other Revenue"] += Number(inv.total || 0);
          totalRevenue += Number(inv.total || 0);
        }
      }
    } else {
      // Accrual basis: all orders
      const orders = await Order.find(dateQ(from, to, "createdAt")).lean();
      orderCount = orders.length;
      for (const o of orders) {
        const c   = o.charges || {};
        const tow = Number(c.towingCharge || 0);
        const oce = Number(c.oceanFreight || 0);
        const oth = Object.entries(c)
          .filter(([k]) => !["towingCharge","oceanFreight"].includes(k) && !k.endsWith("Cost") && !k.endsWith("Desc") && !k.endsWith("Category"))
          .reduce((s,[,v]) => s + Number(v||0), 0);
        revByType["Towing / Transport"] += tow;
        revByType["Ocean Freight"]       += oce;
        revByType["Other Revenue"]       += oth;
        totalRevenue += tow + oce + oth;
      }
    }

    const expenses = await Expense.find(expFilter).lean();
    const expByCat = {};
    let totalExpenses = 0;
    for (const e of expenses) {
      const cat = e.category || "Uncategorized";
      expByCat[cat] = (expByCat[cat] || 0) + e.amount;
      totalExpenses += e.amount;
    }

    const netProfit = totalRevenue - totalExpenses;
    const margin    = totalRevenue > 0 ? +((netProfit / totalRevenue) * 100).toFixed(1) : 0;

    res.json({ basis, totalRevenue, totalExpenses, netProfit, margin,
               revByType, expByCat, orderCount, expenseCount: expenses.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/profit-loss-detail?basis=accrual|cash ───────────────────
router.get("/profit-loss-detail", async (req, res) => {
  try {
    const { from, to, basis = "accrual" } = req.query;

    let rows = [];

    if (basis === "cash") {
      // Cash: one row per paid invoice
      const invFilter = { status: "paid", ...dateQ(from, to, "updatedAt") };
      const invoices = await Invoice.find(invFilter).sort({ updatedAt: -1 }).lean();
      for (const inv of invoices) {
        const order = inv.orderId
          ? await Order.findById(inv.orderId).select("refNumber customerName charges status").lean().catch(() => null)
          : null;
        const c = order?.charges || {};
        rows.push({
          refNumber:    order?.refNumber || "—",
          customer:     inv.customerName || order?.customerName || "—",
          vehicle:      inv.vehicle || "—",
          vin:          inv.vin || "",
          invoiceNumber: inv.invoiceNumber,
          date:         inv.updatedAt,
          towingCharge: Number(c.towingCharge || 0),
          oceanFreight: Number(c.oceanFreight || 0),
          towingCost:   Number(c.towingCost   || 0),
          oceanCost:    Number(c.oceanCost    || 0),
          revenue:      Number(inv.total || 0),
          status:       "Paid",
        });
      }
    } else {
      // Accrual: one row per order
      const orders = await Order.find(dateQ(from, to, "createdAt")).sort({ createdAt: -1 }).lean();
      for (const o of orders) {
        const c = o.charges || {};
        const tow = Number(c.towingCharge || 0);
        const oce = Number(c.oceanFreight || 0);
        const oth = Object.entries(c)
          .filter(([k]) => !["towingCharge","oceanFreight"].includes(k) && !k.endsWith("Cost") && !k.endsWith("Desc") && !k.endsWith("Category"))
          .reduce((s,[,v]) => s + Number(v||0), 0);
        const towCost = Number(c.towingCost || 0);
        const ocnCost = Number(c.oceanCost  || 0);
        rows.push({
          refNumber:    o.refNumber,
          customer:     o.customerName || "—",
          vehicle:      [o.year, o.make, o.model].filter(Boolean).join(" ") || "—",
          vin:          o.vin || "",
          date:         o.createdAt,
          towingCharge: tow,
          oceanFreight: oce,
          otherRevenue: oth,
          towingCost:   towCost,
          oceanCost:    ocnCost,
          revenue:      tow + oce + oth,
          cost:         towCost + ocnCost,
          profit:       (tow + oce + oth) - (towCost + ocnCost),
          status:       o.status || "—",
        });
      }
    }

    res.json({ basis, rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/cash-flow?months=6 ──────────────────────────────────────
router.get("/cash-flow", async (req, res) => {
  try {
    const monthCount = Math.min(parseInt(req.query.months) || 6, 24);
    const now    = new Date();
    const months = [];

    for (let i = monthCount - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end   = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const [completed, paid] = await Promise.all([
        Order.find({ status: "Completed", createdAt: { $gte: start, $lte: end } }).lean(),
        Expense.find({ status: "paid", paidDate: { $gte: start, $lte: end } }).lean(),
      ]);
      const inflow  = completed.reduce((s, o) => s + orderTotal(o), 0);
      const outflow = paid.reduce((s, e) => s + e.amount, 0);
      months.push({ month: start.toLocaleString("default", { month: "short", year: "numeric" }), inflow, outflow, net: inflow - outflow });
    }

    const totals = months.reduce((t, m) => ({
      inflow: t.inflow + m.inflow, outflow: t.outflow + m.outflow, net: t.net + m.net,
    }), { inflow: 0, outflow: 0, net: 0 });

    res.json({ months, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/orders-detail — individual orders for detailed income views
router.get("/orders-detail", async (req, res) => {
  try {
    const { from, to, notCompleted } = req.query;
    const q = dateQ(from, to, "createdAt");
    if (notCompleted) q.status = { $nin: ["Completed"] };
    const orders = await Order.find(q).sort({ createdAt: -1 }).lean();
    res.json({
      rows: orders.map((o) => {
        const c = o.charges || {};
        return {
          refNumber:    o.refNumber || "—",
          date:         o.createdAt,
          customer:     o.customerName || "—",
          vehicle:      [o.year, o.make, o.model].filter(Boolean).join(" ") || "—",
          vin:          o.vin || "",
          pol:          o.pol || "—",
          pod:          o.pod || "—",
          status:       o.status || "—",
          age:          Math.floor((Date.now() - new Date(o.createdAt)) / 86400000),
          towingCharge: Number(c.towingCharge || 0),
          oceanFreight: Number(c.oceanFreight || 0),
          total:        orderTotal(o),
        };
      }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/expenses-detail — individual expense rows ────────────────
router.get("/expenses-detail", async (req, res) => {
  try {
    const { from, to, status } = req.query;
    const q = dateQ(from, to, "date");
    if (status) q.status = status;
    const expenses = await Expense.find(q).sort({ date: -1 }).lean();
    res.json({ rows: expenses });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/reports/export-pdf — generic landscape table PDF ───────────────
router.post("/export-pdf", async (req, res) => {
  try {
    const { title, subtitle, columns, rows, totalsRow } = req.body;
    const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

    const doc   = await PDFDocument.create();
    const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontR = await doc.embedFont(StandardFonts.Helvetica);
    const safe  = (s) => String(s || "").replace(/[^\x00-\xFF]/g, "?").replace(/—/g,"-").replace(/–/g,"-");

    const PW = 792, PH = 612, mg = 40;
    let page = doc.addPage([PW, PH]);
    let y = PH - mg;

    const txt = (t, x, yy, sz, font, color) =>
      page.drawText(safe(String(t ?? "")), { x, y: yy, size: sz || 9, font: font || fontR, color: color || rgb(0.1,0.1,0.1) });
    const rule = (yy, thick = 0.5) =>
      page.drawLine({ start:{x:mg,y:yy}, end:{x:PW-mg,y:yy}, thickness: thick, color: rgb(0.75,0.75,0.75) });

    // Header
    txt("DDG GLOBAL LOGISTICS", mg, y, 14, fontB, rgb(0.08,0.38,0.72));
    txt(new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}), PW-mg-140, y, 9, fontR, rgb(0.5,0.5,0.5));
    y -= 18;
    txt(safe(title), mg, y, 12, fontB);
    if (subtitle) { y -= 14; txt(safe(subtitle), mg, y, 9, fontR, rgb(0.45,0.45,0.45)); }
    y -= 12;
    rule(y, 1.5);
    y -= 16;

    // Column layout: first col 28%, rest split evenly
    const numCols = columns.length;
    const usable  = PW - mg * 2;
    const firstW  = Math.floor(usable * 0.28);
    const restW   = numCols > 1 ? Math.floor((usable - firstW) / (numCols - 1)) : usable;
    const colX    = columns.map((_, i) => i === 0 ? mg : mg + firstW + (i - 1) * restW);

    // Detect right-aligned cols (money / number)
    const isRight = columns.map((_, i) => {
      if (i === 0) return false;
      const s = String(rows[0]?.[i] ?? "");
      return /^\$[\d,]|^\d+$/.test(s.trim());
    });

    const drawHeaders = () => {
      columns.forEach((col, i) => {
        const label = safe(typeof col === "string" ? col : col.label || "");
        const x = isRight[i] ? colX[i] + (i < numCols - 1 ? restW : 80) - label.length * 5.2 : colX[i];
        txt(label, Math.max(colX[i], x), y, 9, fontB, rgb(0.35,0.35,0.35));
      });
      y -= 6; rule(y, 0.5); y -= 13;
    };

    drawHeaders();

    // Data rows
    for (const row of rows) {
      if (y < mg + 20) {
        page = doc.addPage([PW, PH]); y = PH - mg;
        drawHeaders();
      }
      (Array.isArray(row) ? row : Object.values(row)).forEach((cell, i) => {
        const val = safe(String(cell ?? ""));
        const x   = isRight[i] ? colX[i] + (i < numCols - 1 ? restW : 80) - val.length * 4.8 : colX[i];
        txt(val, Math.max(colX[i], x), y, 8.5, fontR);
      });
      y -= 14;
    }

    // Totals row
    if (totalsRow?.length) {
      y -= 4; rule(y, 0.5); y -= 13;
      totalsRow.forEach((cell, i) => {
        if (cell == null || cell === "") return;
        const val = safe(String(cell));
        const x   = isRight[i] ? colX[i] + (i < numCols - 1 ? restW : 80) - val.length * 4.8 : colX[i];
        txt(val, Math.max(colX[i], x), y, 9, fontB);
      });
    }

    // Footer
    if (y > mg + 20) { y -= 16; rule(y); y -= 12; }
    txt("DDG Global Logistics  |  Confidential", mg, Math.max(y, mg + 6), 7, fontR, rgb(0.6,0.6,0.6));

    const bytes = await doc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safe(title).replace(/\W+/g, "-")}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (e) {
    console.error("Report PDF error:", e);
    res.status(500).json({ error: "PDF generation failed" });
  }
});

module.exports = router;
