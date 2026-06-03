const express = require("express");
const router = express.Router();
const pdfParse = require("pdf-parse");
const XLSX = require("xlsx");
const multer = require("multer");
const ScheduleRow = require("../models/Schedule");
const { execFile } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

// multer: store uploads in memory so we can access req.file.buffer
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanStr(v) {
  return (v || "").toString().replace(/\s+/g, " ").trim();
}

function normalizePolPod(v) {
  const u = cleanStr(v).toUpperCase();
  if (u.includes("BALTIMORE") || u.includes("LOCUST") || u.includes("TRADEPOINT") || u.includes("SOUTH LOC")) return "BALTIMORE";
  if (u.includes("DAVISVILLE") || u.includes("NORAD") || u.includes("PROVIDENCE")) return "PROVIDENCE";
  if (u.includes("JACKSONVILLE") || u.includes("JAX")) return "JACKSONVILLE";
  if (u.includes("FREEPORT")) return "FREEPORT";
  if (u.includes("WILMINGTON")) return "WILMINGTON";
  if (u.includes("BRUNSWICK")) return "BRUNSWICK";
  if (u.includes("NEWARK")) return "NEWARK";
  if (u.includes("LAGOS")) return "LAGOS";
  if (u.includes("TEMA")) return "TEMA";
  if (u.includes("COTONOU")) return "COTONOU";
  if (u.includes("LOME") || u.includes("LOMÉ")) return "LOME";
  if (u.includes("DAKAR")) return "DAKAR";
  if (u.includes("DURBAN")) return "DURBAN";
  return u;
}

function parseDateStr(str) {
  // Handles: "20 April 2026", "2-Jun", "5/21", "May 20, 2026", "20-Apr"
  if (!str || str === "N/A" || str === "OMIT" || str.toLowerCase().includes("t/s")) return "";

  const monthMap = {
    jan: "1", feb: "2", mar: "3", apr: "4", may: "5", jun: "6",
    jul: "7", aug: "8", sep: "9", oct: "10", nov: "11", dec: "12",
  };

  const s = str.trim();

  // "20 April 2026" or "2 June 2026"
  const longMatch = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (longMatch) {
    const m = monthMap[longMatch[2].slice(0, 3).toLowerCase()] || longMatch[2];
    return `${m}/${longMatch[1]}/${longMatch[3]}`;
  }

  // "20-Apr" or "20-April"
  const dashMatch = s.match(/^(\d{1,2})-([A-Za-z]+)$/);
  if (dashMatch) {
    const m = monthMap[dashMatch[2].slice(0, 3).toLowerCase()] || dashMatch[2];
    return `${m}/${dashMatch[1]}/2026`;
  }

  // "5/21" (m/d)
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) return `${slashMatch[1]}/${slashMatch[2]}/2026`;

  // "5/21/2026"
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;

  return s;
}

