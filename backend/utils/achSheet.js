/**
 * Append ACH payment rows to the ACH PAYMENTS Google Sheet.
 * Sheet: https://docs.google.com/spreadsheets/d/1WeaEQNgXGYJx_ToSCHDfcN3kJAM-NhECNqW_yxC58wE
 *
 * Columns: PAYMENT Date | Payee | Reference / Addenda | Amount | PROCESSING DATE
 */
const { google } = require("googleapis");
const { oauth2Client } = require("../googleDrive");

const SHEET_ID = "1WeaEQNgXGYJx_ToSCHDfcN3kJAM-NhECNqW_yxC58wE";
const TAB      = "Sheet1";

const sheets = google.sheets({ version: "v4", auth: oauth2Client });

// Convert JS Date to Google Sheets serial number (days since 12/30/1899)
// so dates are always stored as real date values, not text strings.
function toSerial(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  const epoch = Date.UTC(1899, 11, 30);
  return (dt.getTime() - epoch) / 86400000;
}

/**
 * Append one or more payment rows to the ACH PAYMENTS sheet.
 * Each entry: { payee, reference, amount, paymentDate }
 * PROCESSING DATE is set to paymentDate - 1 business day (simple -1 day).
 */
async function appendAchRows(entries) {
  if (!entries || !entries.length) return;
  try {
    const rows = entries.map(e => {
      const payDate = e.paymentDate instanceof Date ? e.paymentDate : new Date(e.paymentDate);
      const procDate = new Date(payDate);
      procDate.setDate(procDate.getDate() - 1);
      return [
        toSerial(payDate),
        e.payee || "",
        e.reference || "",
        e.amount != null ? e.amount : "",
        "",               // col E — empty spacer
        toSerial(procDate), // col F — PROCESSING DATE
      ];
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:F`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
  } catch (err) {
    console.warn("[achSheet] Failed to append rows:", err.message);
  }
}

module.exports = { appendAchRows };
