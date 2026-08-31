/**
 * Copart Gmail Poller
 * Checks Gmail every 5 minutes for emails from member_pickup@copart.com,
 * parses the PDF attachment (Sales Receipt/Bill of Sale), and creates a
 * draft order in the DB for review.
 */

const { google }    = require("googleapis");
const pdfParse      = require("pdf-parse");
const Order         = require("../models/Order");
const EmailOrder    = require("../models/EmailOrder");

// Reuse the same OAuth2 client as Drive
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.RENDER_URL
    ? `${process.env.RENDER_URL}/oauth2callback`
    : "http://localhost:4001/oauth2callback"
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

// ── PDF text parser ───────────────────────────────────────────────────────────
function parseCopartPDF(text) {
  const get = (pattern) => {
    const m = text.match(pattern);
    return m ? m[1].trim() : "";
  };

  // LOT#: 56675596
  const lot = get(/LOT#:\s*(\d+)/i);

  // VIN: 19XFB2F99FE243327
  const vin = get(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i);

  // VEHICLE: 2015 HONDA CIVIC EXL GRAY
  const vehicleLine = get(/VEHICLE:\s*(.+?)(?=\n|VIN)/i);
  // Parse year / make / model / color from vehicle line
  const vmMatch = vehicleLine.match(/^(\d{4})\s+(\S+)\s+(.+?)(?:\s+(\S+))?$/);
  const year  = vmMatch ? vmMatch[1] : "";
  const make  = vmMatch ? vmMatch[2] : "";
  const model = vmMatch ? vmMatch[3].trim() : "";
  const color = vmMatch && vmMatch[4] ? vmMatch[4] : "";

  // Sale date
  const saleDate = get(/Sale:\s*([\d/]+)/i) || get(/Date:\s*([\d/]+\s*[\d:]+\s*[AP]M)/i);

  // Physical address of lot (pickup location)
  // Pattern: after "PHYSICAL ADDRESS\nOF LOT:\n" grab next 2-3 lines
  const physMatch = text.match(/PHYSICAL ADDRESS\s+OF LOT:\s*([\s\S]*?)(?=SELLER:|MEMBER:)/i);
  let pickupAddress = "", pickupCity = "", pickupState = "", pickupZip = "";
  if (physMatch) {
    const lines = physMatch[1].trim().split(/\n/).map(l => l.trim()).filter(Boolean);
    pickupAddress = lines[0] || "";
    // "MENDON MA 01756"
    const cityLine = lines[1] || "";
    const csz = cityLine.match(/^(.+?)\s+([A-Z]{2})\s+(\d{5})$/);
    if (csz) { pickupCity = csz[1]; pickupState = csz[2]; pickupZip = csz[3]; }
  }

  // Member / customer name — first non-empty line after "MEMBER: XXXXX\n"
  const memberMatch = text.match(/MEMBER:\s*\d+\s*\n+([\s\S]*?)(?=\d+\s+\S|PHYSICAL ADDRESS)/i);
  let customerName = "";
  if (memberMatch) {
    const lines = memberMatch[1].trim().split(/\n/).map(l => l.trim()).filter(Boolean);
    customerName = lines[0] || "";
  }

  // Charges table
  const charges = {};
  const chargePattern = /(\d{2}\/\d{2}\/\d{4})\s+([\w\s]+?)\s+\$?([\d,]+\.\d{2})/g;
  let cm;
  while ((cm = chargePattern.exec(text)) !== null) {
    const desc = cm[2].trim();
    const amt  = parseFloat(cm[3].replace(",", ""));
    if (!isNaN(amt)) charges[desc] = amt;
  }

  return { lot, vin, year, make, model, color, vehicleLine, saleDate,
    pickupAddress, pickupCity, pickupState, pickupZip, customerName, charges };
}

// ── Parse email body for Gate Pass PIN ───────────────────────────────────────
function parsePIN(body) {
  const m = body.match(/Gate Pass PIN:\s*(\d+)/i);
  return m ? m[1] : "";
}

// ── Decode base64url ──────────────────────────────────────────────────────────
function b64(data) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// ── Get plain-text body from Gmail message parts ──────────────────────────────
function getBody(parts = []) {
  for (const p of parts) {
    if (p.mimeType === "text/plain" && p.body?.data) return b64(p.body.data).toString("utf8");
    if (p.parts) { const r = getBody(p.parts); if (r) return r; }
  }
  return "";
}

// ── Main poll function ────────────────────────────────────────────────────────
async function pollCopart() {
  try {
    // Find emails from Copart not yet processed
    const processed = await EmailOrder.distinct("gmailMessageId");
    const q = `from:member_pickup@copart.com subject:"Vehicles assigned to you for pickup"`;
    const list = await gmail.users.messages.list({ userId: "me", q, maxResults: 20 });
    const messages = list.data.messages || [];

    for (const msg of messages) {
      if (processed.includes(msg.id)) continue; // already handled

      const full = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
      const payload = full.data.payload;

      // Extract body text for PIN
      const bodyText = getBody(payload.parts || [payload]);
      const pin = parsePIN(bodyText);

      // Find PDF attachment
      let pdfData = null;
      let pdfFilename = "";
      const findAttachments = async (parts = []) => {
        for (const p of parts) {
          if (p.mimeType === "application/pdf" || (p.filename && p.filename.endsWith(".pdf"))) {
            pdfFilename = p.filename || "receipt.pdf";
            let data;
            if (p.body?.data) {
              data = b64(p.body.data);
            } else if (p.body?.attachmentId) {
              const att = await gmail.users.messages.attachments.get({
                userId: "me", messageId: msg.id, id: p.body.attachmentId,
              });
              data = b64(att.data.data);
            }
            if (data) pdfData = data;
          }
          if (p.parts) await findAttachments(p.parts);
        }
      };
      await findAttachments(payload.parts || [payload]);

      if (!pdfData) {
        // Mark as seen but no PDF
        await EmailOrder.create({ gmailMessageId: msg.id, status: "no-pdf", rawPin: pin, bodyText });
        continue;
      }

      // Parse PDF
      const parsed = await pdfParse(pdfData);
      const extracted = parseCopartPDF(parsed.text);
      extracted.pin = pin || extracted.pin;

      // Save EmailOrder record (pending review)
      await EmailOrder.create({
        gmailMessageId: msg.id,
        status: "pending",
        customerName:  extracted.customerName,
        lot:           extracted.lot,
        vin:           extracted.vin,
        year:          extracted.year,
        make:          extracted.make,
        model:         extracted.model,
        color:         extracted.color,
        pickupAddress: extracted.pickupAddress,
        pickupCity:    extracted.pickupCity,
        pickupState:   extracted.pickupState,
        pickupZip:     extracted.pickupZip,
        pin:           extracted.pin,
        saleDate:      extracted.saleDate,
        charges:       extracted.charges,
        pdfBuffer:     pdfData,
        pdfFilename,
        bodyText,
      });

      console.log(`[Copart Poller] New pickup email found: LOT ${extracted.lot} — ${extracted.year} ${extracted.make} ${extracted.model}`);
    }
  } catch (err) {
    if (err.code === 401 || (err.message || "").includes("invalid_grant")) {
      console.error("[Copart Poller] Gmail auth error — token may need Gmail scope. Visit /api/gmail-auth to re-authorize.");
    } else {
      console.error("[Copart Poller] Error:", err.message);
    }
  }
}

// ── Start polling every 5 minutes ────────────────────────────────────────────
function startPoller() {
  console.log("[Copart Poller] Started — checking Gmail every 5 minutes");
  pollCopart(); // run immediately on start
  setInterval(pollCopart, 5 * 60 * 1000);
}

module.exports = { startPoller, pollCopart };
