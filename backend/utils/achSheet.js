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

function fmtDate(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
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
        fmtDate(payDate),
        e.payee || "",
        e.reference || "",
        e.amount != null ? e.amount : "",
        fmtDate(procDate),
      ];
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:E`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
  } catch (err) {
    console.warn("[achSheet] Failed to append rows:", err.message);
  }
}

module.exports = { appendAchRows };
