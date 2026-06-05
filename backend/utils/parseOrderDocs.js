const fs = require("fs");
const pdfParse = require("pdf-parse");

function clean(v) {
  return (v || "").toString().replace(/\s+/g, " ").trim();
}

function cleanUpper(v) {
  return clean(v).toUpperCase();
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
  // Pattern 1: ACE/AESDirect concatenated format: "NO14204T1C11AK7NU678515"
  // (unit + weight + VIN jammed together — no spaces, no word boundaries between them)
  const noConcat = upper.match(/NO\d{3,5}([A-HJ-NPR-Z0-9]{17})/);
  if (noConcat) return noConcat[1];
  // Pattern 2: Standard — weight then whitespace then VIN
  const afterWeight = upper.match(/\b\d{3,5}\s+([A-HJ-NPR-Z0-9]{17})\b/);
  if (afterWeight) return afterWeight[1];
  // Pattern 3: Generic VIN with clean word boundaries on both sides
  const normalMatch = upper.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  if (normalMatch) return normalMatch[0];
  // Pattern 4: Comma-formatted mileage directly followed by VIN (IAA table rows)
  // e.g. "227,0555UXWZ7C55G0R32171" → mileage = 227,055  VIN = 5UXWZ7C55G0R32171
  // Without this, the comma creates a word-boundary and Pattern 5 picks up "0555UXWZ7C55G0R32"
  // (3 trailing mileage digits bleed into the front of the match).
  const afterComma = upper.match(/\d{1,3},\d{3}([A-HJ-NPR-Z0-9]{17})/);
  if (afterComma) return afterComma[1];
  // Pattern 5: VIN concatenated with a trailing code (no comma prefix)
  // e.g. "5UXWZ7C55G0R32171HYM1024" — space between VIN and title code was dropped.
  // Take first 17 of any 17+-char run at a word boundary; verify check-digit position.
  const embedded = [...upper.matchAll(/\b([A-HJ-NPR-Z0-9]{17})[A-HJ-NPR-Z0-9]+\b/g)];
  for (const m of embedded) {
    const c = m[1];
    if (/[\dX]/.test(c[8])) return c; // check-digit position (index 8) validates it
  }
  return "";
}

function findITN(text) {
  const match = text.match(/\bX\d{14,}\b/i);
  return match ? match[0].toUpperCase() : "";
}

function normalizePort(raw) {
  const u = cleanUpper(raw || "");
  if (u.includes("JACKSONVILLE")) return "JACKSONVILLE";
  if (u.includes("BALTIMORE"))    return "BALTIMORE";
  if (u.includes("PROVIDENCE") || u.includes("DAVISVILLE")) return "PROVIDENCE";
  if (u.includes("FREEPORT"))     return "FREEPORT";
  if (u.includes("WILMINGTON"))   return "WILMINGTON";
  if (u.includes("BRUNSWICK"))    return "BRUNSWICK";
  if (u.includes("NEWARK"))       return "NEWARK";
  if (u.includes("TEMA"))         return "TEMA";
  if (u.includes("LAGOS"))        return "LAGOS";
  if (u.includes("COTONOU"))      return "COTONOU";
  if (u.includes("LOME"))         return "LOME";
  if (u.includes("DAKAR"))        return "DAKAR";
  if (u.includes("DURBAN"))       return "DURBAN";
  if (u.includes("ABIDJAN"))      return "ABIDJAN";
  return clean(raw);
}

function countryFromPod(pod) {
  const map = {
    TEMA: "GHANA", LAGOS: "NIGERIA", COTONOU: "BENIN", LOME: "TOGO",
    DAKAR: "SENEGAL", DURBAN: "SOUTH AFRICA", ABIDJAN: "IVORY COAST",
  };
  return map[cleanUpper(pod)] || "";
}

function extractVehicleData(text) {
  const upper = text.toUpperCase();
  const compact = upper.replace(/\s+/g, " ");

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

  // vehicle year/make/model
  let year = "", make = "", model = "";
  const vehiclePatterns = [
    /(\d{4})\s+([A-Z]+)\s+([A-Z0-9 \-]+)/i,
    /Vehicle Description[:\s]+(\d{4})\s+([A-Z]+)\s+([A-Z0-9 \-]+)/i,
  ];
  for (const p of vehiclePatterns) {
    const m = text.match(p);
    if (m) {
      year = clean(m[1]);
      make = clean(m[2]);
      model = clean(m[3]).split(vin)[0].trim();
      break;
    }
  }

  return { vin, weightKgs, value, year, make, model };
}

function findWeight(text) {
  const match = text.match(/(?:Weight|Shipping Weight|Gross Weight)[:\s]+([\d,]+)/i);
  return match ? clean(match[1]).replace(/,/g, "") : "";
}

function findCondition(text) {
  const upper = text.toUpperCase();
  if (upper.includes("FORKLIFT")) return "Forklift";
  if (upper.includes("NON RUNNER") || upper.includes("NONRUNNER") || upper.includes("INOPERABLE")) {
    return "Nonrunner";
  }
  return "";
}

async function parsePdfFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text || "";
}

