/**
 * AES confirmation-email poller.
 *
 * After a WebLink filing is submitted in ACE AESDirect, CBP emails a confirmation
 * that contains the Shipment Reference Number and (when accepted) the ITN:
 *
 *   Your request to create the following filing has been ACCEPTED.
 *   Shipment Reference Number: DDG14204
 *   AES ITN: X20260126121298
 *
 * This job scans Gmail for those emails, matches the SRN to an order
 * (order.aesFiling.srn), and writes the ITN through applyItn() — the same
 * non-clobbering path the redirect-inquiry and the Inquiry poller use. Once
 * order.aesItn is set it flows onto the Dock Receipt automatically
 * (dr-payload / generate-pdf already read it).
 *
 * Reuses the Gmail OAuth client from the Copart poller — runs whenever
 * GMAIL_OAUTH_REFRESH_TOKEN is set. Disable with AES_EMAIL_POLLER=off.
 */
const { google } = require("googleapis");
const Order = require("../models/Order");
const { applyItn } = require("../utils/aesWeblink");

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  "https://dock-receipt-backend.onrender.com/oauth2callback"
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

const INTERVAL_MS = 10 * 60 * 1000;

const b64 = (d) => Buffer.from(String(d || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");

function collectText(payload) {
  let out = "";
  const walk = (p) => {
    if (!p) return;
    if ((p.mimeType === "text/plain" || p.mimeType === "text/html") && p.body && p.body.data) {
      let t = b64(p.body.data).toString("utf8");
      if (p.mimeType === "text/html") t = t.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
      out += "\n" + t;
    }
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
}

// Pull { srn, itn, status, notes } out of a confirmation-email body.
function parseAesEmail(text) {
  const srn = (text.match(/Shipment Reference Number[:\s]+([A-Za-z0-9._-]{1,17})/i) || [])[1] || "";
  const itn = (text.match(/AES ITN[:\s]+(X\d{14,})/i) || [])[1] || "";
  let status = "";
  if (/\bACCEPTED\b/i.test(text)) status = "accepted";
  else if (/\bREJECTED\b/i.test(text)) status = "rejected";
  // error / warning lines look like "(399-VERIFY) ..." or "(700-COMPLIANCE ALERT) ..."
  const notes = (text.match(/\([0-9A-Z]{3}-[A-Z ]+\)[^\n]*/g) || []).join(" | ").slice(0, 500);
  return { srn: srn.toUpperCase(), itn: itn.toUpperCase(), status, notes };
}

async function pollAesEmails() {
  try {
    const q = `"Shipment Reference Number" (subject:AES OR subject:AESDirect OR subject:ITN OR "AES ITN") newer_than:21d`;
    const list = await gmail.users.messages.list({ userId: "me", q, maxResults: 50 });
    const messages = list.data.messages || [];
    let matched = 0, captured = 0;

    for (const msg of messages) {
      const full = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
      const text = collectText(full.data.payload);
      const { srn, itn, status, notes } = parseAesEmail(text);
      if (!srn) continue;

      const order = await Order.findOne({ "aesFiling.srn": new RegExp(`^${srn}$`, "i") });
      if (!order) continue;
      matched++;

      let changed = false;
      order.aesFiling = order.aesFiling || {};

      if (itn) {
        const r = applyItn(order, itn, "AES email");
        if (r === "set") captured++;
        changed = true;
      } else if (status === "rejected" && order.aesFiling.status !== "rejected" && !order.aesItn) {
        order.aesFiling.status = "rejected";
        order.aesFiling.lastError = notes || "Rejected — see the AES confirmation email.";
        order.timeline.push({ action: "AES Rejected", details: `${order.aesFiling.srn}: ${order.aesFiling.lastError}`, createdAt: new Date() });
        changed = true;
      }
      if (notes && order.aesFiling.lastError !== notes && (itn || status)) {
        // keep the latest verify/compliance notes visible even on an accepted filing
        if (itn && notes) {
          order.timeline.push({ action: "AES Notes", details: notes, createdAt: new Date() });
          changed = true;
        }
      }
      if (changed) await order.save();
    }

    console.log(`[aesEmailPoller] scanned ${messages.length} · matched ${matched} · ITNs captured ${captured}`);
    return { scanned: messages.length, matched, captured };
  } catch (err) {
    if (err.code === 401 || /invalid_grant/i.test(err.message || "")) {
      console.error("[aesEmailPoller] Gmail auth failed — refresh GMAIL_OAUTH_REFRESH_TOKEN");
    } else {
      console.error("[aesEmailPoller]", err.message);
    }
    return { error: err.message };
  }
}

function startAesEmailPoller() {
  console.log("[aesEmailPoller] starting (every 10 min)");
  pollAesEmails().catch((e) => console.error("[aesEmailPoller] first run:", e.message));
  setInterval(() => pollAesEmails().catch((e) => console.error("[aesEmailPoller]", e.message)), INTERVAL_MS);
}

module.exports = { startAesEmailPoller, pollAesEmails, parseAesEmail };
