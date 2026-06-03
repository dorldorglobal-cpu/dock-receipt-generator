const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const pdfParse = require("pdf-parse");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const { PDFDocument: PDFLibDocument, StandardFonts, rgb } = require("pdf-lib");
const nodemailer = require("nodemailer");
const pricingRoutes = require("./routes/pricing");
const scheduleRoutes = require("./routes/scheduleRoutes");
const ScheduleRow = require("./models/Schedule");

require("dotenv").config();

const orderRoutes = require("./routes/orders");
const addressBookRoutes = require("./routes/addressBook");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ── Health check (used by keep-alive self-ping) ──
app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/pricing", pricingRoutes);
app.use("/api/schedule", scheduleRoutes);

// API ROUTES
app.use("/api/orders", orderRoutes);
app.use("/api/address-book", addressBookRoutes);
app.use("/api/customers", require("./routes/customers"));
app.use("/api/reports",   require("./routes/reports"));
// ── Parse dispatch PDF from order docs (must be before the expenses router) ──
app.post("/api/expenses/parse-dispatch-url", async (req, res) => {
  try {
    const { url, filename, orderRef, orderId } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });

    let buffer;
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1") {
      // Local file
      const baseUploads = path.join(__dirname, "uploads");
      const parts = parsedUrl.pathname.replace(/^\/uploads\//, "").split("/").map(decodeURIComponent);
      const filePath = path.join(baseUploads, ...parts);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found: " + filePath });
      buffer = fs.readFileSync(filePath);
    } else {
      // Google Drive file — extract fileId from URL
      const driveMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (!driveMatch) return res.status(400).json({ error: "Could not parse Drive file ID from URL" });
      const fileId = driveMatch[1];
      const { downloadDriveFile } = require("./googleDrive");
      const tmpPath = path.join(__dirname, "uploads/receipts", `tmp-${Date.now()}.pdf`);
      if (!fs.existsSync(path.join(__dirname, "uploads/receipts"))) fs.mkdirSync(path.join(__dirname, "uploads/receipts"), { recursive: true });
      await downloadDriveFile(fileId, tmpPath);
      buffer = fs.readFileSync(tmpPath);
      fs.unlinkSync(tmpPath);
    }
    const data = await pdfParse(buffer);
    const text = data.text;

    // Use Groq/Llama for reliable field extraction instead of brittle regex
    const Groq = require("groq-sdk");
    const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const aiResp = await groqClient.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are a logistics document parser. Return ONLY a JSON object with these keys (empty string if not found, 0 for total): vin, ymm, total, loadId, dispatchDate, origin, carrier" },
        { role: "user", content: `Extract from this dispatch document:\n\n${text.slice(0, 6000)}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    const aiResult = JSON.parse(aiResp.choices[0].message.content);
    const vin = aiResult.vin || "";
    const ymm = aiResult.ymm || "";
    const total = parseFloat(aiResult.total) || 0;
    const loadId = aiResult.loadId || "";
    const dispatchDate = aiResult.dispatchDate || "";
    const origin = aiResult.origin || "";
    const carrier = aiResult.carrier || "";
    // Upload dispatch PDF to Google Drive instead of local disk
    const { uploadBufferToDrive, getOrCreateFolder } = require("./googleDrive");
    let billFileName = "", billDriveId = "", billDriveUrl = "";
    try {
      const folderId = await getOrCreateFolder("DDG Expenses", "root");
      const savedName = `${Date.now()}-dispatch.pdf`;
      const driveFile = await uploadBufferToDrive(buffer, savedName, "application/pdf", folderId);
      billFileName = driveFile.name;
      billDriveId  = driveFile.id;
      billDriveUrl = driveFile.webViewLink;
    } catch (e) { console.warn("Drive upload failed:", e.message); }

    const Order = require("./models/Order");
    let matchedOrder = null;
    if (orderId) matchedOrder = await Order.findById(orderId).select("refNumber _id").lean().catch(() => null);
    const row = { vin, ymm, total, loadId, dispatchDate, origin, carrier,
      vendor: carrier,
      billFileName, billDriveId, billDriveUrl, billMime: "application/pdf",
      orderId: matchedOrder?._id || orderId || null,
      orderRef: matchedOrder?.refNumber || orderRef || "",
      matched: !!(matchedOrder || orderId),
      notes: loadId ? `Load ID: ${loadId}` : "" };
    res.json([row]);
  } catch (err) {
    console.error("parse-dispatch-url error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.use("/api/expenses", require("./routes/expenses"));
app.use("/api/vendors",  require("./routes/vendors"));
app.use("/api/invoices", require("./routes/invoices"));
app.use("/api/claude",   require("./routes/claude"));

// ── POST /api/customer-statement  — generate a customer statement PDF ─────────
app.post("/api/customer-statement", async (req, res) => {
  try {
    const { customerName } = req.body;
    if (!customerName) return res.status(400).json({ error: "customerName required" });

    const Order = require("./models/Order");
    const orders = await Order.find({
      customerName: { $regex: `^${customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" }
    }).sort({ createdAt: -1 }).lean();

    const { PDFDocument: PDFLib, StandardFonts, rgb } = require("pdf-lib");
    const pdfDoc = await PDFLib.create();
    const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const W = 612, H = 792;
    const margin = 48;
    let page = pdfDoc.addPage([W, H]);
    let y = H - margin;

    // pdf-lib standard fonts only support WinAnsi — strip anything outside that range
    const safe  = (txt) => String(txt).replace(/[^\x00-\xFF]/g, "?");
    const line  = (txt, x, yy, size, font, color) =>
      page.drawText(safe(txt), { x, y: yy, size, font: font || fontR, color: color || rgb(0.1,0.1,0.1) });
    const rule  = (yy, thick) =>
      page.drawLine({ start:{x:margin,y:yy}, end:{x:W-margin,y:yy}, thickness: thick||0.5, color: rgb(0.7,0.7,0.7) });
    const newPageIfNeeded = (needed) => {
      if (y - needed < margin) {
        page = pdfDoc.addPage([W, H]);
        y = H - margin;
        return true;
      }
      return false;
    };

    // ── Header ────────────────────────────────────────────────────────────────
    line("DDG GLOBAL LOGISTICS", margin, y, 18, fontB, rgb(0.08,0.38,0.72));
    y -= 22;
    line("CUSTOMER STATEMENT", margin, y, 13, fontR, rgb(0.4,0.4,0.4));
    y -= 14;
    line(`Generated: ${new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}`, margin, y, 10, fontR, rgb(0.5,0.5,0.5));
    y -= 24;
    rule(y, 1.5);
    y -= 18;

    // ── Customer ──────────────────────────────────────────────────────────────
    line("CUSTOMER", margin, y, 9, fontB, rgb(0.4,0.4,0.4));
    y -= 14;
    line(customerName, margin, y, 14, fontB);
    y -= 30;

    // ── Summary totals ────────────────────────────────────────────────────────
    const fmt = (n) => `$${Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const orderTotal = (o) => Object.values(o.charges || {}).reduce((s, v) => s + Number(v || 0), 0);

    const totalBilled = orders.reduce((s, o) => s + orderTotal(o), 0);
    const totalPaid   = orders.filter(o => o.status === "Completed").reduce((s, o) => s + orderTotal(o), 0);
    const stillOwed   = totalBilled - totalPaid;

    // Four summary boxes across the page
    const boxW = 120, boxH = 36, boxY = y - boxH;
    const boxes = [
      { label: "Total Orders",  value: String(orders.length),  col: margin },
      { label: "Total Billed",  value: fmt(totalBilled),        col: margin + 130 },
      { label: "Total Paid",    value: fmt(totalPaid),          col: margin + 280 },
      { label: "Still Owed",    value: fmt(stillOwed),          col: margin + 420 },
    ];
    boxes.forEach(b => {
      page.drawRectangle({ x: b.col, y: boxY, width: boxW, height: boxH,
        borderColor: rgb(0.8,0.8,0.8), borderWidth: 0.5, color: rgb(0.96,0.97,0.99) });
      line(b.label, b.col + 6, boxY + boxH - 11, 7, fontR, rgb(0.45,0.45,0.45));
      const valColor = b.label === "Still Owed" && stillOwed > 0 ? rgb(0.85,0.2,0.2)
                     : b.label === "Total Paid"  && totalPaid > 0 ? rgb(0.1,0.6,0.3)
                     : rgb(0.08,0.15,0.35);
      line(b.value, b.col + 6, boxY + 7, 10, fontB, valColor);
    });
    y = boxY - 18;
    rule(y);
    y -= 16;

    // ── Column headers ────────────────────────────────────────────────────────
    // cols: Ref | Vehicle + VIN | Route | Status | Age | Total
    const cols = [48, 100, 255, 355, 450, 495];
    const hdr  = ["Ref", "Vehicle / VIN", "Route", "Status", "Age", "Total"];
    hdr.forEach((h, i) => line(h, cols[i], y, 9, fontB, rgb(0.4,0.4,0.4)));
    y -= 6;
    rule(y, 0.5);
    y -= 16;

    // ── Rows ──────────────────────────────────────────────────────────────────
    for (const o of orders) {
      newPageIfNeeded(18);
      const ymm      = [o.year, o.make, o.model].filter(Boolean).join(" ").slice(0, 18) || "-";
      const vin6     = o.vin ? `  ...${o.vin.slice(-6).toUpperCase()}` : "";
      const vehicle  = safe(`${ymm}${vin6}`).slice(0, 28);
      const pol      = safe((o.pol || "?").slice(0, 9));
      const pod      = safe((o.pod || "?").slice(0, 9));
      const route    = `${pol} > ${pod}`;
      const rowAmt   = orderTotal(o);
      const ageDays  = Math.floor((Date.now() - new Date(o.createdAt)) / 86400000);
      const ageLabel = ageDays === 0 ? "Today" : `${ageDays}d`;
      const ageClr   = ageDays <= 30 ? rgb(0.15,0.7,0.4) : ageDays <= 60 ? rgb(0.9,0.55,0.1) : rgb(0.85,0.2,0.2);

      line(safe(o.refNumber || "-"),   cols[0], y, 10, fontR, rgb(0.08,0.38,0.72));
      line(vehicle,                    cols[1], y, 8.5, fontR);
      line(route,                      cols[2], y, 9,  fontR);
      line(safe(o.status || "-"),      cols[3], y, 9,  fontR, rgb(0.3,0.3,0.3));
      line(ageLabel,                   cols[4], y, 9,  fontR, ageClr);
      line(rowAmt ? fmt(rowAmt) : "-", cols[5], y, 9,  fontB);

      y -= 18;
      if (y < margin + 30) {
        page = pdfDoc.addPage([W, H]);
        y = H - margin;
      }
    }

    y -= 8;
    rule(y);
    y -= 14;
    line("DDG Global Logistics  |  This statement is for reference only.",
      margin, y, 8, fontR, rgb(0.55,0.55,0.55));

    const pdfBytes = await pdfDoc.save();
    const safeName = customerName.replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "-");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Statement-${safeName}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Statement error:", err);
    res.status(500).json({ error: "Failed to generate statement" });
  }
});

app.get("/api/address-book-test", (req, res) => {
  res.json({ success: true, message: "Address book test works" });
});

app.get("/", (req, res) => {
  res.send("DDG OPS Backend Running");
});

// ================= EXISTING DR GENERATOR / SCHEDULE SETUP =================

const schedulesDir = path.join(__dirname, "saved-schedules");
const masterSchedulePath = path.join(schedulesDir, "master-schedule.xlsx");

const shipmentSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const Shipment = mongoose.model("Shipment", shipmentSchema);

if (!fs.existsSync(schedulesDir)) fs.mkdirSync(schedulesDir);

// ── Local uploads directory (replaces Google Drive file storage) ──────────────
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use("/uploads", express.static(uploadsDir));

// ================= HELPERS =================

function clean(v) {
  return (v || "").toString().replace(/\s+/g, " ").trim();
}

function cleanUpper(v) {
  return clean(v).toUpperCase();
}

function formatExcelDate(value) {
  if (!value) return "";

  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) return value.toString();
    return `${d.m}/${d.d}/${d.y}`;
  }

  return clean(value);
}

function normalizePort(v) {
  const u = cleanUpper(v);

  if (u.includes("BALTIMORE")) return "BALTIMORE";
  if (u.includes("TRADEPOINT")) return "BALTIMORE";
  if (u.includes("SOUTH LOCUST")) return "BALTIMORE";
  if (u.includes("JACKSONVILLE") || u.includes("JAX")) return "JACKSONVILLE";
  if (u.includes("FREEPORT")) return "FREEPORT";
  if (u.includes("WILMINGTON")) return "WILMINGTON";
  if (u.includes("PROVIDENCE") || u.includes("DAVISVILLE")) return "PROVIDENCE";

  if (u.includes("LAGOS")) return "LAGOS";
  if (u.includes("TEMA")) return "TEMA";
  if (u.includes("COTONOU")) return "COTONOU";
  if (u.includes("LOME")) return "LOME";

  return u;
}

function countryFromPod(pod) {
  const p = normalizePort(pod);
  if (p === "LAGOS") return "NIGERIA";
  if (p === "TEMA") return "GHANA";
  if (p === "COTONOU") return "BENIN";
  if (p === "LOME") return "TOGO";
  return "";
}

function lineAfter(lines, label) {
  const i = lines.findIndex((l) => cleanUpper(l).includes(cleanUpper(label)));
  return i !== -1 ? clean(lines[i + 1]) : "";
}

function parseAddressParts(t) {
  const p = clean(t).split(",").map(clean).filter(Boolean);

  let address = p[0] || "";
  let city = "";
  let state = "";
  let zip = "";

  if (p[1] && /^(STE|SUITE|UNIT|APT|#)/i.test(p[1])) {
    address = `${p[0]} ${p[1]}`;
    city = p[2] || "";
    state = (p[3] || "").split(" ")[0] || "";
    zip = (p[3] || "").split(" ")[1] || "";
  } else {
    city = p[1] || "";
    state = (p[2] || "").split(" ")[0] || "";
    zip = (p[2] || "").split(" ")[1] || "";
  }

  return {
    address: cleanUpper(address.replace(/,\s*US$/i, "")),
    city: cleanUpper(city),
    state: cleanUpper(state),
    zip,
  };
}

function findVin(text) {
  const upper = text.toUpperCase();

  const afterWeight = upper.match(/\b\d{3,5}\s+([A-HJ-NPR-Z0-9]{17})\b/);
  if (afterWeight) return afterWeight[1];

  const normalMatch = upper.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  if (normalMatch) return normalMatch[0];

  return "";
}

function extractVehicleDataFromAes(text) {
  const raw = text.toUpperCase();
  const compact = raw.replace(/\s+/g, " ");

  const vin = findVin(compact);
  let weightKgs = "";
  let value = "";

  const verifyWeight = compact.match(/\b1\s+NO\s+(\d{3,6})\s+VERIFY:/i);
  if (verifyWeight) {
    weightKgs = verifyWeight[1];
  }

  if (!weightKgs) {
    const commodityStart = compact.indexOf("20. SCH B/HTS DESCRIPTION");
    const verifyIndex = compact.indexOf("VERIFY:");

    if (commodityStart !== -1 && verifyIndex !== -1 && verifyIndex > commodityStart) {
      const beforeVerify = compact.slice(commodityStart, verifyIndex);
      const nums = beforeVerify.match(/\b\d{3,6}\b/g) || [];
      if (nums.length) weightKgs = nums[nums.length - 1];
    }
  }

  if (vin) {
    const vinIndex = compact.indexOf(vin);

    if (vinIndex !== -1) {
      const afterVin = compact.slice(vinIndex + vin.length, vinIndex + vin.length + 200);

      const stateValueMatch = afterVin.match(/\/\s*[A-Z]{2}\s+(\d{3,8})\b/);
      if (stateValueMatch) {
        value = stateValueMatch[1];
      } else {
        const nums = afterVin.match(/\b\d{3,8}\b/g) || [];
        value = nums.length ? nums[nums.length - 1] : "";
      }
    }
  }

  return { vin, weightKgs, value };
}

async function saveShipment(data) {
  const referenceNumber = clean(data.referenceNumber);
  const vin = cleanUpper(data.vin);

  if (!referenceNumber && !vin) return;

  const filter = referenceNumber ? { referenceNumber } : { vin };

  await Shipment.findOneAndUpdate(
    filter,
    {
      $set: {
        ...data,
        referenceNumber,
        vin,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
    }
  );
}

// ================= AES PARSER =================

function parseAes(text) {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);

  const bookingNumber =
    clean(text.match(/S3[-\s]?\d+/i)?.[0] || "") ||
    lineAfter(lines, "3. TRANSPORTATION REFERENCE NO.");

  const referenceNumber = lineAfter(lines, "14. SHIPMENT REFERENCE NO.");

  const exporterName = lineAfter(lines, "1a. U.S. PRINCIPAL PARTY");
  const exporterAddressLine = lineAfter(lines, exporterName);
  const exporter = parseAddressParts(exporterAddressLine);

  const consigneeName = lineAfter(lines, "4a. ULTIMATE CONSIGNEE");

  const consigneeIndex = lines.findIndex(
    (l) => cleanUpper(l) === cleanUpper(consigneeName)
  );

  const consigneeLine1 = consigneeIndex !== -1 ? lines[consigneeIndex + 1] || "" : "";
  const consigneeLine2 = consigneeIndex !== -1 ? lines[consigneeIndex + 2] || "" : "";

  let combined = `${consigneeLine1} ${consigneeLine2}`.trim();

  combined = combined
    .replace(/ULTIMATE CONSIGNEE TYPE:.*$/i, "")
    .replace(/\s+[A-Z]{2}\s*$/i, ", $&")
    .trim();

  const consigneeParts = combined.split(",").map(clean).filter(Boolean);

  let consigneeAddress = "";
  let consigneeCity = "";

  if (consigneeParts.length >= 2) {
    const lastPart = consigneeParts[consigneeParts.length - 1];

    if (/^[A-Z]{2}$/.test(lastPart)) {
      consigneeCity = consigneeParts[consigneeParts.length - 2];
      consigneeAddress = consigneeParts.slice(0, -2).join(", ");
    } else {
      consigneeCity = lastPart;
      consigneeAddress = consigneeParts.slice(0, -1).join(", ");
    }
  } else {
    consigneeAddress = combined;
  }

  const vessel = lineAfter(lines, "9. EXPORTING CARRIER");

  const polRaw = lineAfter(lines, "10. PORT OF EXPORT");
  const pol = normalizePort(polRaw);

  const podIndex = lines.findIndex((l) => cleanUpper(l).includes("11. PORT OF UNLADING"));
  let podRaw = podIndex !== -1 ? `${lines[podIndex + 1] || ""} ${lines[podIndex + 2] || ""}` : "";
  const pod = normalizePort(podRaw);

  const commodity = lines.join(" ");
  const vehicleMatch = commodity.match(/\b\d{4}\s+[A-Z]{2,}[A-Z0-9 \-]+?(?=\s+EXPORT INFO CODE)/i);
  const vehicleYearMakeModel = cleanUpper((vehicleMatch?.[0] || "").replace("EXPORT INFO CODE", ""));

  const vehicleData = extractVehicleDataFromAes(text);

  const aesWeightMatch = text.toUpperCase().match(/1\s+NO\s+(\d{3,6})\s+VERIFY:/);
  const aesWeightKgs = aesWeightMatch ? aesWeightMatch[1] : "";

  return {
    bookingNumber: clean(bookingNumber),
    referenceNumber: clean(referenceNumber),

    exporterName: cleanUpper(exporterName),
    exporterAddress: exporter.address,
    exporterCity: exporter.city,
    exporterState: exporter.state,
    exporterZip: exporter.zip,
    exporterCountry: "UNITED STATES",

    consigneeName: cleanUpper(consigneeName),
    consigneeAddress: cleanUpper(consigneeAddress),
    consigneeCity: cleanUpper(consigneeCity),
    consigneeCountry: countryFromPod(pod),

    vehicleType: "RORO",
    weightKgs: aesWeightKgs || vehicleData.weightKgs,
    vehicleYearMakeModel,
    vin: vehicleData.vin,
    value:
      vehicleData.value ||
      clean(text.match(/\/\s*[A-Z]{2}\s+(\d{3,8})\s*(?:Sensitive Information|Do not submit|$)/i)?.[1] || ""),

    aesItn: clean(text.match(/X\d{14}/i)?.[0] || ""),
    portOfLoading: pol,
    portOfDischarge: pod,
    vessel: cleanUpper(vessel),
  };
}

// ================= DISPATCH PARSER =================

function parseDispatch(text) {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);

  const originIndex = lines.findIndex((l) => cleanUpper(l) === "ORIGIN");
  const destinationIndex = lines.findIndex((l) => cleanUpper(l) === "DESTINATION");

  let pickup = {};
  let delivery = {};

  const dispatchVin = cleanUpper(text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0] || "");

  const lbsMatch = text.match(/Max Weight\s*([\d,]+)\s*lbs/i) || text.match(/([\d,]+)\s*lbs/i);
  const dispatchWeightKgs = lbsMatch
    ? Math.round(parseInt(lbsMatch[1].replace(/,/g, ""), 10) * 0.453592).toString()
    : "";

  if (originIndex !== -1) {
    const block = lines.slice(originIndex + 1, originIndex + 15);

    const cityStateLine = block.find((l) => /,\s*[A-Z]{2}\s*-?/i.test(l)) || "";
    const auctionLine = block.find((l) => /COPART|IAAI/i.test(l)) || "";

    const cleanCityState = cityStateLine.replace(/\s*-\s*.*$/i, "");
    const city = clean(cleanCityState.split(",")[0]);
    const state = clean((cleanCityState.split(",")[1] || "").replace("-", ""));

    const auction = auctionLine.match(/COPART|IAAI/i)?.[0]?.toUpperCase() || "";
    const extraName = auctionLine.replace(/COPART|IAAI/i, "").trim();

    const addressLine =
      block.find((l) =>
        /\d+/.test(l) &&
        !/\(\d{3}\)/.test(l) &&
        !/,\s*[A-Z]{2}\s+\d{5}/i.test(l) &&
        !cleanUpper(l).includes("CONTACT")
      ) || "";

    const cityZipLine = block.find((l) => /,\s*[A-Z]{2}\s+\d{5}/i.test(l)) || "";
    const zip = cityZipLine.match(/\b\d{5}\b/)?.[0] || "";

    pickup = {
      pickupName: cleanUpper(`${auction} ${city} ${state} ${extraName}`),
      pickupAddress: cleanUpper(addressLine),
      pickupCity: cleanUpper(city),
      pickupState: cleanUpper(state),
      pickupZip: zip,
    };
  }

  if (destinationIndex !== -1) {
    const block = lines.slice(destinationIndex + 1, destinationIndex + 15);

    const nameLines = [];
    if (block[0]) nameLines.push(block[0]);
    if (block[1] && !/\d/.test(block[1]) && !/CONTACT/i.test(block[1]) && !/,\s*[A-Z]{2}/i.test(block[1])) {
      nameLines.push(block[1]);
    }

    const addressLine =
      block.find((l) =>
        /\d+/.test(l) &&
        !/\(\d{3}\)/.test(l) &&
        !/,\s*[A-Z]{2}\s+\d{5}/i.test(l) &&
        !/^\d{5}$/.test(l) &&
        !cleanUpper(l).includes("CONTACT")
      ) || "";

    const cityStateZipLine = block.find((l) => /,\s*[A-Z]{2}(\s+\d{5})?$/i.test(l)) || "";
    const cityMatch = cityStateZipLine.match(/^(.*),\s*([A-Z]{2})(?:\s+(\d{5}))?$/i);

    let zip = cityMatch?.[3] || "";
    if (!zip) {
      const zipLine = block.find((l) => /^\d{5}$/.test(l) || /\b\d{5}\b/.test(l)) || "";
      zip = zipLine.match(/\b\d{5}\b/)?.[0] || "";
    }

    delivery = {
      deliveryName: cleanUpper(nameLines.join(" ")),
      deliveryAddress: cleanUpper(addressLine),
      deliveryCity: cleanUpper(cityMatch?.[1] || ""),
      deliveryState: cleanUpper(cityMatch?.[2] || ""),
      deliveryZip: zip,
    };
  }

  return {
    ...pickup,
    ...delivery,
    dispatchVin,
    dispatchWeightKgs,
  };
}

// ================= SCHEDULE =================

function readScheduleExcel(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  let rows = [];

  wb.SheetNames.forEach((name) => {
    rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[name]));
  });

  return rows;
}

function getSavedScheduleRows() {
  if (!fs.existsSync(masterSchedulePath)) return [];
  return readScheduleExcel(fs.readFileSync(masterSchedulePath));
}

function getCell(row, names) {
  for (const name of names) {
    if (row[name] !== undefined) return row[name];
  }
  return "";
}

function findScheduleMatch(rows, vessel, pol, pod) {
  const v = cleanUpper(vessel).split(" V:")[0].trim();
  const p1 = normalizePort(pol);
  const p2 = normalizePort(pod);

  return rows.find((r) => {
    const rv = cleanUpper(getCell(r, ["Vessel", "Vessel Name"]));
    const rpol = normalizePort(getCell(r, ["POL", "Port Of Loading", "Port of Loading"]));
    const rpod = normalizePort(getCell(r, ["POD", "Port Of Discharge", "Port of Discharge"]));

    return rv.includes(v) && rpol === p1 && rpod === p2;
  });
}

// ================= ROUTES =================

app.get("/schedule-status", (req, res) => {
  try {
    if (!fs.existsSync(masterSchedulePath)) {
      return res.json({
        saved: false,
      });
    }

    const stats = fs.statSync(masterSchedulePath);

    const workbook = XLSX.readFile(masterSchedulePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    res.json({
      saved: true,
      fileName: path.basename(masterSchedulePath),
      updatedAt: stats.mtime,
      rows: rows.length,
    });
  } catch (err) {
    console.error(err);

    res.json({
      saved: false,
    });
  }
});   

app.post("/save-schedule", upload.single("schedule"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No schedule uploaded" });

    fs.writeFileSync(masterSchedulePath, req.file.buffer);
    const rows = readScheduleExcel(req.file.buffer);

    res.json({
      message: "Vessel schedule saved successfully",
      rows: rows.length,
    });
  } catch (err) {
    console.error("SAVE SCHEDULE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/upload", upload.any(), async (req, res) => {
  try {
    const aesFile = req.files.find((f) => f.fieldname === "aes");
    const dispatchFile = req.files.find((f) => f.fieldname === "dispatch");

    if (!aesFile) return res.status(400).json({ error: "No AES file uploaded" });

    const aesText = (await pdfParse(aesFile.buffer)).text;
    const dispatchText = dispatchFile ? (await pdfParse(dispatchFile.buffer)).text : "";

    const aesData = parseAes(aesText);
    const dispatchData = dispatchText ? parseDispatch(dispatchText) : {};

    const forcedAesWeightMatch = aesText
      .toUpperCase()
      .replace(/\s+/g, " ")
      .match(/\b1\s+NO\s+(\d{3,6})\s+VERIFY:/);

    const forcedAesWeightKgs = forcedAesWeightMatch ? forcedAesWeightMatch[1] : "";

    // Look up schedule from master-schedule.xlsx (single source of truth)
    let match = null;
    let scheduleRows = getSavedScheduleRows();
    const excelMatch = findScheduleMatch(scheduleRows, aesData.vessel, aesData.portOfLoading, aesData.portOfDischarge);
    if (excelMatch) match = excelMatch;

    // Fall back to DB schedule rows if not found in Excel
    if (!match) {
      const vUpper = cleanUpper(aesData.vessel).split(" V:")[0].trim();
      const polNorm = normalizePort(aesData.portOfLoading);
      const podNorm = normalizePort(aesData.portOfDischarge);
      const vClean = vUpper.replace(/^(M\/V|MV|SS|MS)\s+/i, "").split(" V:")[0].trim();
      const vesselWords = vClean.split(/\s+/).filter(w => w.length > 3);
      const vesselSearchWord = vesselWords[vesselWords.length - 1] || vClean;
      let dbMatch = await ScheduleRow.findOne({
        vessel: { $regex: `^${vClean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        pol: polNorm, pod: podNorm,
      });
      if (!dbMatch) {
        dbMatch = await ScheduleRow.findOne({
          vessel: { $regex: vesselSearchWord, $options: "i" },
          pol: polNorm, pod: podNorm,
        });
      }
      if (dbMatch) {
        match = {
          Voyage: dbMatch.voyage,
          "Port Cutoff": dbMatch.cutoffDate,
          "Sail Date": dbMatch.sailDate,
          "Arrival Date": dbMatch.arrivalDate,
        };
      }
    }

    let polDisplay = aesData.portOfLoading;

    if (
      aesData.bookingNumber.startsWith("SLSE") &&
      normalizePort(aesData.portOfLoading) === "PROVIDENCE"
    ) {
      polDisplay = "DAVISVILLE";
    }

    // Determine shipping line from booking number prefix
    const bookingUpper = cleanUpper(aesData.bookingNumber);
    let shippingLine = "";
    if (bookingUpper.startsWith("SLSE") || bookingUpper.startsWith("SLS")) {
      shippingLine = "SALLAUM LINES";
    } else if (bookingUpper.startsWith("ACL") || bookingUpper.startsWith("GLL")) {
      shippingLine = "ACL";
    }

    const output = {
      ...aesData,
      portOfLoading: polDisplay,
      ...dispatchData,
      vin: aesData.vin || dispatchData.dispatchVin || "",
      weightKgs: forcedAesWeightKgs || aesData.weightKgs || dispatchData.dispatchWeightKgs || "",
      voyage: match ? clean(getCell(match, ["Voyage", "Voyage Number"])) : "",
      cutoffDate: match ? (match.cutoffDate || formatExcelDate(getCell(match, ["Port Cutoff", "Cutoff Date", "Cutoff", "Cargo Cutoff", "Port cutoff"]))) : "",
      sailDate: match ? (match.sailDate || formatExcelDate(getCell(match, ["Sail Date", "ETD", "Sail"]))) : "",
      arrivalDate: match ? (match.arrivalDate || formatExcelDate(getCell(match, ["Arrival Date", "ETA", "Arrival"]))) : "",
      shippingLine,
      scheduleRowsRead: scheduleRows.length,
      scheduleMatchFound: match ? "YES" : "NO",
    };

    await saveShipment(output);

    res.json(output);
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= SEARCH SHIPMENTS =================