// ── Full AES parsing (extracts consignee, exporter, vessel, all DR fields) ──
async function parseAES(filePath) {
  const text = await parsePdfFile(filePath);
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);

  // ── ACE/AESDirect two-column PDF helpers ──────────────────────────────
  // ACE/AESDirect (trade.cbp.dhs.gov) renders as a two-column HTML table.
  // pdf-parse interleaves rows: right-column field labels appear BETWEEN a
  // left-column label and its value:
  //   "1a. U.S. PRINCIPAL PARTY"   ← left col header
  //   "b. USPPI EIN (IRS)..."      ← right col header (interleaved)
  //   "STATE FARM MUTUAL"           ← actual value we want
  // valueAfterLabel skips those interleaved AES labels to reach the true value.
  function valueAfterLabel(label, maxSkip = 8) {
    const i = lines.findIndex(l => cleanUpper(l).includes(cleanUpper(label)));
    if (i === -1) return "";
    for (let j = i + 1; j <= Math.min(i + maxSkip, lines.length - 1); j++) {
      const l = lines[j];
      // Skip AES field labels like "b. USPPI EIN...", "10. PORT OF EXPORT", "5a. ..."
      if (/^(\d{1,2}[a-z]?|[a-z])\.\s/i.test(l)) continue;
      if (l.length < 2) continue;
      return clean(l);
    }
    return "";
  }

  // Scan up to 15 lines after label for a line matching the given port pattern
  function portNearLabel(label, rx) {
    const fallback = /\b(JACKSONVILLE|BALTIMORE|PROVIDENCE|DAVISVILLE|FREEPORT|WILMINGTON|BRUNSWICK|NEWARK|TEMA|LAGOS|COTONOU|LOME|DAKAR|DURBAN|ABIDJAN)\b/i;
    const pat = rx || fallback;
    const i = lines.findIndex(l => cleanUpper(l).includes(cleanUpper(label)));
    if (i === -1) return "";
    for (let j = i + 1; j <= Math.min(i + 15, lines.length - 1); j++) {
      if (pat.test(lines[j])) return normalizePort(lines[j]);
    }
    return "";
  }
  // ───────────────────────────────────────────────────────────────────────

  const bookingNumber =
    clean(text.match(/S3[-\s]?\d+/i)?.[0] || "") ||
    valueAfterLabel("3. TRANSPORTATION REFERENCE NO.");

  const referenceNumber = valueAfterLabel("14. SHIPMENT REFERENCE NO.");

  // Exporter
  const exporterName = valueAfterLabel("1a. U.S. PRINCIPAL PARTY");
  // After exporter name comes EIN (all digits) then the street address — skip the EIN
  const exporterAddressLine = (() => {
    const ni = lines.findIndex(l => cleanUpper(l) === cleanUpper(exporterName));
    if (ni === -1) return "";
    for (let j = ni + 1; j <= Math.min(ni + 5, lines.length - 1); j++) {
      const l = lines[j];
      if (/^(\d{1,2}[a-z]?|[a-z])\.\s/i.test(l)) break; // hit next AES field, stop
      if (/^\d{7,}$/.test(clean(l))) continue;           // skip EIN (≥7 pure digits)
      if (l.length >= 6 && /[A-Z]/i.test(l)) return clean(l);
    }
    return "";
  })();
  const exporter = parseAddressParts(exporterAddressLine);

  // Consignee — find the 4a label first, then read name + address from there
  // (can't use findIndex on the name because USPPI may share the same company name)
  const consignee4aIdx = lines.findIndex(l => cleanUpper(l).includes("4A. ULTIMATE CONSIGNEE"));
  const consigneeName = consignee4aIdx !== -1
    ? (() => {
        for (let j = consignee4aIdx + 1; j <= Math.min(consignee4aIdx + 8, lines.length - 1); j++) {
          const l = lines[j];
          if (/^(\d{1,2}[a-z]?|[a-z])\.\s/i.test(l)) continue;
          if (l.length < 2) continue;
          return clean(l);
        }
        return "";
      })()
    : valueAfterLabel("4a. ULTIMATE CONSIGNEE");

  // Address lines are immediately after the name within the 4a block
  const consigneeNameIdx = consignee4aIdx !== -1
    ? (() => {
        for (let j = consignee4aIdx + 1; j <= Math.min(consignee4aIdx + 8, lines.length - 1); j++) {
          if (cleanUpper(lines[j]) === cleanUpper(consigneeName)) return j;
        }
        return -1;
      })()
    : lines.findIndex(l => cleanUpper(l) === cleanUpper(consigneeName));

  // Read up to 5 lines after name, skipping AES field labels AND US domestic addresses
  // (US addresses bleed in from the right-column USPPI block due to two-column interleaving)
  const US_STATE_ZIP = /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+\d{5}/i;
  const isAesLabel = l =>
    /^(\d{1,2}[a-z]?|[a-z])\.\s/i.test(l) ||
    /USPPI|EIN.*IRS|IRS.*EIN|ULTIMATE CONSIGNEE TYPE/i.test(l) ||
    US_STATE_ZIP.test(l);   // skip USPPI US address lines bleeding in from right column
  const consigneeAddrLines = [];
  if (consigneeNameIdx !== -1) {
    for (let j = consigneeNameIdx + 1; j <= Math.min(consigneeNameIdx + 8, lines.length - 1); j++) {
      const l = lines[j]; if (!l || isAesLabel(l)) continue; // skip, don't break — may resume after US line
      consigneeAddrLines.push(l);
      if (consigneeAddrLines.length === 2) break;
    }
  }
  const consigneeLine1 = consigneeAddrLines[0] || "";
  const consigneeLine2 = consigneeAddrLines[1] || "";
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

  // Vessel and ports — use pattern-specific scan to avoid POL/POD mix-up
  const vessel = valueAfterLabel("9. EXPORTING CARRIER");
  const pol = portNearLabel("10. PORT OF EXPORT",
    /\b(JACKSONVILLE|BALTIMORE|PROVIDENCE|DAVISVILLE|FREEPORT|WILMINGTON|BRUNSWICK|NEWARK)\b/i);
  const pod = portNearLabel("11. PORT OF UNLADING",
    /\b(TEMA|LAGOS|COTONOU|LOME|DAKAR|DURBAN|ABIDJAN)\b/i);

  // Year/make/model from commodity line
  const commodity = lines.join(" ");
  const vehicleMatch = commodity.match(/\b\d{4}\s+[A-Z]{2,}[A-Z0-9 \-]+?(?=\s+EXPORT INFO CODE)/i);
  const vehicleYearMakeModel = cleanUpper((vehicleMatch?.[0] || "").replace("EXPORT INFO CODE", ""));

  const vehicleData = extractVehicleData(text);

  // Weight extraction — try formats in priority order
  const up = text.toUpperCase();
  let aesWeightKgs = "";

  // Pattern 0: ACE/AESDirect concatenated "1 NO14204T1C11AK7NU678515"
  // Unit(NO) + weight(digits) + VIN all jammed together — no spaces, no word boundary
  if (!aesWeightKgs) {
    const w0 = up.match(/\bNO(\d{3,5})[A-HJ-NPR-Z0-9]{17}/);
    if (w0) aesWeightKgs = w0[1];
  }
  // Pattern 1: ACE/AESDirect — "1 NO 1,420 {VIN}" — comma-tolerant
  if (!aesWeightKgs) {
    const w1 = up.match(/\b1\s+NO\s+([\d,]{3,7})\s+[A-HJ-NPR-Z0-9]{17}/);
    if (w1) aesWeightKgs = w1[1].replace(/,/g, "");
  }
  // Pattern 2: "1 NO 1,420" — VIN on next line — comma-tolerant
  if (!aesWeightKgs) {
    const w2 = up.match(/\b1\s+NO\s+([\d,]{3,7})\b/);
    if (w2) aesWeightKgs = w2[1].replace(/,/g, "");
  }
  // Pattern 3: Older paper AES — "1 NO 1234 VERIFY:"
  if (!aesWeightKgs) {
    const w3 = up.match(/\b1\s+NO\s+(\d{3,6})\s+VERIFY:/);
    if (w3) aesWeightKgs = w3[1];
  }
  // Pattern 4: Inline label + value — "SHIPPING WEIGHT (KG) 1,234"
  if (!aesWeightKgs) {
    const w4 = up.match(/SHIPPING\s+WEIGHT\s*\([^)]*\)\s*([\d,]+)/);
    if (w4) aesWeightKgs = w4[1].replace(/,/g, "");
  }
  // Pattern 4b: ACE/AESDirect "d. SHIPPING WEIGHT (KGS)" label → first numeric line after it
  // Uses valueAfterLabel (defined above) to skip interleaved column headers
  if (!aesWeightKgs) {
    const wLabel = valueAfterLabel("SHIPPING WEIGHT", 12);
    if (wLabel) {
      const wn = wLabel.replace(/,/g, "");
      if (/^\d{3,6}$/.test(wn)) aesWeightKgs = wn;
    }
  }
  // Pattern 5: "GROSS WEIGHT: 1,234 KGS"
  if (!aesWeightKgs) {
    const w5 = up.match(/GROSS\s+WEIGHT[:\s]+([\d,]+)\s*(?:KG|KGS)?/);
    if (w5) aesWeightKgs = w5[1].replace(/,/g, "");
  }
  // Pattern 6: Any number followed by KGS in commodity section
  if (!aesWeightKgs) {
    const idx20 = up.indexOf("20.");
    if (idx20 !== -1) {
      const commodityArea = up.slice(idx20, idx20 + 600);
      const w6 = commodityArea.match(/\b(\d{3,5})\s*KGS?\b/);
      if (w6) aesWeightKgs = w6[1];
    }
  }
  // Pattern 7: Standalone number on line immediately before VIN (ACE interleaved format)
  // e.g.  ...  "1,420"  ← weight line  "4T1C11AK7NU678515"  ← VIN line
  if (!aesWeightKgs && vehicleData.vin) {
    const vinLineIdx = lines.findIndex(l => cleanUpper(l).includes(vehicleData.vin));
    if (vinLineIdx > 0) {
      for (let j = vinLineIdx - 1; j >= Math.max(vinLineIdx - 5, 0); j--) {
        const wm = clean(lines[j]).match(/^([\d,]{3,7})$/);
        if (wm) { aesWeightKgs = wm[1].replace(/,/g, ""); break; }
      }
    }
  }
  // Pattern 8: fallback from extractVehicleData
  if (!aesWeightKgs) aesWeightKgs = vehicleData.weightKgs || "";

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

    vessel: cleanUpper(vessel),
    portOfLoading: pol,
    portOfDischarge: pod,
    pol,
    pod,

    vehicleYearMakeModel,
    vin: vehicleData.vin,
    year: vehicleData.year,
    make: vehicleData.make,
    model: vehicleData.model,
    weightKgs: aesWeightKgs || vehicleData.weightKgs,
    value: vehicleData.value ||
      clean(text.match(/\/\s*[A-Z]{2}\s+(\d{3,8})\s*(?:Sensitive Information|Do not submit|$)/i)?.[1] || ""),
    aesItn: findITN(text),
  };
}

