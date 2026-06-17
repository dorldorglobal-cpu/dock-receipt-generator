const express = require("express");
const router = express.Router();
const multer = require("multer");
const pdfParse = require("pdf-parse");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const Order = require("../models/Order");
const Expense = require("../models/Expense");
const { uploadBufferToDrive } = require("../googleDrive");

const upload = multer({ storage: multer.memoryStorage() });
const TEMP_DIR = path.join(__dirname, "..", "temp");
const SPLIT_PY = path.join(__dirname, "..", "split_pdf.py");

// Split pages from a PDF using Python/PyPDF2 (handles encrypted PDFs correctly)
function splitPdf(inputPath, startPage, endPage, outputPath) {
  return new Promise((resolve, reject) => {
    execFile("python3", [SPLIT_PY, inputPath, String(startPage), String(endPage), outputPath], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(outputPath);
    });
  });
}

// ── Sallaum: 1 page per BL ───────────────────────────────────────────────────
function parseSallaum(pageTexts) {
  return pageTexts.map((text, i) => {
    const bookingMatch = text.match(/SLSE-\d+/);
    const blMatch = text.match(/\bUS\d{8,}\b/);
    const refMatch = text.match(/Reference number\s+(\d+)/i);
    const vinMatch = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);

    let vehicle = "";
    if (vinMatch) {
      const afterVin = text.substring(text.indexOf(vinMatch[0]) + 17);
      const vm = afterVin.match(/\d+\s+(.+?)\s+Model Year[:\s]+(\d{4})/i);
      if (vm) vehicle = vm[1].trim() + " " + vm[2];
    }

    // Vessel: "substitute Liberty Peace (26LE01)" → vessel="Liberty Peace", voyage="26LE01"
    const vesselMatch = text.match(/substitute\s+(.+?)\s+\(([A-Z0-9]{4,})\)/i);
    const vessel  = vesselMatch ? vesselMatch[1].trim() : "";
    const voyage  = vesselMatch ? vesselMatch[2].trim() : "";

    return {
      carrier: "SALLAUM",
      blNumber: blMatch ? blMatch[0] : "",
      bookingNumber: bookingMatch ? bookingMatch[0] : "",
      refNumber: refMatch ? refMatch[1] : "",
      vin: vinMatch ? vinMatch[0] : "",
      vehicle: vehicle.trim(),
      vessel,
      voyage,
      type: "draft",
      charges: null,
      pages: [i, i],
    };
  });
}

// ── ACL: group pages by "Page X of Y" pattern ────────────────────────────────
function parseACL(pageTexts) {
  const bls = [];
  let current = null;

  for (let i = 0; i < pageTexts.length; i++) {
    const text = pageTexts[i];
    const pageMatch = text.match(/Page (\d+) of (\d+)/i);
    if (!pageMatch) continue;

    const pageNum = parseInt(pageMatch[1], 10);

    if (pageNum === 1) {
      if (current) bls.push(current);

      const bookingMatch = text.match(/S329\d+/);
      const booking = bookingMatch ? bookingMatch[0] : "";

      // On data pages: "GRANDE VESSEL RefNo"; on 1-page BLs: "BookingNo RefNo BookingNo"
      const refMatch =
        text.match(/GRANDE\s+\S+\s+(\d{4,6})/i) ||
        text.match(/S329\d+\s+(\d{4,6})\s+S329\d+/i);
      const ref = refMatch ? refMatch[1] : "";

      const vinMatch = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
      const vin = vinMatch ? vinMatch[0] : "";

      let vehicle = "";
      if (vin) {
        const afterVin = text.substring(text.indexOf(vin) + 17);
        const vm = afterVin.match(/([A-Z][A-Z0-9 ]+?)\s+Model Year\s+(\d{4})/i);
        if (vm) vehicle = vm[1].trim() + " " + vm[2];
      }

      const chargeMatch = text.match(/TOTAL CHARGES PAYABLE AT ORIGIN IN USD\s+([\d,]+\.?\d*)/i);
      const charges = chargeMatch ? parseFloat(chargeMatch[1].replace(/,/g, "")) : null;

      // Voyage: "GSI0526" (3 letters + 4 digits); vessel: "GRANDE SICILIA"
      const voyageCodeMatch = text.match(/\b([A-Z]{3}\d{4})\b/);
      const grandeMatch = text.match(/GRANDE\s+(\S+)/i);
      const voyage = voyageCodeMatch ? voyageCodeMatch[1] : "";
      const vessel = grandeMatch ? ("GRANDE " + grandeMatch[1]).toUpperCase() : "";

      current = {
        carrier: "ACL",
        blNumber: booking,
        bookingNumber: booking,
        refNumber: ref,
        vin,
        vehicle: vehicle.trim(),
        vessel,
        voyage,
        type: charges != null ? "rated" : "draft",
        charges,
        pages: [i, i],
      };
    } else {
      if (current) {
        current.pages[1] = i;
        // Ref# and vessel/voyage may appear on the data page (page 2 of 2)
        if (!current.refNumber) {
          const refMatch = text.match(/GRANDE\s+\S+\s+(\d{4,6})/i);
          if (refMatch) current.refNumber = refMatch[1];
        }
        if (!current.vessel) {
          const vc = text.match(/\b([A-Z]{3}\d{4})\b/);
          const gm = text.match(/GRANDE\s+(\S+)/i);
          if (vc) current.voyage = vc[1];
          if (gm) current.vessel = ("GRANDE " + gm[1]).toUpperCase();
        }
        const chargeMatch = text.match(/TOTAL CHARGES PAYABLE AT ORIGIN IN USD\s+([\d,]+\.?\d*)/i);
        if (chargeMatch) {
          current.type = "rated";
          current.charges = parseFloat(chargeMatch[1].replace(/,/g, ""));
        }
      }
    }
  }

  if (current) bls.push(current);
  return bls;
}

