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
const { decodeVin } = require("../utils/vinDecode");
const { podToShippingLine } = require("../utils/warehouses");

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  "https://dock-receipt-backend.onrender.com/oauth2callback"
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

function parsePIN(body) {
  // Body: "Gate Pass PIN: 5F2D" or subject reply "PICK UP PIN: 5F2D"
  const m = body.match(/(?:Gate Pass PIN|PICK UP PIN)[:\s]+([A-Z0-9]{4,8})/i);
  return m ? m[1] : "";
}

// The user's subject convention:
//   "PICK UP FOR <RORO|CONTAINER> <year make model> #<VIN> <CUSTOMER NAME> <WAREHOUSE> <POD>"
// e.g. "... #7FARW5H39HE008018 DENIS ANABA EZ CARGO TEMA"
// We pull request type, POD, warehouse and shipping line out of that tail and
// treat whatever text is left as the customer name.
const POD_RX      = /\b(TEMA|LAGOS|APAPA|LOME|LOMÉ|COTONOU|DAKAR|ABIDJAN|DURBAN)\b/i;
const LINE_RX     = /\b(SALLAUM|ACL|GRIMALDI)\b/i;
const WAREHOUSE_RX = /\b(EZ\s*CARGO|EZCARGO|SAVANNAH(?:\s+AUTO(?:\s+EXPORT)?)?|I-?SHIP|CEDARS(?:\s+EXPRESS)?)\b/i;
const WH_CANON = s => {
  const u = s.toUpperCase().replace(/\s+/g, " ").trim();
  if (/EZ\s*CARGO|EZCARGO/.test(u)) return "EZ CARGO";
  if (/SAVANNAH/.test(u))           return "SAVANNAH AUTO EXPORT";
  if (/I-?SHIP/.test(u))            return "ISHIP";
  if (/CEDARS/.test(u))             return "CEDARS EXPRESS";
  return u;
};