// ── Extract towing cost from a dispatch/invoice PDF ──────────────────────
function extractTowingCost(text) {
  // Priority 1: labeled dollar amount (most reliable)
  const labeled = text.match(
    /(?:total\s*(?:due|amount|charge)?|amount\s*due|invoice\s*total|carrier\s*pay|driver\s*pay|quoted?\s*(?:price|rate|amount)|transport(?:ation)?\s*(?:total|amount|charge|fee|cost)|flat\s*rate|base\s*rate|service\s*(?:fee|charge|cost)|rate)[:\s]*\$?\s*([\d,]+(?:\.\d{1,2})?)/i
  );
  if (labeled) {
    const n = parseFloat(labeled[1].replace(/,/g, ""));
    if (n >= 50 && n <= 9999) return Math.round(n);
  }

  // Priority 2: find all $ amounts in towing range and pick the last one (usually the total)
  const amounts = [];
  const rx = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (n >= 50 && n <= 9999) amounts.push(n);
  }
  if (amounts.length === 1) return Math.round(amounts[0]);
  if (amounts.length > 1)   return Math.round(amounts[amounts.length - 1]);

  return null;
}

// ── Full Dispatch parsing (extracts pickup + delivery addresses) ──
async function parseDispatch(filePath) {
  const text = await parsePdfFile(filePath);
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
      pickupLocation: cleanUpper(`${auction} ${city} ${state} ${extraName}`),
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
      deliveryLocation: cleanUpper(nameLines.join(" ")),
    };
  }

  const vehicle = {
    vin: dispatchVin,
  };

  const condition = findCondition(text);

  const dispatchTowingCost = extractTowingCost(text);

  return {
    ...pickup,
    ...delivery,
    ...vehicle,
    dispatchVin,
    dispatchWeightKgs,
    dispatchTowingCost,
    condition: condition || undefined,
  };
}

// ── US state full-name → 2-letter abbreviation ────────────────────────────
function stateNameToAbbrev(name) {
  const map = {
    'ALABAMA':'AL','ALASKA':'AK','ARIZONA':'AZ','ARKANSAS':'AR','CALIFORNIA':'CA',
    'COLORADO':'CO','CONNECTICUT':'CT','DELAWARE':'DE','FLORIDA':'FL','GEORGIA':'GA',
    'HAWAII':'HI','IDAHO':'ID','ILLINOIS':'IL','INDIANA':'IN','IOWA':'IA',
    'KANSAS':'KS','KENTUCKY':'KY','LOUISIANA':'LA','MAINE':'ME','MARYLAND':'MD',
    'MASSACHUSETTS':'MA','MICHIGAN':'MI','MINNESOTA':'MN','MISSISSIPPI':'MS','MISSOURI':'MO',
    'MONTANA':'MT','NEBRASKA':'NE','NEVADA':'NV','NEW HAMPSHIRE':'NH','NEW JERSEY':'NJ',
    'NEW MEXICO':'NM','NEW YORK':'NY','NORTH CAROLINA':'NC','NORTH DAKOTA':'ND','OHIO':'OH',
    'OKLAHOMA':'OK','OREGON':'OR','PENNSYLVANIA':'PA','RHODE ISLAND':'RI','SOUTH CAROLINA':'SC',
    'SOUTH DAKOTA':'SD','TENNESSEE':'TN','TEXAS':'TX','UTAH':'UT','VERMONT':'VT',
    'VIRGINIA':'VA','WASHINGTON':'WA','WEST VIRGINIA':'WV','WISCONSIN':'WI','WYOMING':'WY',
  };
  return map[(name || "").toUpperCase().trim()] || "";
}

