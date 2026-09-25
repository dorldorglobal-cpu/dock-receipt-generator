/**
 * One-time Gmail scan to back-fill trucker email addresses into vendor records.
 *
 * Two sources:
 *   1. Sent mail — dock receipt emails where the trucker was BCC'd.
 *      Subject contains a ref number (e.g. "13942 Dock Receipt …").
 *      We read the BCC header, match the order by ref → dispatchCarrier → vendor.
 *
 *   2. Inbox — BOL emails from truckers that include our ref number in the subject.
 *      We take the sender's email and match the order by ref → dispatchCarrier → vendor.
 *
 * Requires GMAIL_READ_REFRESH_TOKEN in env (gmail.readonly scope).
 */
const { google }  = require("googleapis");
const Order       = require("../models/Order");
const Vendor      = require("../models/Vendor");

function getReadClient() {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "https://dock-receipt-backend.onrender.com/oauth2callback"
  );
  client.setCredentials({ refresh_token: process.env.GMAIL_READ_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: client });
}

// Extract first ref-number-looking token from a subject line (5+ digits)
function extractRef(subject) {
  const m = (subject || "").match(/\b(\d{5,6})\b/);
  return m ? m[1] : null;
}

// Parse email addresses out of a header value
function parseAddrs(val) {
  if (!val) return [];
  return val.split(/[,;]/).map(s => {
    const m = s.match(/<([^>]+)>/) || s.match(/([^\s]+@[^\s]+)/);
    return m ? m[1].trim().toLowerCase() : null;
  }).filter(Boolean);
}

async function saveEmail(vendorName, email) {
  if (!vendorName || !email) return false;
  const result = await Vendor.findOneAndUpdate(
    {
      name:  { $regex: `^${vendorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
      email: "",
    },
    { $set: { email } }
  );
  return !!result;
}

async function scanSentDRs(gmail, stats) {
  // Fetch up to 500 sent dock receipt emails
  let pageToken;
  let processed = 0;
  do {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "in:sent subject:dock receipt",
      maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    });
    pageToken = listRes.data.nextPageToken;
    const messages = listRes.data.messages || [];

    for (const { id } of messages) {
      try {
        const msg = await gmail.users.messages.get({
          userId: "me", id,
          format: "metadata",
          metadataHeaders: ["Subject", "Bcc", "To"],
        });
        const hdrs    = msg.data.payload.headers;
        const subject = hdrs.find(h => h.name === "Subject")?.value || "";
        const bcc     = hdrs.find(h => h.name === "Bcc")?.value || "";
        const ref     = extractRef(subject);
        if (!ref || !bcc) continue;

        const bccEmails = parseAddrs(bcc).filter(e => !e.includes("dorldorglobal"));
        if (!bccEmails.length) continue;

        const order = await Order.findOne({ refNumber: ref }).select("dispatchCarrier").lean();
        if (!order?.dispatchCarrier) continue;

        const saved = await saveEmail(order.dispatchCarrier, bccEmails[0]);
        if (saved) {
          stats.saved++;
          stats.details.push({ source: "sent", ref, vendor: order.dispatchCarrier, email: bccEmails[0] });
        }
        processed++;
      } catch (e) {
        stats.errors++;
      }
    }
  } while (pageToken && processed < 500);
}

async function scanInboxBOLs(gmail, stats) {
  // Search inbox for emails from truckers with ref numbers in subject
  const queries = ["subject:bol", "subject:bill of lading", "subject:pickup"];
  for (const q of queries) {
    let pageToken;
    let processed = 0;
    do {
      const listRes = await gmail.users.messages.list({
        userId: "me",
        q: `in:inbox ${q}`,
        maxResults: 100,
        ...(pageToken ? { pageToken } : {}),
      });
      pageToken = listRes.data.nextPageToken;
      const messages = listRes.data.messages || [];

      for (const { id } of messages) {
        try {
          const msg = await gmail.users.messages.get({
            userId: "me", id,
            format: "metadata",
            metadataHeaders: ["Subject", "From"],
          });
          const hdrs    = msg.data.payload.headers;
          const subject = hdrs.find(h => h.name === "Subject")?.value || "";
          const from    = hdrs.find(h => h.name === "From")?.value || "";
          const ref     = extractRef(subject);
          if (!ref) continue;

          const fromEmails = parseAddrs(from).filter(e => !e.includes("dorldorglobal"));
          if (!fromEmails.length) continue;

          const order = await Order.findOne({ refNumber: ref }).select("dispatchCarrier").lean();
          if (!order?.dispatchCarrier) continue;

          const saved = await saveEmail(order.dispatchCarrier, fromEmails[0]);
          if (saved) {
            stats.saved++;
            stats.details.push({ source: "inbox", ref, vendor: order.dispatchCarrier, email: fromEmails[0] });
          }
          processed++;
        } catch (e) {
          stats.errors++;
        }
      }
    } while (pageToken && processed < 300);
  }
}

async function runTruckerEmailScan() {
  if (!process.env.GMAIL_READ_REFRESH_TOKEN) {
    throw new Error("GMAIL_READ_REFRESH_TOKEN not set — complete Gmail read auth first");
  }
  const gmail = getReadClient();
  const stats = { saved: 0, errors: 0, details: [] };

  await scanSentDRs(gmail, stats);
  await scanInboxBOLs(gmail, stats);

  return stats;
}

module.exports = { runTruckerEmailScan };