function parseSubject(headers = []) {
  const subj = (headers.find(h => h.name.toLowerCase() === "subject") || {}).value || "";
  const clean = subj.replace(/^(Re|Fwd):\s*/i, "").trim();

  let requestType = "";
  if (/\bCONTAINER\b/i.test(clean)) requestType = "Container";
  else if (/\bRORO\b/i.test(clean))  requestType = "RORO";

  const pod  = (clean.match(POD_RX)  || [])[1] ? (clean.match(POD_RX)[1]).toUpperCase().replace("LOMÉ", "LOME") : "";
  let shippingLine = (clean.match(LINE_RX) || [])[1] ? clean.match(LINE_RX)[1].toUpperCase() : "";
  if (shippingLine === "GRIMALDI") shippingLine = "ACL";
  const whMatch = clean.match(WAREHOUSE_RX);
  const deliveryName = whMatch ? WH_CANON(whMatch[1]) : "";

  // Customer name: the tail after the VIN, minus the tokens we just consumed
  let customerName = "";
  const afterVin = clean.match(/[#]?[A-HJ-NPR-Z0-9]{17}\s+(.+)/i);
  if (afterVin) {
    customerName = afterVin[1]
      .replace(WAREHOUSE_RX, " ")
      .replace(POD_RX, " ")
      .replace(LINE_RX, " ")
      .replace(/\b(RORO|CONTAINER|PICK ?UP|FOR)\b/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return { requestType, customerName, pod, shippingLine, deliveryName };
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
let _legacyIndexChecked = false;
async function pollCopart() {
  try {
    if (!_legacyIndexChecked) { await dropLegacyUniqueIndex(); _legacyIndexChecked = true; }
    await autoCleanup();
    // Each message is handled once — all of its PDF attachments in that single
    // pass (a customer often forwards several buyer receipts in one email).
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
      const headers = payload.headers || [];

      const bodyText = getBody(payload.parts || [payload]);
      const pin = parsePIN(bodyText) || parsePIN((headers.find(h => h.name.toLowerCase() === "subject") || {}).value || "");
      const { requestType: subjRequestType, customerName: subjCustomerName,
              pod: subjPod, shippingLine: subjLine, deliveryName: subjWarehouse } = parseSubject(headers);

      // Collect EVERY PDF attachment — a customer often forwards several buyer
      // receipts in one email, and each is its own order.
      const attachments = [];
      const findAttachments = async (parts = []) => {
        for (const p of parts) {
          if (p.mimeType === "application/pdf" || (p.filename && p.filename.toLowerCase().endsWith(".pdf"))) {
            let data;
            if (p.body?.data) {
              data = b64(p.body.data);
            } else if (p.body?.attachmentId) {
              const att = await gmail.users.messages.attachments.get({
                userId: "me", messageId: msg.id, id: p.body.attachmentId,
              });
              data = b64(att.data.data);
            }
            if (data) attachments.push({ filename: p.filename || "receipt.pdf", data });
          }
          if (p.parts) await findAttachments(p.parts);
        }
      };
      await findAttachments(payload.parts || [payload]);

      if (!attachments.length) {
        await EmailOrder.create({ gmailMessageId: msg.id, status: "no-pdf", bodyText });
        continue;
      }

      let createdForThisMsg = 0;

      for (const { filename: pdfFilename, data: pdfData } of attachments) {
        // Use same parser as the buyer receipt upload flow
        const tmpPath = path.join(os.tmpdir(), `copart_${msg.id}_${Math.random().toString(36).slice(2)}.pdf`);
        fs.writeFileSync(tmpPath, pdfData);
        let extracted = {};
        try {
          extracted = await parseBuyerReceipt(tmpPath);
        } catch (parseErr) {
          console.log(`[Copart Poller] PDF parse failed for msg ${msg.id} (${pdfFilename}): ${parseErr.message}`);
          continue;
        } finally {
          try { fs.unlinkSync(tmpPath); } catch {}
        }

        // Skip PDFs that don't look like buyer receipts — need a real VIN + lot
        const isRealVin = extracted.vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(extracted.vin);
        const hasLot = !!(extracted.lotNumber);
        if (!isRealVin || !hasLot) {
          console.log(`[Copart Poller] ${pdfFilename} in msg ${msg.id} is not a buyer receipt — skipping attachment`);
          continue;
        }

        const resolvedPin = extracted.pin || pin || "";
        const lot = extracted.lotNumber || "";
        const resolvedCustomer = extracted.customerName || subjCustomerName || "";
        const resolvedRequestType = subjRequestType || "RORO";
        const resolvedLine = subjLine || podToShippingLine(subjPod) || "";

        // Trust the VIN decoder for year/make/model over the mangled receipt text
        const decoded = await decodeVin(extracted.vin);
        const year  = decoded?.year  || extracted.year  || "";
        const make  = decoded?.make  || extracted.make  || "";
        const model = decoded?.model || extracted.model || "";

        // Skip if a real order already exists with this VIN
        const existing = await Order.findOne({ vin: extracted.vin });
        if (existing) {
          await EmailOrder.create({ gmailMessageId: msg.id, status: "approved", vin: extracted.vin, orderId: existing._id, orderRef: existing.refNumber });
          console.log(`[Copart Poller] Skipping VIN ${extracted.vin} — order ${existing.refNumber} already exists`);
          createdForThisMsg++;
          continue;
        }

        // Dedup by VIN: patch a pending row rather than duplicating it
        const existingPending = await EmailOrder.findOne({ vin: extracted.vin, status: "pending" });
        if (existingPending) {
          let updated = false;
          if (!existingPending.pin && resolvedPin) { existingPending.pin = resolvedPin; updated = true; }
          if (!existingPending.customerName && resolvedCustomer) { existingPending.customerName = resolvedCustomer; updated = true; }
          if (!existingPending.requestType && resolvedRequestType) { existingPending.requestType = resolvedRequestType; updated = true; }
          if (!existingPending.pod && subjPod) { existingPending.pod = subjPod; updated = true; }
          if (!existingPending.shippingLine && resolvedLine) { existingPending.shippingLine = resolvedLine; updated = true; }
          if (!existingPending.deliveryName && subjWarehouse) { existingPending.deliveryName = subjWarehouse; updated = true; }
          if (!existingPending.buyerNumber && extracted.buyerNumber) { existingPending.buyerNumber = extracted.buyerNumber; updated = true; }
          if (updated) await existingPending.save();
          console.log(`[Copart Poller] Merged duplicate receipt for VIN ${extracted.vin} into existing pending`);
          createdForThisMsg++;
          continue;
        }

        await EmailOrder.create({
          gmailMessageId: msg.id,
          status:        "pending",
          customerName:  resolvedCustomer,
          requestType:   resolvedRequestType,
          lot,
          vin:           extracted.vin           || "",
          year,
          make,
          model,
          color:         extracted.color         || "",
          pickupAddress: extracted.pickupAddress || "",
          pickupCity:    extracted.pickupCity    || "",
          pickupState:   extracted.pickupState   || "",
          pickupZip:     extracted.pickupZip     || "",
          pin:           resolvedPin,
          buyerNumber:   extracted.buyerNumber   || "",
          pod:           subjPod,
          shippingLine:  resolvedLine,
          deliveryName:  subjWarehouse,
          pdfBuffer:     pdfData,
          pdfFilename,
          bodyText,
        });
        createdForThisMsg++;
        console.log(`[Copart Poller] New pickup: LOT ${lot} — ${year} ${make} ${model} (${resolvedRequestType}) — ${resolvedCustomer}`);
      }

      // Nothing usable in any attachment — leave a marker so we don't rescan
      if (createdForThisMsg === 0) {
        await EmailOrder.create({ gmailMessageId: msg.id, status: "no-pdf", bodyText });
      }
    }
  } catch (err) {
    if (err.code === 401 || (err.message || "").includes("invalid_grant")) {
      console.error("[Copart Poller] Gmail auth error — token may need Gmail scope. Visit /api/gmail-auth to re-authorize.");
    } else {
      console.error("[Copart Poller] Error:", err.message);
    }
  }
}

// One-time: drop the legacy unique index on gmailMessageId so a single email
// can spawn one EmailOrder row per attachment.
async function dropLegacyUniqueIndex() {
  try {
    const idx = await EmailOrder.collection.indexes();
    const legacy = idx.find(i => i.name === "gmailMessageId_1" && i.unique);
    if (legacy) {
      await EmailOrder.collection.dropIndex("gmailMessageId_1");
      console.log("[Copart Poller] Dropped legacy unique index gmailMessageId_1");
    }
  } catch (e) {
    console.warn("[Copart Poller] Could not check/drop legacy index:", e.message);
  }
}

// ── Start polling every 5 minutes ────────────────────────────────────────────
function startPoller() {
  console.log("[Copart Poller] Started — checking Gmail every 5 minutes");
  pollCopart(); // run immediately on start (drops legacy index on first run)
  setInterval(pollCopart, 5 * 60 * 1000);
}

module.exports = { startPoller, pollCopart, parseSubject };