// ─── Strip HTML tags ───────────────────────────────────────────────────────────
function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ─── Parse HTML table rows (handles colspan) ───────────────────────────────────
function parseHTMLRows(html) {
  const rows = [];
  const trMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

  for (const trMatch of trMatches) {
    const rowHtml = trMatch[1];
    const cells = [];
    const tdMatches = [...rowHtml.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)];

    for (const tdMatch of tdMatches) {
      const attrs = tdMatch[1];
      const content = stripTags(tdMatch[2]);
      const colspanMatch = attrs.match(/colspan="?(\d+)"?/i);
      const colspan = colspanMatch ? parseInt(colspanMatch[1]) : 1;
      cells.push(content);
      for (let i = 1; i < colspan; i++) cells.push("");
    }

    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

// ─── SALLAUM: Fetch from website & parse ──────────────────────────────────────

async function fetchAndParseSallaum() {
  const res = await fetch("https://sallaumlines.com/schedules/us-to-west-africa/");
  if (!res.ok) throw new Error(`Sallaum website returned ${res.status}`);
  const html = await res.text();

  const rows = parseHTMLRows(html);

  // Find the schedule table: look for row containing vessel names (has "Cut-Off" later)
  let startRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = rows[i].join(" ").toLowerCase();
    if (joined.includes("cut-off") || joined.includes("cut off") || joined.includes("platinum") || joined.includes("ocean breeze")) {
      startRow = i;
      break;
    }
  }
  if (startRow === -1) throw new Error("Could not find schedule table in Sallaum page");

  // Row 0 of table: vessel names (at odd columns)
  // Row 1: voyage numbers
  // Row 2: Cut-Off | ETA headers (identifies column pattern)

  const tableRows = rows.slice(startRow);

  // Extract vessels and voyages
  const vessels = [];
  const voyages = [];

  // Find the vessel name row and voyage row
  let vesselRowIdx = -1, voyageRowIdx = -1, headerRowIdx = -1;

  for (let i = 0; i < Math.min(10, tableRows.length); i++) {
    const joined = tableRows[i].join(" ");
    if (joined.match(/platinum|ocean breeze|silver soul|glovis|rcc amsterdam|liberty peace/i)) {
      vesselRowIdx = i;
    }
    if (joined.match(/26[A-Z]{2}\d{2}/i)) {
      voyageRowIdx = i;
    }
    if (joined.toLowerCase().includes("cut-off") || joined.toLowerCase().includes("cut off")) {
      headerRowIdx = i;
      break;
    }
  }

  if (vesselRowIdx === -1 || headerRowIdx === -1) {
    throw new Error("Cannot identify vessel/header rows in Sallaum schedule");
  }

  const vesselRow = tableRows[vesselRowIdx];
  const voyageRow = voyageRowIdx !== -1 ? tableRows[voyageRowIdx] : [];

  // Vessels are at odd column indices (1, 3, 5, ...) - each spanning 2 cols
  // Count how many vessels
  for (let col = 1; col < vesselRow.length; col += 2) {
    const name = cleanStr(vesselRow[col]);
    if (name && name.toLowerCase() !== "cut-off" && name.toLowerCase() !== "eta") {
      vessels.push(name.toUpperCase());
      const voyage = cleanStr(voyageRow[col] || "").toUpperCase();
      voyages.push(voyage);
    }
  }

  const numVessels = vessels.length;
  if (numVessels === 0) throw new Error("No vessels found in Sallaum schedule");

  // Parse data rows
  const polRows = {}; // polName -> [{ cutoff, sail }] indexed by vessel
  const podRows = {}; // podName -> [arrival] indexed by vessel

  let mode = null; // 'POL' | 'POD'

  for (let i = headerRowIdx + 1; i < tableRows.length; i++) {
    const cells = tableRows[i];
    if (!cells || cells.length === 0) continue;

    const rowLabel = cleanStr(cells[0]).toUpperCase();

    if (rowLabel.includes("PORT") && rowLabel.includes("LOADING")) {
      mode = "POL";
      continue;
    }
    if (rowLabel.includes("PORT") && rowLabel.includes("DISCHARGE")) {
      mode = "POD";
      continue;
    }
    if (rowLabel.includes("LAST UPDATED") || rowLabel.includes("PLEASE NOTE")) continue;
    if (!rowLabel || !mode) continue;

    const portName = normalizePolPod(cells[0]);

    if (mode === "POL") {
      polRows[portName] = [];
      for (let v = 0; v < numVessels; v++) {
        const cutoffCol = 1 + v * 2;
        const sailCol = 2 + v * 2;
        const cutoff = parseDateStr(cells[cutoffCol] || "");
        const sail = parseDateStr(cells[sailCol] || "");
        polRows[portName].push({ cutoff, sail });
      }
    } else if (mode === "POD") {
      podRows[portName] = [];
      for (let v = 0; v < numVessels; v++) {
        const cutoffCol = 1 + v * 2; // empty for POD
        const arrivalCol = 2 + v * 2;
        const arrival = parseDateStr(cells[arrivalCol] || "");
        podRows[portName].push(arrival);
      }
    }
  }

  // Build schedule rows: vessel × POL × POD
  const scheduleRows = [];
  const now = new Date();

  for (let v = 0; v < numVessels; v++) {
    const vessel = vessels[v];
    const voyage = voyages[v];

    for (const pol of Object.keys(polRows)) {
      const { cutoff, sail } = polRows[pol][v] || {};
      if (!cutoff && !sail) continue; // vessel doesn't call this POL

      for (const pod of Object.keys(podRows)) {
        const arrival = podRows[pod][v] || "";
        if (!arrival) continue; // vessel doesn't serve this POD

        scheduleRows.push({
          carrier: "SALLAUM",
          vessel,
          voyage,
          pol,
          pod,
          cutoffDate: cutoff || "",
          sailDate: sail || "",
          arrivalDate: arrival,
          updatedAt: now,
        });
      }
    }
  }

  return scheduleRows;
}

// ─── ACL / Grimaldi: Fetch from website XLS ──────────────────────────────────
//
// Strategy:
//   1. Fetch the Grimaldi NW schedule HTML page
//   2. Extract the XLS download link for the current week
//   3. Parse XLS → get vessel, voyage, POL ETS (sail), POD ETA (arrival) per vessel
//   4. Store rows WITHOUT cutoff dates (website doesn't have them)
//
// Cutoffs come from the ACL PDF (separate upload step).

const GRIMALDI_BASE = "https://www.gnet.grimaldi-eservice.com";
const GRIMALDI_SCHED_URL = `${GRIMALDI_BASE}/webdata/Published_Sched_Fleetpos/sched_nw.htm`;

// NA-WA POLs and PODs we care about
const NA_POLS = ["BALTIMORE", "JACKSONVILLE", "PROVIDENCE", "FREEPORT", "WILMINGTON", "BRUNSWICK"];
const WA_PODS = ["LAGOS", "COTONOU", "LOME", "TEMA", "DAKAR"];

// Fetch with timeout helper
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGrimaldiSchedule() {
  const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
  };

  // 1. Get the schedule page HTML
  let pageRes;
  try {
    pageRes = await fetchWithTimeout(GRIMALDI_SCHED_URL, { headers: HEADERS }, 15000);
  } catch (e) {
    throw new Error(`Cannot reach Grimaldi website: ${e.message}. Try uploading the ACL PDF directly instead.`);
  }

  if (!pageRes.ok) {
    throw new Error(`Grimaldi page returned HTTP ${pageRes.status}. Try uploading the ACL PDF directly instead.`);
  }

  const html = await pageRes.text();

  // Safety check — make sure we got an HTML page, not a redirect to a login wall
  if (!html.includes("<html") && !html.includes("<HTML")) {
    throw new Error("Grimaldi returned unexpected content (not HTML). Try uploading the ACL PDF directly.");
  }

  // 2. Find XLS download link — pattern: sched_NW_WEEK{N}.xls or sched_nw.xls
  const xlsMatch = html.match(/href="([^"]*sched_n[^"]*\.xls[^"]*)"/i)
    || html.match(/href="([^"]*sched_NW[^"]*\.xls[^"]*)"/i);

  if (!xlsMatch) {
    // Log snippet for debugging
    const snippet = html.slice(0, 500);
    console.error("[ACL] Grimaldi HTML snippet:", snippet);
    throw new Error("Cannot find XLS link on Grimaldi schedule page. The page layout may have changed. Try uploading the ACL PDF directly.");
  }

  const xlsPath = xlsMatch[1];
  const xlsUrl = xlsPath.startsWith("http") ? xlsPath : `${GRIMALDI_BASE}${xlsPath}`;
  console.log("[ACL] Downloading Grimaldi XLS:", xlsUrl);

  // 3. Download XLS
  let xlsRes;
  try {
    xlsRes = await fetchWithTimeout(xlsUrl, { headers: HEADERS }, 20000);
  } catch (e) {
    throw new Error(`Grimaldi XLS download timed out: ${e.message}`);
  }

  if (!xlsRes.ok) throw new Error(`Grimaldi XLS download failed: ${xlsRes.status}`);

  const xlsBuffer = Buffer.from(await xlsRes.arrayBuffer());
  console.log("[ACL] Grimaldi XLS downloaded, size:", xlsBuffer.length);
  return parseGrimaldiXls(xlsBuffer);
}

