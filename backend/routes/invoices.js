const express = require("express");
const router  = express.Router();
const path    = require("path");
const Invoice = require("../models/Invoice");
const Order   = require("../models/Order");
const PDFDocument = require("pdfkit");

// ── Auto-generate next invoice number ─────────────────────────────────────────
async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const last = await Invoice.findOne(
    { invoiceNumber: new RegExp(`^INV-${year}-`) },
    { invoiceNumber: 1 },
    { sort: { invoiceNumber: -1 } }
  ).lean();
  if (!last) return `INV-${year}-0001`;
  const seq = parseInt((last.invoiceNumber || "").split("-")[2] || "0", 10);
  return `INV-${year}-${String(seq + 1).padStart(4, "0")}`;
}

// ── Format helper ──────────────────────────────────────────────────────────────
const fmt = (n) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── POST /api/invoices — create invoice + log to order timeline ───────────────
router.post("/", async (req, res) => {
  try {
    const { orderId, items, notes, dueDate } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Never duplicate — if an invoice already exists for this order, update it
    const existing = await Invoice.findOne({ orderId }).sort({ createdAt: 1 });
    if (existing) {
      const total = (items || []).reduce((s, i) => s + Number(i.amount || 0), 0);
      const updated = await Invoice.findByIdAndUpdate(existing._id, {
        items: items || [],
        subtotal: total,
        total,
        notes: notes || existing.notes,
        ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
      }, { new: true });
      return res.json(updated);
    }

    const invoiceNumber = await nextInvoiceNumber();
    const total = (items || []).reduce((s, i) => s + Number(i.amount || 0), 0);

    // Derive shipping line from booking number prefix
    const bn = (order.bookingNumber || "").toUpperCase();
    const shippingLine = bn.startsWith("SLSE") || bn.startsWith("SLS")
      ? "SALLAUM LINES"
      : bn.startsWith("ACL") || bn.startsWith("GLL")
      ? "ACL"
      : order.shippingLine || "";

    const invoice = await Invoice.create({
      invoiceNumber,
      orderId,
      orderRef:      order.refNumber,
      customerName:  order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      vehicle:       [order.year, order.make, order.model].filter(Boolean).join(" ") || "",
      vin:           order.vin,
      pol:           order.pol,
      pod:           order.pod,
      voyage:        order.voyage      || "",
      arrivalDate:   order.arrivalDate || "",
      shippingLine,
      items:         items || [],
      subtotal:      total,
      total,
      notes:         notes || "",
      dueDate:       (() => {
        if (order.sailDate) {
          const sail = new Date(order.sailDate);
          if (!isNaN(sail)) { sail.setDate(sail.getDate() - 3); return sail; }
        }
        return dueDate ? new Date(dueDate) : null;
      })(),
      status:        "draft",
    });

    // Log to order timeline
    await Order.findByIdAndUpdate(orderId, {
      $push: {
        timeline: {
          action:    "Invoice Generated",
          details:   `Invoice ${invoiceNumber} generated — Total: ${fmt(total)}`,
          createdAt: new Date(),
        },
      },
    });

    res.json(invoice);
  } catch (e) {
    console.error("Create invoice error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/invoices — list invoices (search / filter) ───────────────────────
router.get("/", async (req, res) => {
  try {
    const { status, search, from, to } = req.query;
    const q = {};

    if (status && status !== "all") q.status = status;

    if (from || to) {
      q.createdAt = {};
      if (from) q.createdAt.$gte = new Date(from);
      if (to)   q.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [
        { customerName:  re },
        { invoiceNumber: re },
        { orderRef:      re },
        { vehicle:       re },
      ];
    }

    const invoices = await Invoice.find(q).sort({ createdAt: -1 }).lean();
    res.json(invoices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/invoices/by-order/:orderId — invoices for a specific order ───────
router.get("/by-order/:orderId", async (req, res) => {
  try {
    const invoices = await Invoice.find({ orderId: req.params.orderId })
      .sort({ createdAt: -1 }).lean();
    res.json(invoices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/invoices/:id — single invoice ────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id).lean();
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    res.json(inv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/invoices/:id — update items / amounts of an existing invoice ────
router.put("/:id", async (req, res) => {
  try {
    const { items, notes, dueDate } = req.body;
    const total = (items || []).reduce((s, i) => s + Number(i.amount || 0), 0);

    // Recalculate due date from order's sail date if available
    const existingInv = await Invoice.findById(req.params.id).lean();
    const linkedOrder = existingInv?.orderId ? await Order.findById(existingInv.orderId).select("sailDate").lean() : null;
    let computedDueDate = dueDate ? new Date(dueDate) : null;
    if (linkedOrder?.sailDate) {
      const sail = new Date(linkedOrder.sailDate);
      if (!isNaN(sail)) { sail.setDate(sail.getDate() - 3); computedDueDate = sail; }
    }

    const inv = await Invoice.findByIdAndUpdate(
      req.params.id,
      {
        items:    items || [],
        subtotal: total,
        total,
        notes:    notes ?? undefined,
        dueDate:  computedDueDate,
        updatedAt: new Date(),
      },
      { new: true }
    ).lean();

    if (!inv) return res.status(404).json({ error: "Invoice not found" });

    // Log to order timeline
    if (inv.orderId) {
      await Order.findByIdAndUpdate(inv.orderId, {
        $push: {
          timeline: {
            action:    "Invoice Updated",
            details:   `Invoice ${inv.invoiceNumber} updated — Total: ${fmt(total)}`,
            createdAt: new Date(),
          },
        },
      });
    }

    res.json(inv);
  } catch (e) {
    console.error("Update invoice error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/invoices/:id — remove invoice ────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const inv = await Invoice.findByIdAndDelete(req.params.id).lean();
    if (!inv) return res.status(404).json({ error: "Invoice not found" });

    // Log to order timeline
    if (inv.orderId) {
      await Order.findByIdAndUpdate(inv.orderId, {
        $push: {
          timeline: {
            action:    "Invoice Deleted",
            details:   `Invoice ${inv.invoiceNumber} deleted`,
            createdAt: new Date(),
          },
        },
      });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("Delete invoice error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/invoices/:id/status — mark sent / paid / draft ─────────────────
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["draft", "sent", "paid"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const updates = { status };
    if (status === "sent") updates.sentAt = new Date();
    if (status === "paid") updates.paidAt = new Date();

    const inv = await Invoice.findByIdAndUpdate(req.params.id, updates, { new: true }).lean();
    if (!inv) return res.status(404).json({ error: "Invoice not found" });

    // Log to order timeline
    if (inv.orderId) {
      const verb =
        status === "sent" ? "sent to customer" :
        status === "paid" ? "marked as Paid"   :
        "reverted to Draft";
      await Order.findByIdAndUpdate(inv.orderId, {
        $push: {
          timeline: {
            action:    status === "sent" ? "Invoice Sent" : status === "paid" ? "Invoice Paid" : "Invoice Updated",
            details:   `Invoice ${inv.invoiceNumber} — ${verb}`,
            createdAt: new Date(),
          },
        },
      });
    }

    res.json(inv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Shared: generate invoice PDF → Buffer ─────────────────────────────────────
async function generateInvoicePdf(inv, order) {
    const bookingNumber = order?.bookingNumber || "";

    // ── Sanitize text — replace unicode arrows/dashes PDFKit can't render ──
    const txt = (s) => (s || "")
      .replace(/→/g, ">")   // →
      .replace(/—/g, "-")   // —
      .replace(/–/g, "-")   // –
      .replace(/’/g, "'");  // '

    const doc    = new PDFDocument({ margin: 0, size: "LETTER", autoFirstPage: true });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    const pdfReady = new Promise((resolve, reject) => {
      doc.on("end",   () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    const PW    = 612;
    const PH    = 792;
    const ML    = 50;  // margin left
    const MR    = 50;  // margin right
    const W     = PW - ML - MR;   // 512 usable
    const navy  = "#1a3567";
    const steel = "#2d5fa6";
    const dark  = "#1a1a2e";
    const muted = "#6b7280";
    const light = "#f1f5f9";
    const white = "#ffffff";

    const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-US",
      { month: "short", day: "numeric", year: "numeric" }) : "—";

    // ── HEADER BAR ────────────────────────────────────────────────────────────
    const HDR_H = 108;
    const hdrBg     = "#f1f5f9";   // light gray
    const hdrAccent = navy;         // navy left bar
    const hdrTitle  = navy;         // navy text for INVOICE
    const hdrText   = "#1a1a2e";   // dark for company name
    const hdrMuted  = "#4b5563";   // gray for address lines

    // Light gray background + bottom border
    doc.rect(0, 0, PW, HDR_H).fill(hdrBg);
    doc.rect(0, HDR_H - 1, PW, 1).fill("#c7d2e0");

    // Logo — left, vertically centered
    const logoPath = path.join(__dirname, "..", "logo.png");
    try {
      doc.image(logoPath, ML, 14, { height: 80 });
    } catch (_) { /* logo missing — skip */ }

    // Company name + address block — sits to the right of logo
    const TX = ML + 90;   // text X start
    doc.fill(hdrText).font("Helvetica-Bold").fontSize(13)
       .text("Dor L'Dor Global LLC", TX, 20, { lineBreak: false });
    doc.fill(hdrMuted).font("Helvetica").fontSize(8)
       .text("23 GALAHAD DR  |  Manalapan, New Jersey 07726  |  United States", TX, 37, { lineBreak: false });
    doc.fill(hdrMuted).font("Helvetica").fontSize(8)
       .text("Tel: 9172003998", TX, 49, { lineBreak: false });

    // "INVOICE" — right side, vertically centered
    doc.fill(hdrTitle).font("Helvetica-Bold").fontSize(32)
       .text("INVOICE", 0, 38, { align: "right", width: PW - MR - 2, lineBreak: false });

    // ── INVOICE META BOX (right column) ──────────────────────────────────────
    const META_X = 390;
    const META_Y = HDR_H + 14;
    const META_W = 172;

    doc.rect(META_X, META_Y, META_W, 80).fill(light)
       .rect(META_X, META_Y, META_W, 80).lineWidth(0.5).strokeColor("#d1d5db").stroke();

    // Invoice #
    doc.fill(muted).font("Helvetica-Bold").fontSize(7.5)
       .text("INVOICE #", META_X + 10, META_Y + 10, { lineBreak: false });
    doc.fill(steel).font("Helvetica-Bold").fontSize(11)
       .text(inv.invoiceNumber, META_X + 10, META_Y + 22, { lineBreak: false });

    // Date
    doc.fill(muted).font("Helvetica").fontSize(8)
       .text("Date:", META_X + 10, META_Y + 42, { lineBreak: false });
    doc.fill(dark).font("Helvetica-Bold").fontSize(8)
       .text(fmtDate(inv.createdAt), META_X + 42, META_Y + 42, { lineBreak: false });

    // Due
    doc.fill(muted).font("Helvetica").fontSize(8)
       .text("Due:", META_X + 10, META_Y + 58, { lineBreak: false });
    if (inv.dueDate) {
      doc.fill("#dc2626").font("Helvetica-Bold").fontSize(8)
         .text(fmtDate(inv.dueDate), META_X + 42, META_Y + 58, { lineBreak: false });
    } else {
      doc.fill(muted).font("Helvetica").fontSize(8)
         .text("On receipt", META_X + 42, META_Y + 58, { lineBreak: false });
    }

    // ── BILL TO (left column) ────────────────────────────────────────────────
    let y = META_Y;
    doc.fill(muted).font("Helvetica-Bold").fontSize(7.5)
       .text("BILL TO", ML, y, { lineBreak: false });
    y += 14;
    doc.fill(dark).font("Helvetica-Bold").fontSize(13)
       .text(txt(inv.customerName || "—"), ML, y, { lineBreak: false });
    y += 18;
    if (inv.customerPhone) {
      doc.fill(dark).font("Helvetica").fontSize(9)
         .text(inv.customerPhone, ML, y, { lineBreak: false });
      y += 13;
    }
    if (inv.customerEmail) {
      doc.fill(muted).font("Helvetica").fontSize(9)
         .text(inv.customerEmail, ML, y, { lineBreak: false });
      y += 13;
    }

    // ── ORDER DETAILS BAR ────────────────────────────────────────────────────
    y = META_Y + 108;  // below meta box (4 detail rows)
    doc.rect(ML, y, W, 1).fill("#d1d5db");
    y += 8;

    doc.fill(muted).font("Helvetica-Bold").fontSize(7.5)
       .text("ORDER DETAILS", ML, y, { lineBreak: false });
    y += 13;

    // Two-column order info — paired rows so both columns stay in sync
    const col1x = ML;
    const col2x = ML + W / 2 + 10;

    // Resolve shipping line from invoice (stored at creation) or re-derive from booking
    const invShippingLine = inv.shippingLine ||
      (bookingNumber.toUpperCase().startsWith("SLSE") || bookingNumber.toUpperCase().startsWith("SLS")
        ? "SALLAUM LINES"
        : bookingNumber.toUpperCase().startsWith("ACL") || bookingNumber.toUpperCase().startsWith("GLL")
        ? "ACL"
        : "");

    // Always prefer live order data so invoice reflects latest voyage/schedule
    const voyage      = order?.voyage      || inv.voyage      || "";
    const arrivalDate = order?.arrivalDate || inv.arrivalDate || "";

    // Each entry: [leftLabel, leftValue, rightLabel, rightValue]
    const shippingLineValue = [
      invShippingLine || "—",
      voyage      ? `Voyage: ${voyage}`      : "",
      arrivalDate ? `ETA: ${arrivalDate}`    : "",
    ].filter(Boolean).join("  |  ");

    const detailPairs = [
      ["Ref:",     inv.orderRef    || "—",  "Route:",         (inv.pol && inv.pod) ? `${inv.pol} > ${inv.pod}` : "—"],
      ["Vehicle:", txt(inv.vehicle || "—"), "Shipping Line:", shippingLineValue],
      ["VIN:",     inv.vin         || "—",  "Booking #:",     bookingNumber || ""],
    ];

    // Fixed label column widths (px at 8.5pt Helvetica)
    // LBL1: widest left label is "Vehicle:" ~52px  → 58 gives a small gap
    // LBL2: widest right label is "Shipping Line:" ~82px → 90 gives a small gap
    const LBL1_W = 58;
    const LBL2_W = 90;
    const COL_W  = Math.floor(W / 2) - 10;

    detailPairs.forEach(([l1, v1, l2, v2]) => {
      const rowY = y;

      // Left label — absolute position, no continued
      doc.fill(muted).font("Helvetica").fontSize(8.5)
         .text(l1, col1x, rowY, { lineBreak: false });
      // Left value — offset right of label
      doc.fill(dark).font("Helvetica-Bold").fontSize(8.5)
         .text(txt(v1) || "-", col1x + LBL1_W, rowY,
               { width: COL_W - LBL1_W, lineBreak: false });

      // Right label + value — only render if value is present
      if (v2) {
        doc.fill(muted).font("Helvetica").fontSize(8.5)
           .text(l2, col2x, rowY, { lineBreak: false });
        doc.fill(dark).font("Helvetica-Bold").fontSize(8.5)
           .text(txt(v2), col2x + LBL2_W, rowY,
                 { width: PW - MR - col2x - LBL2_W, lineBreak: false });
      }

      y += 14;
    });

    y += 10;

    // ── ITEMS TABLE ───────────────────────────────────────────────────────────
    doc.rect(ML, y, W, 1).fill("#d1d5db");
    y += 8;

    // Table header
    const TBL_HDR_H = 24;
    doc.rect(ML, y, W, TBL_HDR_H).fill(navy);
    doc.fill(white).font("Helvetica-Bold").fontSize(9)
       .text("DESCRIPTION", ML + 10, y + 8, { lineBreak: false });
    doc.fill(white).font("Helvetica-Bold").fontSize(9)
       .text("AMOUNT", ML, y + 8, { align: "right", width: W - 10, lineBreak: false });
    y += TBL_HDR_H;

    // Item rows
    (inv.items || []).forEach((item, i) => {
      const descText = txt(item.description || "—");
      const textH    = doc.heightOfString(descText, { width: W - 110, font: "Helvetica", fontSize: 9 });
      const rowH     = Math.max(24, textH + 12);

      if (i % 2 === 0) doc.rect(ML, y, W, rowH).fill("#f8fafc");
      else              doc.rect(ML, y, W, rowH).fill(white);

      // Subtle row border
      doc.rect(ML, y, W, rowH).lineWidth(0.3).strokeColor("#e2e8f0").stroke();

      doc.fill(dark).font("Helvetica").fontSize(9)
         .text(descText, ML + 10, y + 8, { width: W - 110, lineBreak: false });
      doc.fill(dark).font("Helvetica-Bold").fontSize(9)
         .text(fmt(Number(item.amount || 0)), ML, y + 8,
               { align: "right", width: W - 10, lineBreak: false });
      y += rowH;
    });

    // ── SUBTOTAL / TOTAL ─────────────────────────────────────────────────────
    y += 4;
    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.5).strokeColor("#d1d5db").stroke();
    y += 10;

    // Total due box — right-aligned
    const TOT_W = 220;
    const TOT_H = 36;
    const TOT_X = ML + W - TOT_W;
    doc.rect(TOT_X, y, TOT_W, TOT_H).fill(navy);
    doc.fill("rgba(255,255,255,0.6)").font("Helvetica-Bold").fontSize(8)
       .text("TOTAL DUE", TOT_X + 14, y + 8, { lineBreak: false });
    doc.fill(white).font("Helvetica-Bold").fontSize(18)
       .text(fmt(inv.total), TOT_X, y + 7,
             { align: "right", width: TOT_W - 14, lineBreak: false });
    y += TOT_H + 16;

    // ── NOTES ─────────────────────────────────────────────────────────────────
    if (inv.notes) {
      doc.rect(ML, y, W, 1).fill("#e2e8f0");
      y += 8;
      doc.fill(muted).font("Helvetica-Bold").fontSize(7.5)
         .text("NOTES", ML, y, { lineBreak: false });
      y += 12;
      doc.fill(dark).font("Helvetica").fontSize(9)
         .text(txt(inv.notes), ML, y, { width: W });
      y += doc.heightOfString(txt(inv.notes), { width: W }) + 10;
    }

    // ── FOOTER — always on same page, after content ───────────────────────────
    // Use the greater of: where content ended + 20px gap, or bottom margin area
    const footerY = Math.max(y + 20, PH - 52);
    doc.rect(ML, footerY, W, 0.5).fill("#d1d5db");
    doc.fill(muted).font("Helvetica").fontSize(8)
       .text("Thank you for your business! — Dor L'Dor Global", ML, footerY + 8,
             { align: "center", width: W, lineBreak: false });
    doc.fill(muted).font("Helvetica").fontSize(7)
       .text("Payment due on receipt unless a due date is stated above.", ML, footerY + 22,
             { align: "center", width: W, lineBreak: false });

    doc.end();
    return pdfReady;
}

// ── GET /api/invoices/:id/pdf — stream PDF ────────────────────────────────────
router.get("/:id/pdf", async (req, res) => {
  try {
    const inv   = await Invoice.findById(req.params.id).lean();
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    const order = inv.orderId ? await Order.findById(inv.orderId).lean() : null;
    const buf   = await generateInvoicePdf(inv, order);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Invoice-${inv.invoiceNumber}.pdf"`);
    res.send(buf);
  } catch (e) {
    console.error("Invoice PDF error:", e);
    res.status(500).json({ error: "PDF generation failed" });
  }
});

// ── POST /api/invoices/:id/send — email invoice + draft attachment ────────────
router.post("/:id/send", async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!to) return res.status(400).json({ error: "to is required" });

    const inv = await Invoice.findById(req.params.id).lean();
    if (!inv) return res.status(404).json({ error: "Invoice not found" });

    const order = inv.orderId ? await Order.findById(inv.orderId).lean() : null;

    // ── 1. Generate invoice PDF directly (no internal HTTP) ──────────────────
    const invoicePdfBuffer = await generateInvoicePdf(inv, order);

    // ── 2. Find the Draft file in order docs ──────────────────────────────────
    const attachments = [
      { filename: `Invoice-${inv.invoiceNumber}.pdf`, content: invoicePdfBuffer.toString("base64"), encoding: "base64" },
    ];

    if (order?.files?.length) {
      const draftFile = order.files.find(f => (f.label || "").toLowerCase() === "draft");
      if (draftFile?.driveFileId) {
        try {
          const fs = require("fs");
          const os = require("os");
          const { downloadDriveFile } = require("../googleDrive");
          const tmpPath = path.join(os.tmpdir(), `draft-${Date.now()}.pdf`);
          await downloadDriveFile(draftFile.driveFileId, tmpPath);
          const draftBuffer = fs.readFileSync(tmpPath);
          fs.unlinkSync(tmpPath);
          attachments.push({
            filename: draftFile.originalName || "Draft.pdf",
            content: draftBuffer.toString("base64"),
            encoding: "base64",
          });
        } catch (draftErr) {
          console.warn("[Invoice Send] Could not attach draft:", draftErr.message);
        }
      }
    }

    // ── 3. Send email ─────────────────────────────────────────────────────────
    const nodemailer = require("nodemailer");
    const mailer = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      family: 4,
      secure: false,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });

    await mailer.sendMail({
      from: `DDG OPS <${process.env.GMAIL_USER}>`,
      to,
      subject: subject || `Invoice ${inv.invoiceNumber}`,
      text: body || "",
      attachments,
    });

    // Mark invoice as sent
    await Invoice.findByIdAndUpdate(req.params.id, { status: "Sent", sentAt: new Date() });

    res.json({ success: true, attachments: attachments.map(a => a.filename) });
  } catch (err) {
    console.error("Invoice send error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;