const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const pdfParse = require("pdf-parse");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const { PDFDocument: PDFLibDocument, StandardFonts, rgb } = require("pdf-lib");

const app = express();
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB Error:", err));
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const schedulesDir = path.join(__dirname, "saved-schedules");
const masterSchedulePath = path.join(schedulesDir, "master-schedule.xlsx");
const DATA_FILE = path.join(__dirname, "shipments.json");

if (!fs.existsSync(schedulesDir)) fs.mkdirSync(schedulesDir);

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
  const compact = text.toUpperCase().replace(/\s+/g, " ");

  const vin = findVin(compact);
  let weightKgs = "";
  let value = "";

  if (vin) {
    const vinIndex = compact.indexOf(vin);

    if (vinIndex !== -1) {
      const beforeVin = compact.slice(Math.max(0, vinIndex - 80), vinIndex);
      const weightNums = beforeVin.match(/\b\d{3,5}\b/g) || [];
      weightKgs = weightNums.length ? weightNums[weightNums.length - 1] : "";

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

function saveShipment(data) {
  let existing = [];

  if (fs.existsSync(DATA_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch {
      existing = [];
    }
  }

  const referenceNumber = clean(data.referenceNumber);
  const vin = cleanUpper(data.vin);

  existing = existing.filter((item) => {
    const sameRef = referenceNumber && clean(item.referenceNumber) === referenceNumber;
    const sameVin = vin && cleanUpper(item.vin) === vin;
    return !(sameRef || sameVin);
  });

  existing.unshift({
    ...data,
    createdAt: new Date().toISOString(),
  });

  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2));
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
  const combined = `${consigneeLine1} ${consigneeLine2}`.trim();

  const consigneeParts = combined.split(",").map(clean).filter(Boolean);

  let consigneeAddress = "";
  let consigneeCity = "";

  if (consigneeParts.length >= 2) {
    const lastPart = consigneeParts[consigneeParts.length - 1];

    if (/^[A-Z]{2}$/.test(lastPart)) {
      consigneeCity = consigneeParts[consigneeParts.length - 2];
      consigneeAddress = consigneeParts.slice(0, -2).join(", ");
    } else {
      consigneeCity = consigneeParts[consigneeParts.length - 1];
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
    weightKgs: vehicleData.weightKgs,
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
  const exists = fs.existsSync(masterSchedulePath);
  res.json({
    saved: exists,
    filename: exists ? "master-schedule.xlsx" : "",
  });
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

    const scheduleRows = getSavedScheduleRows();

    const match = findScheduleMatch(
      scheduleRows,
      aesData.vessel,
      aesData.portOfLoading,
      aesData.portOfDischarge
    );

let polDisplay = aesData.portOfLoading;

if (
  aesData.bookingNumber.startsWith("SLSE") &&
  normalizePort(aesData.portOfLoading) === "PROVIDENCE"
) {
  polDisplay = "DAVISVILLE";
}

    const output = {
  ...aesData,
  portOfLoading: polDisplay,
      ...dispatchData,
      vin: aesData.vin || dispatchData.dispatchVin || "",
      weightKgs: aesData.weightKgs || dispatchData.dispatchWeightKgs || "",
      voyage: match ? clean(getCell(match, ["Voyage", "Voyage Number"])) : "",
      cutoffDate: match ? formatExcelDate(getCell(match, ["Port Cutoff", "Cutoff Date", "Cutoff", "Cargo Cutoff", "Port cutoff"])) : "",
      sailDate: match ? formatExcelDate(getCell(match, ["Sail Date", "ETD", "Sail"])) : "",
      arrivalDate: match ? formatExcelDate(getCell(match, ["Arrival Date", "ETA", "Arrival"])) : "",
      scheduleRowsRead: scheduleRows.length,
      scheduleMatchFound: match ? "YES" : "NO",
    };

    saveShipment(output);

    res.json(output);
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= SEARCH SHIPMENTS =================

app.get("/search", (req, res) => {
  const q = cleanUpper(req.query.q || "");

  if (!q) return res.json([]);

  if (!fs.existsSync(DATA_FILE)) {
    return res.json([]);
  }

  let data = [];

  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    data = [];
  }

  const results = data.filter((item) => {
    return (
      cleanUpper(item.vin).includes(q) ||
      cleanUpper(item.referenceNumber).includes(q)
    );
  });

  res.json(results.slice(0, 20));
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

    text(d.exporterName, 25, 62);
    text(d.exporterAddress, 25, 72);
    text(`${d.exporterCity}, ${d.exporterState} ${d.exporterZip}`, 25, 82);
    text(d.exporterCountry, 25, 92);

    text(d.bookingNumber, 305, 69);
    text(d.referenceNumber, 510, 69);
    text(d.cutoffDate, 510, 92);

    text(d.consigneeName, 25, 132);
    text(d.consigneeAddress, 25, 142);
    text(d.consigneeCity, 25, 152);
    text(d.consigneeCountry, 25, 162);

    text(d.sailDate, 510, 112);
    text(d.arrivalDate, 510, 142);

    text(d.pickupName, 310, 202);
    text(d.pickupAddress, 310, 212);
    text(`${d.pickupCity}, ${d.pickupState} ${d.pickupZip}`, 310, 222);

    text(d.deliveryName, 310, 247);
    text(d.deliveryAddress, 310, 257);
    text(`${d.deliveryCity}, ${d.deliveryState} ${d.deliveryZip}`, 310, 267);

    text(d.sailDate, 30, 277);
    text(`${d.vessel} V: ${d.voyage}`, 30, 297);
    text(d.portOfLoading, 180, 297);
    text(d.portOfDischarge, 30, 317);

    text("1 X RORO", 340, 347, 12);
    text(`${d.vehicleYearMakeModel} VIN: ${d.vin}`, 270, 362, 8.5);

    text(String(kg || ""), 503, 362, 8);
    text("KGS", 525, 362, 7);
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

    text(valueText, 300, 512);
    text(`AES ITN: ${d.aesItn}`, 300, 532);

    const pdfBytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${d.referenceNumber || "DR"}.pdf"`);

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

app.listen(4000, () => console.log("Server running on port 4000"));