function parseGrimaldiXls(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const rows = [];

  // Grimaldi XLS may have multiple sheets — process all
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    // Structure: header rows contain vessel names and voyage codes
    // Port rows have ETA/ETS dates per column
    // We need to detect:
    //  - Vessel name rows (contain "Grande ...")
    //  - Voyage code rows (pattern like GLG0326)
    //  - ETA/ETS header row
    //  - Port data rows

    let vessels = [];
    let voyages = [];
    let colPairs = []; // [{etaCol, etsCol}] per vessel

    let inNaWaSection = false;

    for (let r = 0; r < raw.length; r++) {
      const row = raw[r].map(c => cleanStr(String(c)));
      const joined = row.join(" ").toUpperCase();

      // Detect "North America" or "West Africa" service header
      if (joined.includes("NORTH AMERICA") && joined.includes("WEST AFRICA")) {
        inNaWaSection = true;
        vessels = [];
        voyages = [];
        colPairs = [];
        continue;
      }

      if (!inNaWaSection) continue;

      // Vessel name row: cells contain "Grande ..." names
      if (row.some(c => /^Grande\s+\w+/i.test(c))) {
        vessels = row.filter(c => /^Grande\s+\w+/i.test(c)).map(c => c.toUpperCase());
        continue;
      }

      // Voyage code row: cells match voyage code pattern
      if (row.some(c => /^[A-Z]{3}\d{4}$/i.test(c))) {
        voyages = row.filter(c => /^[A-Z]{3}\d{4}$/i.test(c)).map(c => c.toUpperCase());
        continue;
      }

      // ETA/ETS header row — build column pair map
      if (row.some(c => c.toUpperCase() === "ETA") && row.some(c => c.toUpperCase() === "ETS")) {
        colPairs = [];
        for (let c = 0; c < row.length - 1; c++) {
          if (row[c].toUpperCase() === "ETA" && row[c + 1].toUpperCase() === "ETS") {
            colPairs.push({ etaCol: c, etsCol: c + 1 });
          }
        }
        continue;
      }

      // Port data row: first non-empty cell is port name, rest are dates
      if (colPairs.length === 0 || vessels.length === 0) continue;

      const portName = row.find(c => c && !/^\d/.test(c) && !/^ETA|ETS$/i.test(c)) || "";
      if (!portName || portName.length < 3) continue;

      const normPort = normalizePolPod(portName);
      const isNaPol = NA_POLS.includes(normPort);
      const isWaPod = WA_PODS.includes(normPort);

      if (!isNaPol && !isWaPod) continue;

      // Extract ETA/ETS per vessel column
      for (let v = 0; v < Math.min(vessels.length, colPairs.length, voyages.length); v++) {
        const { etaCol, etsCol } = colPairs[v];
        const eta = formatXlsDate(raw[r][etaCol]);
        const ets = formatXlsDate(raw[r][etsCol]);

        if (!eta && !ets) continue;

        rows.push({
          vessel: vessels[v],
          voyage: voyages[v],
          port: normPort,
          isNaPol,
          isWaPod,
          eta,  // arrival at port (for POLs: when ship arrives; for PODs: destination arrival)
          ets,  // departure from port (sail date at POL; empty at POD)
        });
      }
    }
  }

  // Build schedule rows: for each vessel, cross-join POLs with PODs
  const vesselVoyages = [...new Set(rows.map(r => `${r.vessel}|${r.voyage}`))];
  const scheduleRows = [];
  const now = new Date();

  for (const vv of vesselVoyages) {
    const [vessel, voyage] = vv.split("|");
    const vesselRows = rows.filter(r => r.vessel === vessel && r.voyage === voyage);

    const pols = vesselRows.filter(r => r.isNaPol);
    const pods = vesselRows.filter(r => r.isWaPod);

    for (const pol of pols) {
      for (const pod of pods) {
        scheduleRows.push({
          carrier: "ACL",
          vessel,
          voyage,
          pol: pol.port,
          pod: pod.port,
          cutoffDate: "",       // filled in later from PDF
          sailDate: pol.ets || pol.eta,  // ETS = sail date from POL
          arrivalDate: pod.eta, // ETA = arrival at destination
          updatedAt: now,
        });
      }
    }
  }

  return scheduleRows;
}