// ── IAA Buyer Receipt parser ───────────────────────────────────────────────
// IAA PDFs lay out as:
//   Left block:  Pick-Up Location block (branch name, street, city/state/zip, phone)
//   Right table: Receipt #, Buyer Name, Dealer, etc.
//   Vehicle row: StockNo | Sale Item # | Year | Make | Model | Color | Mileage | VIN
//   Invoice To:  customer name (may be split across rows) + "Buyer Name" field (reliable)
//   Bottom note: "Sold At (USPPI): 465 - Fort Worth North 3748 McPherson Dr., Justin, TX , 76247."
function parseIAAReceipt(text, lines, vin, vehicle) {
  // ── Customer Name ──────────────────────────────────────────────────────
  // Primary: explicit "Buyer Name XXXX" cell in the right-side table
  let customerName = "";
  const buyerNameLine = lines.find(l => /^Buyer\s+Name\s+\S/i.test(l));
  if (buyerNameLine) {
    customerName = clean(buyerNameLine.replace(/^Buyer\s+Name\s*/i, ""));
  }
  // Fallback: regex across full text (handles line-break between label and value)
  if (!customerName) {
    const m = text.match(/Buyer\s+Name\s+([A-Z][A-Z0-9 &.,\-']{2,80}?)(?:\r?\n|Dealer|Resale|Receipt\s+Ack)/i);
    if (m) customerName = clean(m[1]);
  }
  // Last resort: first substantive line after "Invoice To:" header (which pdf-parse
  // merges with column headers: "Invoice To: Description Charges Payments Balance")
  if (!customerName) {
    const invIdx = lines.findIndex(l => /Invoice\s+To:/i.test(l));
    if (invIdx >= 0) {
      for (let i = invIdx + 1; i < Math.min(invIdx + 6, lines.length); i++) {
        const l = lines[i];
        if (/Description|Charges|Payments|Balance|Bid Amount|\$\d/i.test(l)) continue;
        if (l.length < 3) continue;
        customerName = clean(l);
        break;
      }
    }
  }

  // ── Pickup Location ────────────────────────────────────────────────────
  // Strategy A: "Sold At (USPPI):" line — most reliable, full address on one line.
  // Format: "465 - Fort Worth North 3748 McPherson Dr., Justin, TX , 76247. (940) 648-5541"
  let pickupBranchName = "";
  let pickupAddress = "";
  let pickupCity = "";
  let pickupState = "";
  let pickupZip = "";

  const usppiLine = lines.find(l => /Sold\s+At\s+\(USPPI\)/i.test(l));
  if (usppiLine) {
    const content = usppiLine.replace(/^Sold\s+At\s+\(USPPI\)\s*:\s*/i, "").trim();
    // Strip leading branch number+name: "465 - Fort Worth North " up to the street number
    // Then match: street address, city, state-abbrev, zip
    const m = content.match(/(?:\d+\s*-\s*[^,\d]+?)\s*(\d{1,5}\s+[^,]+?),\s*([^,]+?),\s*([A-Z]{2})\s*,?\s*(\d{5})/i);
    if (m) {
      pickupAddress = cleanUpper(m[1].replace(/\.$/, "").trim());
      pickupCity    = cleanUpper(m[2].trim());
      pickupState   = m[3].toUpperCase();
      pickupZip     = m[4];
      // Extract branch name (between the number prefix and the street)
      const branchM = content.match(/^\d+\s*-\s*(.+?)\s+\d{1,5}\s+/);
      if (branchM) pickupBranchName = cleanUpper(branchM[1].trim());
    }
  }

  // Strategy B: "Pick-Up Location:" block scan
  // pdf-parse merges the column headers, so the Pick-Up Location row appears as:
  //   "Pick-Up Location: Sale Date 5/19/2026"   ← col merge
  //   "Fort Worth North"                          ← branch name
  //   "3748 McPherson Dr"                         ← street
  //   "Justin Texas 76247"                        ← city + FULL STATE NAME + zip
  //   "(940) 648-5541"                            ← phone (skip)
  if (!pickupCity) {
    const pickupLocIdx = lines.findIndex(l => /Pick[-\s]*Up\s+Location/i.test(l));
    if (pickupLocIdx >= 0) {
      const block = [];
      for (let i = pickupLocIdx + 1; i < Math.min(pickupLocIdx + 10, lines.length); i++) {
        const l = lines[i];
        if (/\(\d{3}\)/.test(l)) continue;              // phone number
        if (/Sale\s+Date|\d{1,2}\/\d{1,2}\/\d{4}/i.test(l)) continue; // date fields
        if (/StockNo|Sale\s+Item|Year\s+Make/i.test(l)) break;        // hit vehicle table
        block.push(l);
        if (block.length >= 4) break;
      }
      // block[0] = branch name, block[1] = street address, block[2] = "City StateName Zip"
      if (block.length >= 1) pickupBranchName = pickupBranchName || cleanUpper(block[0]);
      if (block.length >= 2) pickupAddress    = pickupAddress    || cleanUpper(block[1]);
      if (block.length >= 3 && !pickupCity) {
        // "Justin Texas 76247" — state may be full name or abbreviation
        const cszLine = block[2];
        const m = cszLine.match(/^(.+?)\s+(\w+(?:\s+\w+)?)\s+(\d{5})\s*$/i);
        if (m) {
          pickupCity  = cleanUpper(m[1].trim());
          const rawState = m[2].trim();
          pickupState = stateNameToAbbrev(rawState) || cleanUpper(rawState);
          pickupZip   = m[3];
        }
      }
    }
  }

  // Build pickup name: "IAAI [BranchName] [City] [State]" or just "IAAI [City] [State]"
  let pickupName = "";
  if (pickupBranchName) {
    pickupName = `IAAI ${pickupBranchName}`;
  } else if (pickupCity) {
    pickupName = `IAAI ${pickupCity} ${pickupState}`.trim();
  }
  const pickupLocation = pickupName || pickupAddress || "";

  // ── Vehicle Year / Make / Model ───────────────────────────────────────
  // IAA vehicle row format: "[StockNo] [SaleItem] [Year] [Make] [Model] [Color] [Mileage] [VIN]"
  // e.g.: "000-44674966 D-0034 2016 BMW X3 Black 227,055 5UXWZ7C55G0R32171 HYM1024"
  //
  // extractVehicleData() uses a generic year+make pattern that false-matches the receipt
  // number ("26696063" → "6063") or dates ("5/26/2026" → "2026 Fort Worth") before it
  // ever reaches the vehicle row.  Instead we search backwards from the known VIN so we
  // are guaranteed to be looking at the right portion of the document.
  const COLORS = 'White|Black|Silver|Grey|Gray|Blue|Red|Green|Gold|Brown|Beige|Yellow|Orange|Purple|Pink|Maroon|Tan|Cream|Burgundy|Charcoal|Copper|Bronze|Dk|Dark|Lt|Light';

  let year = "";
  let make = "";
  let model = "";

  if (vin) {
    const vinIdx = text.indexOf(vin);
    if (vinIdx > 0) {
      // Look at up to 300 chars before the VIN — that's where Year/Make/Model/Color/Mileage live
      const beforeVin = text.slice(Math.max(0, vinIdx - 300), vinIdx);

      // Primary: anchored by COLOR keyword + MILEAGE digits at end of the slice
      // e.g. "2016 BMW X3 Black 227,055 "
      const withColor = beforeVin.match(
        new RegExp(
          `\\b(\\d{4})\\s+([A-Z]{2,})\\s+([A-Z0-9][A-Z0-9 \\-]*?)\\s+(?:${COLORS})\\s+[\\d,]+\\s*$`,
          'i'
        )
      );
      if (withColor) {
        year  = clean(withColor[1]);
        make  = cleanUpper(withColor[2]);
        model = cleanUpper(withColor[3].trim());
      } else {
        // Fallback: Year Make Model anchored by mileage digits at end of slice (no color)
        const noColor = beforeVin.match(/\b(\d{4})\s+([A-Z]{2,})\s+([A-Z0-9][A-Z0-9 \-]*?)\s+[\d,]+\s*$/i);
        if (noColor) {
          year  = clean(noColor[1]);
          make  = cleanUpper(noColor[2]);
          model = cleanUpper(noColor[3].trim());
        }
      }
    }
  }

  // Final fallback: use extractVehicleData result (better than nothing)
  if (!year)  year  = vehicle.year  || "";
  if (!make)  make  = vehicle.make  || "";
  if (!model) model = vehicle.model || "";

  // Strip any residual Color / Mileage that may have crept into the model string
  const cleanModel = model
    .replace(new RegExp(`\\s+(?:${COLORS})\\b.*`, 'i'), "")
    .trim();

  // ── Phone / email ──────────────────────────────────────────────────────
  const phoneMatch = text.match(/(?:Phone|Tel|Cell)[:\s]*([\d()\s\-+]{7,20})/i);
  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);

  // ── Lot number — IAA StockNo "000-XXXXXXXX" → strip prefix, keep 8 digits ──
  // "000-44707958" may be concatenated with year: "000-447079582012..." — no trailing \b
  const iaaStockMatch = text.match(/\b000-(\d{8})/);
  const lotNumber = iaaStockMatch ? iaaStockMatch[1] : "";

  return {
    customerName,
    customerPhone: phoneMatch ? clean(phoneMatch[1]) : "",
    customerEmail: emailMatch ? emailMatch[0] : "",
    vin,
    year,
    make,
    model: cleanModel,
    lotNumber,
    pickupLocation,
    pickupName,
    pickupAddress,
    pickupCity,
    pickupState,
    pickupZip,
  };
}

// ── Buyer Receipt parser (Copart / IAAI) ──────────────────────────────────
// Copart PDFs have 3 columns: [MEMBER/Customer] [PHYSICAL ADDRESS OF LOT] [SELLER]
// pdf-parse merges them left-to-right, producing lines like:
//   "MEMBER: 579911 PHYSICAL ADDRESS OF"
//   "LOT: SELLER:"
//   "SAAD AS AND TECH LTD"           ← customer name (LEFT col starts)
//   "NO. 03, AHMADU BELLO WAY,"      ← customer foreign address
//   "KADUNA"
//   "KADUNA, NG"
//   "4007 ADMIRAL PEARY HWY"         ← pickup address (MIDDLE col)
//   "EBENSBURG PA 15931"             ← pickup city/state/zip
//   "NATIONWIDE INSURANCE"           ← seller (RIGHT col, ignore)
// ── DOR L'DOR Order Request Form parser ───────────────────────────────────────
// Handles the internal "ORDER DETAILS" PDF format with labelled fields:
// MODE OF SHIPPING, VEHICLE INFO, VIN, LOCATION, BUYER LOT, DESTINATION,
// PREFERRED SHIPPING LINE, IMPORTER/CUSTOMER, CONSIGNEE DETAILS, TOWING QUOTE
function parseOrderRequestForm(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const field = (label) => {
    // Match "LABEL    value" on same line, or value on next non-empty line
    const re = new RegExp(label + "[:\\s]+(.+)", "i");
    for (const l of lines) {
      const m = l.match(re);
      if (m) return m[1].trim();
    }
    // Try next-line style
    const idx = lines.findIndex(l => new RegExp("^" + label + "\\s*$", "i").test(l));
    if (idx >= 0 && lines[idx + 1]) return lines[idx + 1].trim();
    return "";
  };

  // Vehicle: "2016 HYUNDAI SONATA SE"
  const vehicleRaw = field("VEHICLE INFO");
  let year = "", make = "", model = "";
  if (vehicleRaw) {
    const vm = vehicleRaw.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    if (vm) { year = vm[1]; make = vm[2]; model = vm[3]; }
  }

  // VIN
  const vin = findVin(text) || field("VIN");

  // Location → pickup address  e.g. "6089 HIGHWAY 20 LOGANVILLE GA 30052"
  const locationRaw = field("LOCATION");
  let pickupAddress = "", pickupCity = "", pickupState = "", pickupZip = "";
  if (locationRaw) {
    // Try "CITY STATE ZIP" at end
    const addrM = locationRaw.match(/^(.+?)\s+([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/i);
    if (addrM) {
      // Walk backwards to find city — last all-alpha word group before state
      const withoutStatZip = addrM[1].trim();
      const cityM = withoutStatZip.match(/^(.+)\s+([A-Z][a-zA-Z\s]+)$/);
      pickupAddress   = withoutStatZip;
      pickupState     = addrM[2].toUpperCase();
      pickupZip       = addrM[3];
      // Extract city as last word(s) before state
      const parts = withoutStatZip.split(/\s+/);
      // Find where numeric street address ends — city is usually last 1-2 caps words
      const numEnd = parts.findIndex((p, i) => i > 0 && /^[A-Z][a-z]/.test(p));
      pickupCity = parts.slice(numEnd >= 0 ? numEnd : -1).join(" ").toUpperCase();
    } else {
      pickupAddress = locationRaw;
    }
  }

  // Lot number
  const lotNumber = field("BUYER LOT") || field("LOT");

  // Destination → POD
  const pod = (field("DESTINATION") || "").toUpperCase();

  // Preferred shipping line
  const shippingLine = (field("PREFERRED SHIPPING LINE") || "").toUpperCase();

  // Mode of shipping → requestType
  const modeRaw = field("MODE OF SHIPPING");
  const requestType = /container/i.test(modeRaw) ? "Container" : /roro/i.test(modeRaw) ? "RORO" : "";

  // Importer / Customer block
  // Lines after "IMPORTER / CUSTOMER" until "CONSIGNEE DETAILS"
  let customerName = "", customerPhone = "", customerEmail = "", customerCountry = "";
  const importerIdx = lines.findIndex(l => /IMPORTER\s*[\/|]\s*CUSTOMER/i.test(l));
  const consigneeIdx = lines.findIndex(l => /CONSIGNEE\s+DETAILS/i.test(l));
  if (importerIdx >= 0) {
    const block = lines.slice(importerIdx + 1, consigneeIdx > importerIdx ? consigneeIdx : importerIdx + 10);
    for (const l of block) {
      const nm = l.match(/^Name:\s*(.+)/i);        if (nm) customerName    = nm[1].trim();
      const ph = l.match(/^Contact:\s*(.+)/i);     if (ph) customerPhone   = ph[1].trim();
      const em = l.match(/^Email:\s*(.+)/i);       if (em) customerEmail   = em[1].trim();
      const co = l.match(/^Country:\s*(.+)/i);     if (co) customerCountry = co[1].trim().toUpperCase();
    }
  }

  // Consignee block
  let consigneeName = "", consigneeAddress = "", consigneeCity = "";
  const notifyIdx = lines.findIndex(l => /NOTIFY\s+PARTY/i.test(l));
  if (consigneeIdx >= 0) {
    const block = lines.slice(consigneeIdx + 1, notifyIdx > consigneeIdx ? notifyIdx : consigneeIdx + 10);
    for (const l of block) {
      const nm = l.match(/^Name:\s*(.+)/i);        if (nm) consigneeName    = nm[1].trim();
      const ad = l.match(/^Residential:\s*(.+)/i); if (ad) consigneeAddress = ad[1].trim();
      const ci = l.match(/^Postal:\s*(.+)/i);      if (ci) consigneeCity    = ci[1].trim();
    }
  }

  // Towing quote
  const towingRaw = field("TOWING QUOTE");
  const towingM   = towingRaw.match(/[\d,]+(?:\.\d+)?/);
  const towingQuote = towingM ? towingM[0].replace(/,/g, "") : "";

  return {
    requestType,
    year, make, model, vin,
    lotNumber,
    pickupLocation: locationRaw,
    pickupAddress, pickupCity, pickupState, pickupZip,
    pod,
    shippingLine,
    customerName,
    customerPhone,
    customerEmail,
    consigneeName,
    consigneeAddress,
    consigneeCity,
    consigneeCountry: customerCountry || "GHANA",
    towingQuote,   // caller can use this to pre-fill towing charge
    _source: "order-request-form",
  };
}

async function parseBuyerReceipt(filePath) {
  const text = await parsePdfFile(filePath);
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);

  // ── Route to Order Request Form parser if this is a DOR L'DOR internal form ──
  if (/ORDER\s+DETAILS/i.test(text) && /MODE\s+OF\s+SHIPPING/i.test(text) && /IMPORTER/i.test(text)) {
    return parseOrderRequestForm(text);
  }

  const vin = findVin(text);
  const vehicle = extractVehicleData(text);

  // ── Route to IAA parser if this is an IAA / Insurance Auto Auctions receipt ──
  // Use multiple signals because some PDFs render the header logo as an image
  // so "Insurance Auto Auctions Corp" may not appear as extractable text.
  const isIAA =
    /insurance\s+auto\s+auction/i.test(text) ||  // header text (when extractable)
    /\biaa\s*doc\b/i.test(text)               ||  // "IAA Doc: RP018.00" footer
    /<IAAI\b/i.test(text)                     ||  // barcode: "<IAAI FFR …>"
    /\bSold\s+At\s+Branch\b/i.test(text)      ||  // "Sold At Branch 465 - …" (IAA-only field)
    /\bSold\s+At\s+\(USPPI\)/i.test(text);        // "Sold At (USPPI):" note
  if (isIAA) return parseIAAReceipt(text, lines, vin, vehicle);

  // ── Customer Name ──────────────────────────────────────────────────────
  // Find "MEMBER: XXXXXX ..." header line, then "LOT: ... SELLER:" sub-header
  // The customer name is the first substantive non-header line after those headers.
  let customerName = "";
  let customerNameLineIdx = -1;

  const memberHeaderIdx = lines.findIndex(l => /MEMBER:\s*\d+/i.test(l));
  // Sub-header: "LOT: SELLER:", "ADDRESS OF LOT:", "ADDRESS OF LOT: SELLER:" etc.
  // Also catches when the PDF splits "PHYSICAL" and "ADDRESS OF LOT:" onto separate lines
  const lotSellerIdx = lines.findIndex(
    (l, i) => i > (memberHeaderIdx >= 0 ? memberHeaderIdx : 0) &&
              (/LOT.*SELLER/i.test(l) || /^LOT:/i.test(l) || /ADDRESS\s+OF\s+LOT/i.test(l))
  );
  const searchFrom = lotSellerIdx >= 0 ? lotSellerIdx + 1
                   : memberHeaderIdx >= 0 ? memberHeaderIdx + 1
                   : 0;

  // Skip lines that are headers/junk, digits-only, or look like auction/insurance names
  // NOTE: \bPHYSICAL\b catches "PHYSICAL" alone (when PDF splits it from "ADDRESS OF LOT:")
  const skipNamePat = /\bPHYSICAL\b|ADDRESS\s+OF\s+LOT|LOT[:#]?|SELLER:|COPART|IAAI|INSURANCE|NATIONWIDE|STATE FARM|GEICO|PROGRESSIVE|ALLSTATE|Sales Receipt|Bill of Sale|^\d+$/i;

  for (let i = searchFrom; i < Math.min(searchFrom + 12, lines.length); i++) {
    const l = lines[i];
    if (skipNamePat.test(l)) continue;
    if (l.length < 3) continue;
    // Skip lines that look like a US street address (starts with number + word)
    if (/^\d+\s+[A-Z]/i.test(l) && l.length < 60) continue;
    customerName = clean(l);
    customerNameLineIdx = i;
    break;
  }

  // Fallback: "123456 – SOME NAME" member pattern
  if (!customerName) {
    const memberLine = lines.find(l => /^\d{6,}\s+[-–]\s+/i.test(l));
    if (memberLine) customerName = clean(memberLine.replace(/^\d+\s*[-–]\s*/, ""));
  }

  // ── Pickup (Physical Address of Lot) ──────────────────────────────────
  // Strategy: scan forward from customer name, past the foreign address block,
  // and find the first US-style street address (starts with digits + street name).
  let pickupName = "";
  let pickupAddress = "";
  let pickupCity = "";
  let pickupState = "";
  let pickupZip = "";

  const scanFrom = customerNameLineIdx >= 0 ? customerNameLineIdx + 1 : searchFrom + 1;

  const junkLinePat = /INSURANCE|SOLD THROUGH|COPART|IAAI/i;
  // Street suffix words that Copart PDFs sometimes wrap onto the next line
  const streetSuffixPat = /^(ROAD|RD|DRIVE|DR|AVENUE|AVE|BOULEVARD|BLVD|STREET|ST|LANE|LN|WAY|HIGHWAY|HWY|COURT|CT|CIRCLE|CIR|PLACE|PL|TRAIL|TERRACE|TER)\s*$/i;

  // Valid US state codes for address validation
  const US_STATES = new Set([
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
    'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
    'TX','UT','VT','VA','WA','WV','WI','WY',
  ]);

  // US street suffix — required to distinguish US addresses from foreign ones.
  // Foreign customer addresses (e.g. "100 KWAKWACI KANOKANO") have no standard suffix.
  const US_STREET_SUFFIX_RX = /\b(STREET|ST|AVENUE|AVE|BOULEVARD|BLVD|ROAD|RD|DRIVE|DR|LANE|LN|WAY|HIGHWAY|HWY|COURT|CT|PLACE|PL|CIRCLE|CIR|TRAIL|TERRACE|TER|PKWY|PARKWAY|PIKE|NE|NW|SE|SW)\b/i;

  // Copart PDFs sometimes jam city+state+zip with no spaces: "WINDSORNJ08561"
  // Build a regex that can peel apart: ([city letters])([2-letter state])(\d{5})
  const STATE_CODES_RX = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
  const concatCSZRx = new RegExp(`^([A-Z]{2,28})(${STATE_CODES_RX})(\\d{5})$`, 'i');
  function parseConcatCSZ(line) {
    const m = clean(line).toUpperCase().match(concatCSZRx);
    if (m && US_STATES.has(m[2].toUpperCase())) return { city: m[1], state: m[2].toUpperCase(), zip: m[3] };
    return null;
  }
  // Try spaced, fully-concatenated, and glued (state+zip jammed onto city end) formats
  function tryParseCSZ(line) {
    // Strip leading commas/spaces that appear in some column-extracted PDFs (e.g. ", FORT PIERCEFL34946")
    const stripped = clean(line).replace(/^[,\s]+/, "").trim();

    // 1. Standard spaced: "FORT PIERCE, FL 34946" or "FORT PIERCE FL 34946"
    const csz = stripped.match(/^(.*?),?\s+([A-Z]{2})\s+(\d{5})\s*$/i);
    if (csz && US_STATES.has(csz[2].toUpperCase())) {
      return { city: cleanUpper(csz[1].trim()), state: csz[2].toUpperCase(), zip: csz[3] };
    }

    // 2. Fully concatenated: "WINDSORNJ08561"
    const concat = parseConcatCSZ(stripped);
    if (concat) return concat;

    // 3. State+zip glued to city: "FORT PIERCEFL34946"
    //    (city may contain spaces but state and zip have no separating whitespace)
    const gluedRx = new RegExp(`^(.{3,}?)(${STATE_CODES_RX})(\\d{5})\\s*$`, 'i');
    const glued = stripped.match(gluedRx);
    if (glued && US_STATES.has(glued[2].toUpperCase())) {
      const city = cleanUpper(glued[1].trim());
      if (city.length >= 2) return { city, state: glued[2].toUpperCase(), zip: glued[3] };
    }

    return null;
  }

  // ── Pass 1: Forward line scan from customer name ───────────────────────
  // Handles normal case where address is on its own line after customer block.
  // KEY: requires a US street suffix in the address line so foreign customer
  // addresses (e.g. "100 KWAKWACI KANOKANO") are skipped.
  for (let i = scanFrom; i < Math.min(scanFrom + 30, lines.length); i++) {
    const l = lines[i];
    // Check for fully-inline "108 NORTH MAIN STREET WINDSOR NJ 08561"
    const inlineMatch = l.match(
      /^(\d{1,5}\s+[A-Z].+?)\s+([A-Z][A-Z ]{1,20}?)\s+([A-Z]{2})\s+(\d{5})\s*$/i
    );
    if (inlineMatch && US_STATES.has(inlineMatch[3].toUpperCase())) {
      pickupAddress = cleanUpper(inlineMatch[1].trim());
      pickupCity    = cleanUpper(inlineMatch[2].trim());
      pickupState   = inlineMatch[3].toUpperCase();
      pickupZip     = inlineMatch[4];
      break;
    }
    // Standard: starts with number + letter, no phone, AND has a recognised US street suffix
    if (/^\d{1,5}\s+[A-Z]/i.test(l) && !/\(\d{3}\)/.test(l) && US_STREET_SUFFIX_RX.test(l)) {
      let tempAddress = cleanUpper(l);
      let tempCity = "", tempState = "", tempZip = "";
      // Append word-wrapped street suffix (e.g. "ROAD" on its own next line)
      for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) {
        const kl = lines[k];
        if (junkLinePat.test(kl)) continue;
        if (streetSuffixPat.test(kl.trim())) tempAddress += " " + cleanUpper(kl.trim());
        break;
      }
      // Scan ahead for city/state/zip — handles both spaced and concatenated formats
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const cszLine = lines[j];
        if (junkLinePat.test(cszLine)) continue;
        const parsed = tryParseCSZ(cszLine);
        if (parsed) {
          tempCity  = parsed.city;
          tempState = parsed.state;
          tempZip   = parsed.zip;
          break;
        }
      }
      // Only commit this address if we found a valid US city — otherwise
      // continue scanning (avoids locking onto a foreign customer address
      // like "596 B RASAKI SALAWU STREET" when the real lot address comes later)
      if (tempCity) {
        pickupAddress = tempAddress;
        pickupCity    = tempCity;
        pickupState   = tempState;
        pickupZip     = tempZip;
        break;
      }
    }
  }

  // ── Pass 2: Raw-text regex — handles address embedded mid-line ─────────
  // PDFs that concatenate table rows produce lines like:
  //   "SAAD AS AND TECH LTD  108 NORTH MAIN STREET  NATIONWIDE INSURANCE"
  // The street address doesn't start the line, so Pass 1 misses it.
  if (!pickupCity) {
    const stTypes = '(?:STREET|ST|ROAD|RD|DRIVE|DR|AVENUE|AVE|BOULEVARD|BLVD|LANE|LN|WAY|HIGHWAY|HWY|COURT|CT|CIRCLE|CIR|PLACE|PL|TERRACE|TER|TRAIL|PKWY|PARKWAY|PIKE|NE|NW|SE|SW)';
    // Spaced CSZ: "WINDSOR NJ 08561"
    const addrRx = new RegExp(
      '\\b(\\d{1,5}\\s+[A-Z][A-Z0-9 ]+?\\s+' + stTypes + ')' +
      '[,\\s\\n\\r]+([A-Z][A-Z ]{1,25}?)[,\\s]+([A-Z]{2})\\s+(\\d{5})\\b', 'i'
    );
    const m = text.match(addrRx);
    if (m && US_STATES.has(m[3].toUpperCase())) {
      pickupAddress = cleanUpper(m[1].trim());
      pickupCity    = cleanUpper(m[2].trim());
      pickupState   = m[3].toUpperCase();
      pickupZip     = m[4];
    }
    // Concatenated CSZ: "WINDSORNJ08561" on the line after the street
    if (!pickupCity) {
      const addrConcatRx = new RegExp(
        '\\b(\\d{1,5}\\s+[A-Z][A-Z0-9 ]+?\\s+' + stTypes + ')[\\s\\n\\r]+' +
        '([A-Z]{2,28})(' + STATE_CODES_RX + ')(\\d{5})\\b', 'i'
      );
      const mc = text.match(addrConcatRx);
      if (mc && US_STATES.has(mc[3].toUpperCase())) {
        pickupAddress = cleanUpper(mc[1].trim());
        pickupCity    = cleanUpper(mc[2].trim());
        pickupState   = mc[3].toUpperCase();
        pickupZip     = mc[4];
      }
    }
  }

  // ── Pass 3: CSZ-anchor backward scan — whole document ─────────────────
  // Handles PDFs where columns are printed sequentially so the city/state/zip
  // line appears after the street address line with no other text in between.
  // Also handles concatenated CSZ lines like "WINDSORNJ08561".
  if (!pickupCity) {
    for (let j = 0; j < lines.length; j++) {
      const cszParsed = tryParseCSZ(lines[j]);
      if (!cszParsed) continue;
      for (let k = j - 1; k >= Math.max(j - 12, 0); k--) {
        if (/^\d{1,5}\s+[A-Z]/i.test(lines[k]) && !/\(\d{3}\)/.test(lines[k]) && US_STREET_SUFFIX_RX.test(lines[k])) {
          pickupAddress = cleanUpper(lines[k]);
          pickupCity    = cszParsed.city;
          pickupState   = cszParsed.state;
          pickupZip     = cszParsed.zip;
          break;
        }
      }
      if (pickupCity) break;
    }
  }

  // ── Pass 4: Copart "SOLD THROUGH COPART" anchor ──────────────────────────
  // The Seller column in Copart PDFs always re-prints the physical lot address
  // directly after "SOLD THROUGH COPART". This is the most reliable extraction
  // path when the three-column layout confuses the line-scan passes above.
  if (!pickupCity) {
    const soldIdx = lines.findIndex(l => /SOLD\s+THROUGH\s+COPART/i.test(l));
    if (soldIdx >= 0) {
      for (let j = soldIdx + 1; j < Math.min(soldIdx + 6, lines.length); j++) {
        const l = lines[j];
        if (!l || junkLinePat.test(l)) continue;
        if (/^\d{1,5}\s+[A-Z]/i.test(l) && US_STREET_SUFFIX_RX.test(l)) {
          pickupAddress = cleanUpper(l);
          for (let k = j + 1; k < Math.min(j + 4, lines.length); k++) {
            const parsed = tryParseCSZ(lines[k]);
            if (parsed) {
              pickupCity  = parsed.city;
              pickupState = parsed.state;
              pickupZip   = parsed.zip;
              break;
            }
          }
          if (pickupCity) break;
        }
      }
    }
  }

  // Build pickup name
  if (pickupCity) {
    pickupName = `COPART ${pickupCity} ${pickupState}`.trim();
  } else if (pickupAddress) {
    // Found address but couldn't parse city — still label it COPART
    pickupName = "COPART";
  } else {
    // Last-resort: search for COPART/IAAI line, but ONLY short lines (not legal text)
    // and only after the MEMBER section so we don't grab boilerplate
    const sectionStart = memberHeaderIdx >= 0 ? memberHeaderIdx : searchFrom;
    const copartLine = lines.slice(sectionStart).find(l =>
      /\bCOPART\b|\bIAAI\b/i.test(l) &&
      l.length < 60 &&                        // legal lines are very long
      !/INDEMNIFY|LOADING AND|FROM ANY CLAIM|TRANSPORT|EXPORT FROM|LISTED AS/i.test(l)
    );
    if (copartLine) pickupName = cleanUpper(copartLine);
  }
  const pickupLocation = pickupName || pickupAddress || "";

  // ── Phone / email ──────────────────────────────────────────────────────
  let phone = "";
  let email = "";
  const phoneMatch = text.match(/(?:Phone|Tel|Cell)[:\s]*([\d()\s\-+]{7,20})/i);
  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (phoneMatch) phone = clean(phoneMatch[1]);
  if (emailMatch) email = emailMatch[0];

  // Lot number — IAA StockNo "000-44707958" → "44707958", Copart "LOT# 12345678"
  let lotNumber = "";
  const iaaStockMatch = text.match(/\b000-(\d{8})/);   // IAA: strip "000-" prefix, no trailing \b (digits may be concatenated)
  const lotNumMatch   = text.match(/LOT[#:\s]+(\d{5,12})/i);
  if (iaaStockMatch) {
    lotNumber = iaaStockMatch[1];
  } else if (lotNumMatch) {
    lotNumber = lotNumMatch[1];
  } else {
    // Try to find it near the lot/seller header line
    if (lotSellerIdx >= 0) {
      const lotLine = lines[lotSellerIdx];
      const m = lotLine.match(/(\d{5,12})/);
      if (m) lotNumber = m[1];
    }
  }

  // ── Vehicle year/make/model ───────────────────────────────────────────────
  // Copart receipts have a dedicated "VEHICLE: YEAR MAKE MODEL COLOR" line.
  // Try that first — much more reliable than the generic extractVehicleData pattern
  // which false-matches years embedded in dates (e.g. "05/15/2026 MEMBER AGREES…").
  let year = vehicle.year, make = vehicle.make, model = vehicle.model;
  const copartVehicleLine = text.match(/VEHICLE:\s*(\d{4})\s+([A-Z0-9]+)\s+([A-Z0-9 \-/]+?)(?:\s+(?:PHY\s+YARD|PHY:|KEYS?:|SALE\s+YARD|ROW:|ITEM#|BLACK|WHITE|SILVER|RED|BLUE|GREEN|GREY|GRAY|BROWN|YELLOW|ORANGE|GOLD|BURGUNDY|PURPLE|TAN|MAROON|BEIGE|CHAMPAGNE|$))/i);
  if (copartVehicleLine) {
    year  = clean(copartVehicleLine[1]);
    make  = clean(copartVehicleLine[2]);
    model = clean(copartVehicleLine[3]).replace(/\s+/g, " ").trim();
  }

  return {
    customerName,
    customerPhone: phone,
    customerEmail: email,
    vin,
    year,
    make,
    model,
    lotNumber,
    pickupLocation,
    pickupName,
    pickupAddress,
    pickupCity,
    pickupState,
    pickupZip,
  };
}

module.exports = {
  parseAES,
  parseDispatch,
  parseBuyerReceipt,
};
