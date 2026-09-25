/**
 * Sync ACL booking data to the master Google Sheet.
 * Sheet: https://docs.google.com/spreadsheets/d/1f40A4EPVIfVzOCYPWg2riGfOkGi56YF4jjyBaY0TSxc
 *
 * Columns (1-indexed):
 *   A: BOOKING#   B: RELEASE TYPE   C: VIN   D: CONSIGNEE
 *   E: POL        F: POA            G: REFERENCE   H: STATUS
 *   I: AMOUNT     J: PAYMENT STATUS K: TELEX
 */
const { google } = require("googleapis");
const { oauth2Client } = require("../googleDrive");

const SHEET_ID  = "1f40A4EPVIfVzOCYPWg2riGfOkGi56YF4jjyBaY0TSxc";
const TAB       = "Sheet1";   // tab name — update if different
const HEADER_ROW = 1;         // row 1 is the header, data starts at row 2

const sheets = google.sheets({ version: "v4", auth: oauth2Client });

// Build the STATUS string: "SAILED GPO0826" style
function buildStatus(order) {
  if (!order.vessel) return "SAILED";
  // Abbreviate vessel: first 3 uppercase letters of each word, e.g. "Grande Porto" → "GPO"
  const abbr = order.vessel
    .split(/\s+/)
    .map(w => w.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase())
    .join("")
    .slice(0, 3);
  // Sail date as MMYY
  let mmyy = "";
  if (order.sailDate) {
    const d = new Date(order.sailDate);
    if (!isNaN(d)) {
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yy = String(d.getFullYear()).slice(-2);
      mmyy = mm + yy;
    }
  }
  return `SAILED ${abbr}${mmyy}`.trim();
}

/**
 * Upsert one ACL booking row.
 * Finds an existing row by BOOKING# (col A) or REFERENCE (col G).
 * Updates it in place if found; appends a new row if not.
 */
async function upsertAclRow({ bookingNumber, vin, consignee, pol, pod, refNumber, order }) {
  try {
    // Read all existing data
    const getRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:K`,
    });
    const rows = getRes.data.values || [];

    // Find matching row (skip header row 1, so data rows are index 1+)
    let matchRowIndex = -1; // 0-based index in `rows`
    for (let i = HEADER_ROW; i < rows.length; i++) {
      const rowBooking = (rows[i][0] || "").trim();
      const rowRef     = (rows[i][6] || "").toString().trim();
      if (bookingNumber && rowBooking === bookingNumber) { matchRowIndex = i; break; }
      if (refNumber     && rowRef     === String(refNumber))  { matchRowIndex = i; break; }
    }

    const status = buildStatus(order || {});
    // A  B  C    D          E    F    G          H
    const rowData = [
      bookingNumber || "",
      "",                    // RELEASE TYPE — left for manual entry
      vin || "",
      consignee || "",
      pol || "",
      pod || "",
      refNumber ? String(refNumber) : "",
      status,
    ];

    if (matchRowIndex >= 0) {
      // Update existing row — preserve AMOUNT, PAYMENT STATUS, TELEX (cols I-K)
      const sheetRow = matchRowIndex + 1; // 1-based
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB}!A${sheetRow}:H${sheetRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [rowData] },
      });
    } else {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${TAB}!A:K`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [rowData] },
      });
    }
  } catch (err) {
    // Non-fatal — log but don't crash the BL attach flow
    console.warn("[aclSheet] Failed to update sheet:", err.message);
  }
}

module.exports = { upsertAclRow };