function formatXlsDate(val) {
  if (!val && val !== 0) return "";
  // If already a Date object (cellDates: true)
  if (val instanceof Date) {
    return `${val.getMonth() + 1}/${val.getDate()}/${val.getFullYear()}`;
  }
  // Serial number
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.m}/${d.d}/${d.y}`;
  }
  // String like "06/06" (DD/MM) or "6/6/2026"
  const s = String(val).trim();
  // DD/MM format (Grimaldi uses this)
  const ddmm = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (ddmm) {
    const day = parseInt(ddmm[1]);
    const month = parseInt(ddmm[2]);
    return `${month}/${day}/2026`; // assume current year
  }
  return parseDateStr(s);
}

// ─── ACL: Standalone PDF parser — works without Grimaldi website data ─────────
//
// Parses the ACL Week schedule PDF directly:
//   POL rows: each line has alternating ETA + "Latest Delivery" (cutoff) date pairs
//   POD rows: each line has ETA-only dates per vessel
//   Bottom:   voyage codes (e.g. GLG0426) with vessel name prefixes we can decode
//
// Since pdf-parse can't give column positions, OMIT cells are invisible.
// We cross-join POL pairs with POD ETAs using geographic crossing-time windows.

// Voyage code prefix → vessel name
const VESSEL_PREFIX = {
  GLG: "GRANDE LAGOS", GSI: "GRANDE SICILIA", GDK: "GRANDE DAKAR",
  GPO: "GRANDE PORTOGALLO", GCT: "GRANDE COTONOU", GTE: "GRANDE TEMA",
  GAB: "GRANDE ABIDJAN", GLA: "GRANDE LAGOS", GNA: "GRANDE NAPOLI",
};

// Typical crossing days from any US POL to each West Africa POD
const POL_POD_CROSSING = {
  DAKAR:   [11, 17],
  LAGOS:   [14, 22],
  COTONOU: [16, 25],
  LOME:    [16, 25],
  TEMA:    [16, 25],
};

async function parseAclPdfStandalone(buffer) {
  const { text } = await pdfParse(buffer);
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const DATE_RE = /\d{1,2}\/\d{1,2}/g;

  // ── Extract week label for voyage placeholder ─────────────────────────────
  const weekMatch = text.match(/Week\s*(\d+)/i);
  const weekLabel = weekMatch ? `WEEK${weekMatch[1]}` : "ACL";

  // ── Extract POL date pairs and POD ETAs ───────────────────────────────────
  const polData = {};  // pol → [{sail, cutoff}]
  const podData = {};  // pod → [eta, ...]
  let mode = null;

  for (const line of lines) {
    if (/^POLETA/i.test(line) || /^POL\s+ETA/i.test(line)) { mode = "POL"; continue; }
    if (/^PODETA/i.test(line) || /^POD\s+ETA/i.test(line)) { mode = "POD"; continue; }
    if (/^Please note|^Other ports|^Shaded/i.test(line)) { mode = null; continue; }

    if (mode === "POL" && /^(Freeport|Jacksonville|Baltimore|Wilmington|Providence)/i.test(line)) {
      const pol = normalizePolPod(line.match(/^(Freeport|Jacksonville|Baltimore|Wilmington|Providence)/i)[0]);
      const dates = [...line.matchAll(DATE_RE)].map(m => parseDateStr(m[0]));
      if (!polData[pol]) polData[pol] = [];
      // Dates alternate: ETA, Cutoff, ETA, Cutoff, ...
      for (let i = 0; i + 1 < dates.length; i += 2) {
        polData[pol].push({ sail: dates[i], cutoff: dates[i + 1] });
      }
    }

    if (mode === "POD" && /^(Dakar|Lagos|Cotonou|Lome|Tema)/i.test(line)) {
      const pod = normalizePolPod(line.match(/^(Dakar|Lagos|Cotonou|Lome|Tema)/i)[0]);
      // Strip t/s entries before extracting dates
      const stripped = line.replace(/t\/s\s+via\s+\w+/gi, "");
      const dates = [...stripped.matchAll(DATE_RE)].map(m => parseDateStr(m[0]));
      if (!podData[pod]) podData[pod] = [];
      podData[pod].push(...dates);
    }
  }

  // ── Extract voyage codes and infer vessel names from prefix ───────────────
  const voyageCodes = [];
  const vesselForVoyage = {};

  for (let i = 0; i < lines.length; i++) {
    const codeMatch = lines[i].match(/^([A-Z]{3}\d{4})$/);
    if (codeMatch) {
      const code = codeMatch[1];
      if (!voyageCodes.includes(code)) voyageCodes.push(code);
      // Prefer explicit vessel name on previous line
      if (i > 0 && /^Grande/i.test(lines[i - 1])) {
        vesselForVoyage[code] = lines[i - 1].toUpperCase();
      }
      // Fallback: decode from prefix
      if (!vesselForVoyage[code]) {
        const prefix = code.slice(0, 3).toUpperCase();
        if (VESSEL_PREFIX[prefix]) vesselForVoyage[code] = VESSEL_PREFIX[prefix];
      }
    }
    // Also handle codes merged on same line: "GLG0426GSI0526"
    const inlineCodes = [...lines[i].matchAll(/\b([A-Z]{3}\d{4})\b/g)];
    for (const m of inlineCodes) {
      const code = m[1];
      if (!voyageCodes.includes(code)) {
        voyageCodes.push(code);
        const prefix = code.slice(0, 3).toUpperCase();
        if (VESSEL_PREFIX[prefix] && !vesselForVoyage[code]) {
          vesselForVoyage[code] = VESSEL_PREFIX[prefix];
        }
      }
    }
  }

  console.log(`[ACL PDF] POLs: ${Object.keys(polData).join(", ")}`);
  console.log(`[ACL PDF] PODs: ${Object.keys(podData).join(", ")}`);
  console.log(`[ACL PDF] Voyage codes found: ${voyageCodes.join(", ")}`);

  // ── Cross-join POL pairs with POD ETAs using crossing-time window ─────────
  // For each (pol, sail, cutoff) pair, find a POD ETA that fits geographically.
  // Greedy: consume each POD ETA once per POL (same vessel calls multiple POLs,
  // so the SAME POD ETA can legitimately appear for different POLs).

  const scheduleRows = [];
  const now = new Date();

  for (const [pol, pairs] of Object.entries(polData)) {
    // Per-POD available ETAs (reset for each POL — same vessel = same POD ETA reusable)
    const podEtaPool = {};
    for (const [pod, etas] of Object.entries(podData)) {
      podEtaPool[pod] = [...etas];
    }

    for (const { sail, cutoff } of pairs) {
      const sailMs = parseMMDD(sail);
      if (!sailMs) continue;

      for (const [pod, etaPool] of Object.entries(podEtaPool)) {
        const [minDays, maxDays] = POL_POD_CROSSING[pod] || [14, 22];

        const etaIdx = etaPool.findIndex(eta => {
          const etaMs = parseMMDD(eta);
          if (!etaMs) return false;
          const days = (etaMs - sailMs) / 86400000;
          return days >= minDays && days <= maxDays;
        });

        if (etaIdx !== -1) {
          const arrivalDate = etaPool[etaIdx];
          etaPool.splice(etaIdx, 1); // consume so next pair gets next ETA

          scheduleRows.push({
            carrier: "ACL",
            vessel: "ACL",          // generic — vessel name unknown without Grimaldi XLS
            voyage: weekLabel,
            pol,
            pod,
            cutoffDate: cutoff,
            sailDate: sail,
            arrivalDate,
            updatedAt: now,
          });
        }
      }
    }
  }

  console.log(`[ACL PDF] Built ${scheduleRows.length} schedule rows standalone`);
  return { scheduleRows, voyageCodes, vesselForVoyage, polData, podData };
}

// Parse M/D/YYYY or M/D (assume 2026) date string to ms timestamp
function parseMMDD(str) {
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return null;
  const year = m[3] ? parseInt(m[3]) : 2026;
  return new Date(year, parseInt(m[1]) - 1, parseInt(m[2])).getTime();
}

// ─── ACL PDF → Python parser helper ──────────────────────────────────────────
//
// Runs parse_acl_pdf.py (pdfplumber) as a child process.
// Returns { scheduleRows, rowCount } on success; throws on failure.

function parseAclPdfWithPython(buffer) {
  return new Promise((resolve, reject) => {
    const tmpPath = path.join(os.tmpdir(), `acl_sched_${Date.now()}.pdf`);
    try { fs.writeFileSync(tmpPath, buffer); } catch (e) { return reject(e); }

    const scriptPath = path.join(__dirname, "..", "parse_acl_pdf.py");

    // Try "python" first (Windows), fallback to "python3" (Linux/Mac)
    const tryExec = (cmd) => {
      execFile(cmd, [scriptPath, tmpPath], { timeout: 45000 }, (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpPath); } catch {}

        if (err) {
          // If "python" not found, retry with "python3"
          if (cmd === "python" && (err.code === "ENOENT" || (stderr || "").includes("not found"))) {
            return tryExec("python3");
          }
          return reject(new Error(`PDF parse script error: ${stderr || err.message}`));
        }

        let result;
        try { result = JSON.parse(stdout); } catch {
          return reject(new Error(`Bad JSON from PDF parser: ${stdout.slice(0, 300)}`));
        }

        if (result.error) return reject(new Error(result.error));
        resolve(result);
      });
    };

    tryExec("python");
  });
}

// ─── Excel Schedule Parser (existing Excel upload) ────────────────────────────

function parseExcelSchedule(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows = [];
  wb.SheetNames.forEach(name => {
    rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[name]));
  });
  return rows;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/schedule/status  - status of both carriers
router.get("/status", async (req, res) => {
  try {
    const sallaum = await ScheduleRow.findOne({ carrier: "SALLAUM" }).sort({ updatedAt: -1 });
    const acl = await ScheduleRow.findOne({ carrier: "ACL" }).sort({ updatedAt: -1 });
    const sallaumCount = await ScheduleRow.countDocuments({ carrier: "SALLAUM" });
    const aclCount = await ScheduleRow.countDocuments({ carrier: "ACL" });

    res.json({
      sallaum: {
        loaded: !!sallaum,
        rows: sallaumCount,
        updatedAt: sallaum?.updatedAt || null,
      },
      acl: {
        loaded: !!acl,
        rows: aclCount,
        updatedAt: acl?.updatedAt || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/schedule/refresh-sallaum  - fetch from sallaumlines.com
router.post("/refresh-sallaum", async (req, res) => {
  try {
    const rows = await fetchAndParseSallaum();

    if (rows.length === 0) {
      return res.status(400).json({ error: "No schedule rows parsed from Sallaum website" });
    }

    // Replace all Sallaum rows
    await ScheduleRow.deleteMany({ carrier: "SALLAUM" });
    await ScheduleRow.insertMany(rows);

    res.json({
      message: `Sallaum schedule updated from website`,
      rows: rows.length,
      updatedAt: new Date(),
    });
  } catch (err) {
    console.error("SALLAUM REFRESH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/schedule/refresh-acl  - fetch from Grimaldi website XLS (no cutoffs)
router.post("/refresh-acl", async (req, res) => {
  try {
    const rows = await fetchGrimaldiSchedule();

    if (rows.length === 0) {
      return res.status(400).json({ error: "No schedule rows parsed from Grimaldi website" });
    }

    await ScheduleRow.deleteMany({ carrier: "ACL" });
    await ScheduleRow.insertMany(rows);

    res.json({
      message: `ACL/Grimaldi schedule updated from website (sail dates + arrivals — upload PDF to add cutoffs)`,
      rows: rows.length,
      updatedAt: new Date(),
      hasCutoffs: false,
    });
  } catch (err) {
    console.error("ACL REFRESH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/schedule/upload-acl-pdf  - parse ACL weekly PDF (standalone, no Grimaldi needed)
// Uses parse_acl_pdf.py (pdfplumber) to extract vessel / voyage / pol / pod / dates
// directly from the column-aligned PDF table.
router.post("/upload-acl-pdf", upload.single("schedule"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    const result = await parseAclPdfWithPython(req.file.buffer);
    const { scheduleRows } = result;

    if (!scheduleRows || scheduleRows.length === 0) {
      return res.status(400).json({
        error: "No schedule rows found in PDF. Make sure this is an ACL/Grimaldi weekly RoRo schedule PDF.",
      });
    }

    const now = new Date();
    const rows = scheduleRows.map(r => ({ ...r, updatedAt: now }));

    await ScheduleRow.deleteMany({ carrier: "ACL" });
    await ScheduleRow.insertMany(rows);

    console.log(`[ACL] Loaded ${rows.length} schedule rows from PDF`);

    res.json({
      message: `ACL schedule loaded from PDF — ${rows.length} routes`,
      rows: rows.length,
      updatedAt: now,
    });
  } catch (err) {
    console.error("ACL PDF UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── SALLAUM: Parse PDF directly ─────────────────────────────────────────────
// Reads the Sallaum weekly schedule PDF and builds schedule rows from the text.
// Strategy:
//   1. Find voyage codes + vessel names from header section
//   2. Parse POL rows (alternating Cut Off / ETA pairs per column)
//   3. Parse POD rows (one ETA per column)
//   4. Use sailing-time scoring to map voyage codes → visual columns
//   5. Build schedule rows

const SALLAUM_CROSSING = { // typical transit days from US POL departure to POD arrival
  COTONOU: [24, 36], LOME: [24, 36], LAGOS: [22, 34],
  DURBAN: [38, 55],  DAKAR: [15, 22], TEMA: [24, 36], ABIDJAN: [24, 36],
};

async function parseSallaumPdfDirect(buffer) {
  const { text } = await pdfParse(buffer);
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const VOYAGE_RE = /\b(2[0-9][A-Z]{2}\d{2})\b/g;

  // ── 1. Collect voyage codes (in text order) and vessel names ────────────────
  const voyageCodes = [];       // ordered as they appear in text
  const vesselForVoyage = {};   // voyage -> vessel name

  for (let i = 0; i < lines.length; i++) {
    const codes = [...lines[i].matchAll(VOYAGE_RE)].map(m => m[1]);
    for (const code of codes) {
      if (!voyageCodes.includes(code)) {
        voyageCodes.push(code);
        // Vessel name is usually on the line immediately before the voyage code
        for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
          const prev = lines[j];
          if (/^[A-Z][a-z]/.test(prev) && !prev.match(VOYAGE_RE) && !/\d{3}\s*MT|^\d/.test(prev)) {
            vesselForVoyage[code] = prev.toUpperCase();
            break;
          }
        }
      }
    }
  }

  // Match unassigned vessel names to unmatched voyage codes
  const usedNames = new Set(Object.values(vesselForVoyage));
  const orphanNames = [];
  for (const line of lines) {
    if (/^[A-Z][a-z]/.test(line) && !line.match(VOYAGE_RE) && !/\d{3}\s*MT|MT$|^\d|8\.10|5\.15/i.test(line)
        && !usedNames.has(line.toUpperCase()) && !orphanNames.includes(line.toUpperCase())) {
      orphanNames.push(line.toUpperCase());
    }
  }
  const unmatchedCodes = voyageCodes.filter(c => !vesselForVoyage[c]);
  unmatchedCodes.forEach((c, i) => { if (orphanNames[i]) vesselForVoyage[c] = orphanNames[i]; });

  // ── 2. Parse POL rows ───────────────────────────────────────────────────────
  const POL_RE = /^(Freeport|Jacksonville|Baltimore\s+(?:Tradepoint|South\s+Locus\s+Point)|Brunswick\s+GA|NORAD\s+Davisville)/i;
  const TOKEN_RE = /\b(\d{1,2}-[A-Za-z]{3}|N\/A)\b/g;

  const polData = {};   // pol -> [{cutoff, sail}] per visual column
  const podData = {};   // pod -> [arrival] per visual column
  let mode = null;

  for (const line of lines) {
    if (/^POL\s+Cut\s+Off/i.test(line)) { mode = "POL"; continue; }
    if (/^POD$/i.test(line))            { mode = "POD"; continue; }
    if (!mode) continue;

    if (mode === "POL") {
      const m = line.match(POL_RE);
      if (!m) continue;
      const pol = normalizePolPod(m[0]);
      const tokens = [...line.matchAll(TOKEN_RE)].map(t => t[1]);
      polData[pol] = [];
      for (let i = 0; i + 1 < tokens.length; i += 2) {
        polData[pol].push({
          cutoff: tokens[i]   === "N/A" ? "" : parseDateStr(tokens[i]),
          sail:   tokens[i+1] === "N/A" ? "" : parseDateStr(tokens[i+1]),
        });
      }
    }

    if (mode === "POD") {
      const podMatch = line.match(/^(Cotonou|Lome|Lagos|Durban|Dakar|Tema|Abidjan)/i);
      if (!podMatch) continue;
      const pod = normalizePolPod(podMatch[0]);
      const tokens = [...line.matchAll(TOKEN_RE)].map(t => t[1]);
      podData[pod] = tokens.map(t => t === "N/A" ? "" : parseDateStr(t));
    }
  }

  const numCols = Math.max(...Object.values(polData).map(a => a.length), voyageCodes.length);

  // ── 3. Score each (voyage-code, column) assignment ──────────────────────────
  function scoreAssignment(col) {
    let score = 0;
    for (const [pol, pairs] of Object.entries(polData)) {
      const pair = pairs[col];
      if (!pair || !pair.sail) continue;
      const sailMs = new Date(pair.sail).getTime();
      if (isNaN(sailMs)) continue;
      for (const [pod, etas] of Object.entries(podData)) {
        const eta = etas[col];
        if (!eta) continue;
        const etaMs = new Date(eta).getTime();
        if (isNaN(etaMs)) continue;
        const days = (etaMs - sailMs) / 86400000;
        const [lo, hi] = SALLAUM_CROSSING[pod.toUpperCase()] || [20, 40];
        score += (days >= lo - 3 && days <= hi + 3) ? 1 : -1;
      }
    }
    return score;
  }

  // Greedy assignment: best-scoring unused column per voyage code
  const assignedCol = {};   // voyageCode -> column index
  const usedCols = new Set();

  for (const code of voyageCodes) {
    let best = -1, bestScore = -Infinity;
    for (let c = 0; c < numCols; c++) {
      if (usedCols.has(c)) continue;
      const s = scoreAssignment(c);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (best !== -1) { assignedCol[code] = best; usedCols.add(best); }
  }

  // ── 4. Build schedule rows ───────────────────────────────────────────────────
  const scheduleRows = [];
  const now = new Date();

  for (const [code, col] of Object.entries(assignedCol)) {
    const vessel = vesselForVoyage[code] || code;
    for (const [pol, pairs] of Object.entries(polData)) {
      const pair = pairs[col];
      if (!pair || (!pair.cutoff && !pair.sail)) continue;
      for (const [pod, etas] of Object.entries(podData)) {
        const arrival = etas[col] || "";
        if (!arrival) continue;
        scheduleRows.push({ carrier: "SALLAUM", vessel, voyage: code, pol, pod,
          cutoffDate: pair.cutoff || "", sailDate: pair.sail || "",
          arrivalDate: arrival, updatedAt: now });
      }
    }
  }

  console.log(`[Sallaum PDF] vessels: ${voyageCodes.join(", ")} | rows: ${scheduleRows.length}`);
  return scheduleRows;
}

// POST /api/schedule/upload-pdf  - Sallaum PDF parsed directly from PDF text
router.post("/upload-pdf", upload.single("schedule"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    const { text } = await pdfParse(req.file.buffer);
    const upperText = text.toUpperCase();

    if (upperText.includes("SALLAUM") || upperText.includes("SILVER SOUL") || upperText.includes("PLATINUM RAY")) {
      const rows = await parseSallaumPdfDirect(req.file.buffer);
      if (rows.length === 0) throw new Error("No schedule rows found in PDF");
      await ScheduleRow.deleteMany({ carrier: "SALLAUM" });
      await ScheduleRow.insertMany(rows);
      return res.json({ message: `Sallaum schedule parsed from PDF (${rows.length} rows)`, rows: rows.length, updatedAt: new Date() });
    }

    // For ACL PDF, forward to the ACL endpoint logic
    return res.status(400).json({ error: "For ACL PDFs use the 'Upload ACL PDF for Cutoffs' button." });
  } catch (err) {
    console.error("upload-pdf error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/schedule/upload-excel  - upload master Excel (backward compat)
router.post("/upload-excel", upload.single("schedule"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No Excel file uploaded" });

    const excelRows = parseExcelSchedule(req.file.buffer);
    const now = new Date();

    function getCell(row, names) {
      for (const n of names) if (row[n] !== undefined) return row[n];
      return "";
    }

    function fmtDate(v) {
      if (!v) return "";
      if (typeof v === "number") {
        const d = XLSX.SSF.parse_date_code(v);
        return d ? `${d.m}/${d.d}/${d.y}` : v.toString();
      }
      return String(v).trim();
    }

    const rows = excelRows.map(r => ({
      carrier: "ACL",
      vessel: String(getCell(r, ["Vessel", "Vessel Name"]) || "").toUpperCase().trim(),
      voyage: String(getCell(r, ["Voyage", "Voyage Number"]) || "").toUpperCase().trim(),
      pol: normalizePolPod(getCell(r, ["POL", "Port Of Loading", "Port of Loading"])),
      pod: normalizePolPod(getCell(r, ["POD", "Port Of Discharge", "Port of Discharge"])),
      cutoffDate: fmtDate(getCell(r, ["Port Cutoff", "Cutoff Date", "Cutoff", "Cargo Cutoff"])),
      sailDate: fmtDate(getCell(r, ["Sail Date", "ETD", "Sail"])),
      arrivalDate: fmtDate(getCell(r, ["Arrival Date", "ETA", "Arrival"])),
      updatedAt: now,
    })).filter(r => r.vessel && r.pol && r.pod);

    // Determine carrier from data
    const hasGrande = rows.some(r => r.vessel.includes("GRANDE"));
    const actualCarrier = hasGrande ? "ACL" : "ACL";

    await ScheduleRow.deleteMany({ carrier: actualCarrier });
    await ScheduleRow.insertMany(rows);

    res.json({
      message: `Schedule updated from Excel (${rows.length} rows)`,
      rows: rows.length,
      updatedAt: now,
    });
  } catch (err) {
    console.error("EXCEL UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/schedule/lookup — DB is the single source of truth
//   voyageName = voyage folder name e.g. "26LA01 LIBERTY PASSION"
//   vessel     = fallback AES vessel name
router.get("/lookup", async (req, res) => {
  try {
    const { voyageName, vessel, pol, pod } = req.query;
    if (!pol || !pod) return res.status(400).json({ error: "pol and pod required" });

    const polUp = normalizePolPod(pol);
    const podUp = normalizePolPod(pod);
    const esc   = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Parse voyage folder name: "26LA01 LIBERTY PASSION" → code="26LA01", vessel="LIBERTY PASSION"
    const folderName = (voyageName || "").toUpperCase().trim();
    const codeMatch  = folderName.match(/^(\d+[A-Z]+\d+[A-Z]*)\s+(.*)/);
    const voyageCode = codeMatch ? codeMatch[1] : folderName;
    const vesselPart = codeMatch ? codeMatch[2].trim() : folderName;

    let dbRow = null;

    // 1. Exact voyage code
    if (voyageCode) {
      dbRow = await ScheduleRow.findOne({ voyage: { $regex: `^${esc(voyageCode)}$`, $options: "i" }, pol: polUp, pod: podUp });
    }
    // 2. Exact vessel name from folder
    if (!dbRow && vesselPart) {
      dbRow = await ScheduleRow.findOne({ vessel: { $regex: `^${esc(vesselPart)}$`, $options: "i" }, pol: polUp, pod: podUp });
    }
    // 3. Partial vessel word from folder
    if (!dbRow && vesselPart) {
      const lastWord = vesselPart.split(/\s+/).filter(w => w.length > 3).pop();
      if (lastWord) dbRow = await ScheduleRow.findOne({ vessel: { $regex: lastWord, $options: "i" }, pol: polUp, pod: podUp });
    }
    // 4. Fallback: AES vessel name
    if (!dbRow && vessel) {
      const vUp = vessel.toUpperCase().replace(/^(M\/V|MV|SS|MS)\s+/i, "").split(" V:")[0].trim();
      dbRow = await ScheduleRow.findOne({ vessel: { $regex: `^${esc(vUp)}$`, $options: "i" }, pol: polUp, pod: podUp });
      if (!dbRow) {
        const lastWord = vUp.split(/\s+/).filter(w => w.length > 3).pop();
        if (lastWord) dbRow = await ScheduleRow.findOne({ vessel: { $regex: lastWord, $options: "i" }, pol: polUp, pod: podUp });
      }
    }

    if (dbRow) {
      return res.json({
        found:       true,
        vessel:      dbRow.vessel,
        voyage:      dbRow.voyage,
        pol:         dbRow.pol,
        pod:         dbRow.pod,
        cutoffDate:  dbRow.cutoffDate  || "",
        sailDate:    dbRow.sailDate    || "",
        arrivalDate: dbRow.arrivalDate || "",
      });
    }

    console.log(`[Schedule Lookup] No match — voyageName="${voyageName}" voyageCode="${voyageCode}" vesselPart="${vesselPart}" pol="${polUp}" pod="${podUp}"`);
    res.json({ found: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────────
const masterSchedulePath = path.join(__dirname, "..", "saved-schedules", "master-schedule.xlsx");

function readMasterRows() {
  if (!fs.existsSync(masterSchedulePath)) return [];
  const wb = XLSX.readFile(masterSchedulePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "NA" });
}

function normPort(v) {
  const u = (v || "").toString().toUpperCase().trim();
  if (u.includes("BALTIMORE") || u.includes("LOCUST") || u.includes("TRADEPOINT")) return "BALTIMORE";
  if (u.includes("DAVISVILLE") || u.includes("NORAD")) return "DAVISVILLE";
  if (u.includes("PROVIDENCE")) return "PROVIDENCE";
  return u;
}

function fmtExcelDate(v) {
  if (!v || v === "NA") return "";
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    const mm = String(d.getUTCMonth()+1).padStart(2,"0");
    const dd = String(d.getUTCDate()).padStart(2,"0");
    return `${mm}/${dd}/${d.getUTCFullYear()}`;
  }
  return String(v);
}

// ─── GET /api/schedule/all ────────────────────────────────────────────────────
// Return every row from DB (single source of truth for both ACL + Sallaum)
router.get("/all", async (req, res) => {
  try {
    const rows = await ScheduleRow.find().sort({ carrier: 1, vessel: 1, pol: 1 }).lean();
    // Normalise to the flat object shape the Schedule page expects
    const out = rows.map(r => ({
      Carrier:      r.carrier,
      Vessel:       r.vessel,
      Voyage:       r.voyage,
      POL:          r.pol,
      POD:          r.pod,
      "Cutoff Date": r.cutoffDate  || "",
      "Sail Date":   r.sailDate    || "",
      "Arrival Date":r.arrivalDate || "",
    }));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/schedule/vessels ───────────────────────────────────────────────
// Returns unique vessel names from DB (single source of truth)
router.get("/vessels", async (req, res) => {
  try {
    const vessels = await ScheduleRow.distinct("vessel");
    res.json(vessels.map(v => v.toUpperCase().trim()).sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ─── POST /api/schedule/update-from-pdfs ─────────────────────────────────────
// Upload Sallaum + ACL PDFs → parse → save both to DB (single source of truth)
const uploadTwo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post("/update-from-pdfs", uploadTwo.fields([
  { name: "sallaum", maxCount: 1 },
  { name: "acl",     maxCount: 1 },
]), async (req, res) => {
  try {
    if (!req.files?.sallaum && !req.files?.acl) {
      return res.status(400).json({ error: "Upload at least one PDF (sallaum or acl)." });
    }

    let sallaumRows = 0, aclRows = 0;

    // ── Sallaum → refresh from website (no local PDF parser exists for Sallaum) ─
    if (req.files?.sallaum) {
      const rows = await fetchAndParseSallaum().catch(e => {
        console.error("[update-from-pdfs] Sallaum website refresh error:", e.message); return [];
      });
      if (rows.length) {
        await ScheduleRow.deleteMany({ carrier: "SALLAUM" });
        await ScheduleRow.insertMany(rows);
        sallaumRows = rows.length;
      }
    }

    // ── ACL PDF → DB ──────────────────────────────────────────────────────────
    if (req.files?.acl) {
      const rows = await parseAclPdfStandalone(req.files.acl[0].buffer).catch(() => []);
      if (rows.length) {
        await ScheduleRow.deleteMany({ carrier: "ACL" });
        await ScheduleRow.insertMany(rows);
        aclRows = rows.length;
      }
    }

    res.json({
      success: true,
      added:   sallaumRows + aclRows,
      sallaum: sallaumRows,
      acl:     aclRows,
    });
  } catch (err) {
    console.error("[update-from-pdfs]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