app.get("/search", async (req, res) => {
  try {
    const q = cleanUpper(req.query.q || "");

    const results = await Shipment.find({
      $or: [
        { vin: { $regex: q, $options: "i" } },
        { referenceNumber: { $regex: q, $options: "i" } },
      ],
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(20);

    res.json(results);
  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/db-test", async (req, res) => {
  res.json({
    mongoState: mongoose.connection.readyState,
    states: {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting",
    },
  });
});

// ================= PDF GENERATOR =================

app.post("/generate-pdf", async (req, res) => {
  try {
    const d = req.body || {};

    const templatePath = path.join(__dirname, "template.pdf");
    const templateBytes = fs.readFileSync(templatePath);

    const pdfDoc = await PDFLibDocument.load(templateBytes);
    const page = pdfDoc.getPages()[0];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { height } = page.getSize();


    function y(topY) {
      return height - topY;
    }

    function text(value, x, topY, size = 8.5, useBold = false) {
      page.drawText((value || "").toString(), {
        x,
        y: y(topY),
        size,
        font: useBold ? bold : font,
      });
    }

    const kg = Number(d.weightKgs || 0);
    const lbs = kg ? Math.round(kg * 2.20462) : "";

    const conditionText = cleanUpper(d.condition) === "RUNNER" ? "" : cleanUpper(d.condition);
    const titleText = cleanUpper(d.titleStatus) === "TITLE" ? "" : cleanUpper(d.titleStatus);

    const valueText =
      "VALUE - $" +
      Number(d.value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    // Helper: only join parts that are non-empty / non-"undefined"
    function safeVal(v) {
      if (v === undefined || v === null || v === "undefined" || v === "null") return "";
      return String(v).trim();
    }
    function safeLine(...parts) {
      return parts.map(safeVal).filter(Boolean).join(", ");
    }
    function safePair(a, b) {
      const A = safeVal(a), B = safeVal(b);
      if (!A && !B) return "";
      if (!A) return B;
      if (!B) return A;
      return `${A} ${B}`;
    }

    text(safeVal(d.exporterName), 25, 62);
    text(safeVal(d.exporterAddress), 25, 72);
    text(safeLine(d.exporterCity, safePair(d.exporterState, d.exporterZip)), 25, 82);
    text(safeVal(d.exporterCountry), 25, 92);

    text(safeVal(d.bookingNumber), 305, 69);
    text(safeVal(d.referenceNumber), 510, 69);
    text(safeVal(d.cutoffDate), 510, 92);

    text(safeVal(d.consigneeName), 25, 132);
    text(safeVal(d.consigneeAddress), 25, 142);
    text(safeVal(d.consigneeCity), 25, 152);
    text(safeVal(d.consigneeCountry), 25, 162);

    text(safeVal(d.sailDate), 510, 112);
    text(safeVal(d.arrivalDate), 510, 142);

    text(safeVal(d.pickupName || d.pickupLocation), 310, 200);
    text(safeVal(d.pickupAddress), 310, 210);
    text(safeLine(d.pickupCity, safePair(d.pickupState, d.pickupZip)), 310, 220);

    text(safeVal(d.deliveryName || d.deliveryLocation), 310, 247);
    text(safeVal(d.deliveryAddress), 310, 257);
    text(safeLine(d.deliveryCity, safePair(d.deliveryState, d.deliveryZip)), 310, 267);

    text(safeVal(d.sailDate), 30, 270);
    const vesselLine = safeVal(d.vessel) && safeVal(d.voyage)
      ? `${safeVal(d.vessel)} V: ${safeVal(d.voyage)}`
      : safeVal(d.vessel) || "";
    text(vesselLine, 30, 292);
    text(safeVal(d.portOfLoading || d.pol), 180, 292);
    text(safeVal(d.portOfDischarge || d.pod), 30, 313);

    const ymm = safeVal(d.vehicleYearMakeModel) ||
      [safeVal(d.year), safeVal(d.make), safeVal(d.model)].filter(Boolean).join(" ");
    const ymmVin = `${ymm}  VIN: ${safeVal(d.vin)}`;

    // Auto-shrink YMM+VIN if too long for the delivery order column
    const COL_X = 200, COL_MAX = 499, COL_W = COL_MAX - COL_X;
    let ymmSize = 8.5;
    while (ymmSize > 5.5 && font.widthOfTextAtSize(ymmVin, ymmSize) > COL_W) ymmSize -= 0.25;

    text("1 X RORO", 250, 347, 12);
    text(ymmVin, COL_X, 370, ymmSize);

    text(String(kg || ""), 503, 370, 8);
    text("KGS", 525, 370, 7);
    text(String(lbs || ""), 503, 380, 8);
    text("LBS", 525, 380, 7);

    let cargoY = 400;

    if (conditionText) {
      text(conditionText, 315, cargoY);
      cargoY += 18;
    }

    if (titleText) {
      text(titleText, 315, cargoY);
      cargoY += 18;
    }

    text(valueText, 250, 512);
    const itn = safeVal(d.aesItn);
    if (itn) text(`AES ITN: ${itn}`, 250, 532);

    const pdfBytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${d.referenceNumber || "DR"}.pdf"`
    );

    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("PDF TEMPLATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= GRID TEMPLATE =================

app.get("/grid-template", async (req, res) => {
  try {
    const templatePath = path.join(__dirname, "template.pdf");
    const templateBytes = fs.readFileSync(templatePath);

    const pdfDoc = await PDFLibDocument.load(templateBytes);
    const page = pdfDoc.getPages()[0];

    const { width, height } = page.getSize();

    for (let x = 0; x < width; x += 10) {
      page.drawLine({
        start: { x, y: 0 },
        end: { x, y: height },
        thickness: x % 50 === 0 ? 1 : 0.2,
        color: x % 50 === 0 ? rgb(1, 0, 0) : rgb(0, 0, 1),
      });

      if (x % 50 === 0) {
        page.drawText(String(x), {
          x: x + 2,
          y: height - 12,
          size: 6,
        });
      }
    }

    for (let gy = 0; gy < height; gy += 10) {
      page.drawLine({
        start: { x: 0, y: gy },
        end: { x: width, y: gy },
        thickness: gy % 50 === 0 ? 1 : 0.2,
        color: gy % 50 === 0 ? rgb(1, 0, 0) : rgb(0, 0, 1),
      });

      if (gy % 50 === 0) {
        page.drawText(String(gy), {
          x: 2,
          y: gy + 2,
          size: 6,
        });
      }
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("GRID TEMPLATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= START =================

// Auto-refresh Sallaum schedule daily at startup and every 24h
async function autoRefreshSallaumSchedule() {
  try {
    const scheduleRoutes = require("./routes/scheduleRoutes");
    const res = await fetch("http://localhost:4000/api/schedule/refresh-sallaum", {
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`[Auto-Refresh] Sallaum schedule updated: ${data.rows} rows`);
    }
  } catch (err) {
    console.warn("[Auto-Refresh] Sallaum schedule update skipped:", err.message);
  }
}

// ================= PARSE DISPATCH FROM URL =================
app.post("/api/expenses/parse-dispatch-url", express.json(), async (req, res) => {
  try {
    const { url, filename, orderRef, orderId } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });
    const urlPath = new URL(url).pathname;
    const baseUploads = path.join(__dirname, "uploads");
    const filePath = path.join(baseUploads, ...urlPath.replace(/^\/uploads\//, "").split("/").map(decodeURIComponent));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found: " + filePath });
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = data.text;

    const vinMatch = text.match(/\bVIN\b[\s\S]{0,30}?([A-HJ-NPR-Z0-9]{17})/i) || text.match(/([A-HJ-NPR-Z0-9]{17})/);
    const vin = vinMatch?.[1] || "";
    const priceMatch = text.match(/Total Price[\s\S]{0,20}?\$\s*([\d,]+(?:\.\d{2})?)/i) || text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
    const total = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : 0;
    const loadMatch = text.match(/Load ID\s*\n\s*(\d+)/i) || text.match(/Load\s+(\d{4,})\//i);
    const loadId = loadMatch?.[1] || "";
    const ymmMatch = text.match(/(\d{4})\s+([A-Z][a-zA-Z]+)\s+([A-Z][a-zA-Z0-9 ]+?)(?:\n|VIN|$)/m);
    const ymm = ymmMatch ? `${ymmMatch[1]} ${ymmMatch[2]} ${ymmMatch[3].trim()}` : "";
    const dispatchDateMatch = text.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
    const dispatchDate = dispatchDateMatch?.[0] || "";
    const originMatch = text.match(/Origin[\s\S]{0,5}?\n([^\n]+)/i);
    const origin = originMatch?.[1]?.trim() || "";

    // Save a copy to receipts dir
    const savedName = `${Date.now()}-${Math.round(Math.random()*1e9)}.pdf`;
    const receiptsDir = path.join(__dirname, "uploads/receipts");
    if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
    fs.copyFileSync(filePath, path.join(receiptsDir, savedName));

    const Order = require("./models/Order");
    let matchedOrder = null;
    if (orderId) {
      matchedOrder = await Order.findById(orderId).select("refNumber _id").lean().catch(() => null);
    }

    const row = {
      vin, ymm, total, loadId, dispatchDate, origin,
      billFileName: savedName, billMime: "application/pdf",
      orderId: matchedOrder?._id || orderId || null,
      orderRef: matchedOrder?.refNumber || orderRef || "",
      matched: !!(matchedOrder || orderId),
      notes: loadId ? `Load ID: ${loadId}` : "",
    };
    res.json([row]);
  } catch (err) {
    console.error("parse-dispatch-url error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= EMAIL =================

const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  pool: true,          // keep connection alive
  maxConnections: 3,   // allow parallel sends
  rateLimit: 10,       // max 10 msgs/sec
});
mailer.verify(err => {
  if (err) console.warn("[Email] SMTP verify failed:", err.message);
  else console.log("[Email] SMTP ready");
});

// ── Gmail REST API helper ─────────────────────────────────────────────────────
async function getGmailAccessToken() {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error_description || data.error || "Failed to get Gmail access token");
  return data.access_token;
}

// POST /api/send-email  { to, subject, body, pdfBase64, pdfName }
app.post("/api/send-email", express.json({ limit: "20mb" }), async (req, res) => {
  try {
    const { to, subject, body, pdfBase64, pdfName } = req.body;
    if (!to || !subject) return res.status(400).json({ error: "to and subject are required" });

    const accessToken = await getGmailAccessToken();
    const from = `Dor Ldor Global <${process.env.GMAIL_USER}>`;

    // Build MIME message
    const boundary = "DDG_BOUNDARY_" + Date.now();
    const mimeLines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      body || "",
    ];

    if (pdfBase64) {
      mimeLines.push(
        `--${boundary}`,
        `Content-Type: application/pdf; name="${pdfName || "document.pdf"}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment; filename="${pdfName || "document.pdf"}"`,
        ``,
        pdfBase64,
      );
    }

    mimeLines.push(`--${boundary}--`);
    const raw = Buffer.from(mimeLines.join("\r\n")).toString("base64url");

    const gmailResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    const result = await gmailResp.json();
    if (!gmailResp.ok) throw new Error(result.error?.message || `Gmail API error ${gmailResp.status}`);

    res.json({ success: true });
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: err.message });
  }
});

mongoose
  .connect(process.env.MONGODB_URI || process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB Connected");

    app.listen(4000, () => {
      console.log("Server running on port 4000");

      // Auto-refresh Sallaum schedule after short delay (let server fully start)
      setTimeout(autoRefreshSallaumSchedule, 5000);

      // Then refresh every 24 hours
      setInterval(autoRefreshSallaumSchedule, 24 * 60 * 60 * 1000);

      // ── Keep-alive ping (prevents Render free tier from sleeping) ──
      // Pings the server's own health endpoint every 14 minutes
      const SELF_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:4000";
      setInterval(() => {
        fetch(`${SELF_URL}/api/health`)
          .then(() => console.log("[keep-alive] ping ok"))
          .catch(err => console.warn("[keep-alive] ping failed:", err.message));
      }, 14 * 60 * 1000);
    });
  })
  .catch((err) => {
    console.error("MongoDB Error:", err);
  });