/**
 * Copart Gmail Poller
 * Checks Gmail every 5 minutes for emails from member_pickup@copart.com,
 * parses the PDF attachment (Sales Receipt/Bill of Sale), and creates a
 * draft order in the DB for review.
 */

const { google }    = require("googleapis");
const fs            = require("fs");
const os            = require("os");
const path          = require("path");
const Order         = require("../models/Order");
const EmailOrder    = require("../models/EmailOrder");
const { parseBuyerReceipt } = require("../utils/parseOrderDocs");

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  "https://dock-receipt-backend.onrender.com/oauth2callback"
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

function parsePIN(body) {
  const m = body.match(/Gate Pass PIN:\s*(\d+)/i);
  return m ? m[1] : "";
}

function b64(data) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function getBody(parts = []) {
  for (const p of parts) {
    if (p.mimeType === "text/plain" && p.body?.data) return b64(p.body.data).toString("utf8");
    if (p.parts) { const r = getBody(p.parts); if (r) return r; }
  }
  return "";
}

// ── Auto-cleanup: mark pending items done if order already exists ─────────────
async function autoCleanup() {
  const pending = await EmailOrder.find({ status: "pending" });
  for (const eo of pending) {
    if (!eo.vin) continue;
    const existing = await Order.findOne({ vin: eo.vin });
    if (existing) {
      eo.status = "approved";
      eo.orderId = existing._id;
      eo.orderRef = existing.refNumber;
      await eo.save();
    }
  }
}

// ── Main poll function ────────────────────────────────────────────────────────
async function pollCopart() {
  try {
    await autoCleanup();
    const processed = await EmailOrder.distinct("gmailMessageId");
    // Scan all emails with PDF attachments in the last 90 days — detect by content, not sender/subject
    const q = `has:attachment filename:pdf newer_than:90d`;
    console.log(`[Copart Poller] Querying Gmail: ${q}`);
    const list = await gmail.users.messages.list({ userId: "me", q, maxResults: 100 });
    console.log(`[Copart Poller] Found ${(list.data.messages || []).length} message(s), ${processed.length} already processed`);
    const messages = list.data.messages || [];

    for (const msg of messages) {
      if (processed.includes(msg.id)) continue;

      const full = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
      const payload = full.data.payload;

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
        // Mark as seen so we don't recheck this email
        await EmailOrder.create({ gmailMessageId: msg.id, status: "no-pdf", bodyText });
        continue;
      }

      // Use same parser as the buyer receipt upload flow
      const tmpPath = path.join(os.tmpdir(), `copart_${msg.id}.pdf`);
      fs.writeFileSync(tmpPath, pdfData);
      let extracted = {};
      try {
        extracted = await parseBuyerReceipt(tmpPath);
      } catch (parseErr) {
        console.log(`[Copart Poller] PDF parse failed for msg ${msg.id}: ${parseErr.message}`);
        await EmailOrder.create({ gmailMessageId: msg.id, status: "no-pdf", bodyText });
        continue;
      } finally {
        try { fs.unlinkSync(tmpPath); } catch {}
      }

      // Skip PDFs that don't look like buyer receipts
      // Must have a real VIN (17 chars, not containing "NUMBER") AND a lot number
      const isRealVin = extracted.vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(extracted.vin);
      const hasLot = !!(extracted.lotNumber);
      if (!isRealVin || !hasLot) {
        await EmailOrder.create({ gmailMessageId: msg.id, status: "no-pdf", bodyText });
        continue;
      }

      if (pin) extracted.pin = pin;
      const lot = extracted.lotNumber || "";

      // Skip if a real order already exists with this VIN
      const existing = await Order.findOne({ vin: extracted.vin });
      if (existing) {
        await EmailOrder.create({ gmailMessageId: msg.id, status: "approved", vin: extracted.vin, orderId: existing._id, orderRef: existing.refNumber });
        console.log(`[Copart Poller] Skipping VIN ${extracted.vin} — order ${existing.refNumber} already exists`);
        continue;
      }

      await EmailOrder.create({
        gmailMessageId: msg.id,
        status:        "pending",
        customerName:  extracted.customerName  || "",
        lot,
        vin:           extracted.vin           || "",
        year:          extracted.year          || "",
        make:          extracted.make          || "",
        model:         extracted.model         || "",
        color:         extracted.color         || "",
        pickupAddress: extracted.pickupAddress || "",
        pickupCity:    extracted.pickupCity    || "",
        pickupState:   extracted.pickupState   || "",
        pickupZip:     extracted.pickupZip     || "",
        pin:           extracted.pin           || pin || "",
        buyerNumber:   extracted.buyerNumber   || "",
        pdfBuffer:     pdfData,
        pdfFilename,
        bodyText,
      });

      console.log(`[Copart Poller] New pickup email: LOT ${lot} — ${extracted.year} ${extracted.make} ${extracted.model}`);
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