// ── POST /api/bl-separator/parse ──────────────────────────────────────────────
router.post("/parse", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    const buffer = req.file.buffer;
    const pageTexts = [];

    await pdfParse(buffer, {
      pagerender: (pd) =>
        pd.getTextContent().then((tc) => {
          const t = tc.items.map((i) => i.str).join(" ");
          pageTexts.push(t);
          return t;
        }),
    });

    const allText = pageTexts.join(" ");
    const isSallaum = /Sallaum|SLSE-/i.test(allText);
    const isACL = /Grimaldi|S329\d/i.test(allText);

    if (!isSallaum && !isACL) {
      return res.status(400).json({ error: "Could not detect carrier (Sallaum or ACL/Grimaldi)" });
    }

    const bls = isSallaum ? parseSallaum(pageTexts) : parseACL(pageTexts);

    // Match ref numbers to orders
    const refNumbers = [...new Set(bls.map((b) => b.refNumber).filter(Boolean))];
    const orders = await Order.find({ refNumber: { $in: refNumbers } })
      .select("_id refNumber customerName vin year make model driveFolderId")
      .lean();
    const orderByRef = {};
    orders.forEach((o) => {
      orderByRef[o.refNumber] = o;
    });

    bls.forEach((bl) => {
      const order = orderByRef[bl.refNumber];
      if (order) {
        bl.orderId = String(order._id);
        bl.orderCustomer = order.customerName;
        bl.orderVin = order.vin;
        bl.orderHasDrive = !!order.driveFolderId;
      }
    });

    // Store PDF in temp for the attach call
    const sessionId = crypto.randomUUID();
    fs.writeFileSync(path.join(TEMP_DIR, `bl-${sessionId}.pdf`), buffer);

    res.json({ carrier: isSallaum ? "SALLAUM" : "ACL", bls, sessionId });
  } catch (err) {
    console.error("BL parse error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bl-separator/attach ─────────────────────────────────────────────
// Splits individual BL PDFs and uploads them to each order's Drive folder.
// Body: { sessionId, bls: [{ pages:[start,end], orderId, blNumber, refNumber, type, vin, vehicle, charges, createExpense }] }
router.post("/attach", async (req, res) => {
  try {
    const { sessionId, bls } = req.body;
    if (!sessionId || !Array.isArray(bls)) {
      return res.status(400).json({ error: "Missing sessionId or bls" });
    }

    const tempPath = path.join(TEMP_DIR, `bl-${sessionId}.pdf`);
    if (!fs.existsSync(tempPath)) {
      return res.status(400).json({ error: "Session expired — please re-upload the PDF" });
    }

    const results = [];

    for (const bl of bls) {
      try {
        const order = await Order.findById(bl.orderId);
        if (!order) {
          results.push({ blNumber: bl.blNumber, refNumber: bl.refNumber, error: "Order not found" });
          continue;
        }

        if (!order.driveFolderId) {
          results.push({ blNumber: bl.blNumber, refNumber: bl.refNumber, error: "Order has no Drive folder" });
          continue;
        }

        // Extract pages for this BL using Python (handles encrypted PDFs)
        const [startPage, endPage] = bl.pages;
        const splitPath = path.join(TEMP_DIR, `bl-split-${crypto.randomUUID()}.pdf`);
        await splitPdf(tempPath, startPage, endPage, splitPath);
        const blBytes = fs.readFileSync(splitPath);
        try { fs.unlinkSync(splitPath); } catch {}

        // Build filename: BL_[blNumber]_[type].pdf
        const typeLabel = bl.type === "rated" ? "Rated" : "Draft";
        const fileName = `BL_${bl.blNumber || bl.refNumber}_${typeLabel}.pdf`;
        const docLabel = bl.type === "rated" ? "Rated Draft" : "Draft";

        const uploaded = await uploadBufferToDrive(
          blBytes,
          fileName,
          "application/pdf",
          order.driveFolderId
        );

        order.files.push({
          label: docLabel,
          originalName: fileName,
          filename: uploaded.name,
          driveFileId: uploaded.id,
          path: uploaded.webViewLink,
          mimetype: "application/pdf",
        });

        // Update vessel/voyage from BL if not already set
        if (bl.vessel && !order.vessel) order.vessel  = bl.vessel;
        if (bl.voyage && !order.voyage) order.voyage  = bl.voyage;
        if (bl.vessel) order.vessel = bl.vessel;
        if (bl.voyage) order.voyage = bl.voyage;

        // Auto-update status to Sailed on Draft upload (same logic as manual file upload)
        const SAILED_STATUSES = ["New Order","Awaiting Pickup","Picked Up","Delivered","Waiting to Sail"];
        if (bl.type === "draft" && SAILED_STATUSES.includes(order.status)) {
          const prev = order.status;
          order.status = "Sailed";
          order.timeline.push({
            action: "Status Changed",
            details: `Auto-updated from "${prev}" to "Sailed" on Draft BL upload.`,
            createdAt: new Date(),
          });
        }

        order.timeline.push({
          action: "BL Attached",
          details: `${docLabel} uploaded: ${fileName}`,
          createdAt: new Date(),
        });

        let expenseId = null;
        if (bl.type === "rated" && bl.createExpense && bl.charges) {
          const expense = await Expense.create({
            category: "Ocean Freight",
            description: `ACL Ocean Freight - BL ${bl.blNumber} (${bl.vehicle || bl.vin || ""})`,
            vendor: "ACL / Grimaldi",
            amount: bl.charges,
            date: new Date(),
            orderId: order._id,
            orderRef: order.refNumber,
            vin: bl.vin || order.vin || "",
            status: "unpaid",
          });
          expenseId = String(expense._id);
        }

        await order.save();

        results.push({
          blNumber: bl.blNumber,
          refNumber: bl.refNumber,
          success: true,
          driveLink: uploaded.webViewLink,
          expenseId,
        });
      } catch (err) {
        results.push({ blNumber: bl.blNumber, refNumber: bl.refNumber, error: err.message });
      }
    }

    // Clean up temp file
    try { fs.unlinkSync(tempPath); } catch {}

    res.json({ results });
  } catch (err) {
    console.error("BL attach error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bl-separator/download-bl ───────────────────────────────────────
// Returns a single BL's pages as a PDF stream.
// Body: { sessionId, pages: [start, end], filename }
router.post("/download-bl", async (req, res) => {
  try {
    const { sessionId, pages, filename } = req.body;
    const tempPath = path.join(TEMP_DIR, `bl-${sessionId}.pdf`);
    if (!fs.existsSync(tempPath)) {
      return res.status(400).json({ error: "Session expired — please re-upload the PDF" });
    }

    const [startPage, endPage] = pages;
    const splitPath = path.join(TEMP_DIR, `bl-dl-${crypto.randomUUID()}.pdf`);
    await splitPdf(tempPath, startPage, endPage, splitPath);
    const blBytes = fs.readFileSync(splitPath);
    try { fs.unlinkSync(splitPath); } catch {}

    const safeName = (filename || "BL.pdf").replace(/[^a-zA-Z0-9._\- ]/g, "_");
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${safeName}"`);
    res.send(blBytes);
  } catch (err) {
    console.error("BL download error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
