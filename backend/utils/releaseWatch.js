/**
 * Shipping-line releases, end to end:
 *
 * 1. Request — once the customer pays, ask the line to release:
 *    Sallaum: reply on that voyage's "<VOYAGE> RELEASES" thread with "PLEASE RELEASE" + the VIN last 6s
 *    ACL:     the "PAYMENT FOR RELEASE" email (routes/expenses.js) is the request.
 * 2. Forward — the line emails the release (Sallaum "*** TELEX RELEASE ***", ACL "*** PRINT AT DESTINATION ***").
 *    scanReleases() finds it, matches the VIN to the order and forwards it to the order's customer email.
 *    If you already forwarded it yourself, it's just recorded.
 * 3. Complete — a forwarded release + a paid invoice = order Completed.
 *
 * Reads with GMAIL_READ_REFRESH_TOKEN, sends with the normal send token (utils/gmail.js).
 */
const { google } = require("googleapis");
const Order = require("../models/Order");
const Invoice = require("../models/Invoice");
const { getGmailAccessToken } = require("./gmail");
const { b64lines } = require("./mime");
const { signature } = require("./releaseEmails");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const VIN_RX = /\b[A-HJ-NPR-Z0-9]{17}\b/;
const EMAIL_RX = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

const RELEASE_QUERY =
  '((from:sallaumlines.us subject:"TELEX RELEASE") OR (from:aclcargo.com subject:"PRINT AT DESTINATION")) -in:sent';

function readClient() {
  if (!process.env.GMAIL_READ_REFRESH_TOKEN) throw new Error("GMAIL_READ_REFRESH_TOKEN not set");
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
  );
  client.setCredentials({ refresh_token: process.env.GMAIL_READ_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: client });
}

const hdr = (headers, name) => (headers.find((h) => h.name.toLowerCase() === name) || {}).value || "";

// Gmail per-minute quota: wait it out (up to twice) instead of failing the email
async function gmailCall(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i < 2 && /quota|rate limit|429/i.test(e.message || "")) { await sleep(65000); continue; }
      throw e;
    }
  }
}

async function sendRaw(lines, threadId) {
  const token = await getGmailAccessToken();
  const body = { raw: Buffer.from(lines.join("\r\n")).toString("base64url") };
  if (threadId) body.threadId = threadId;
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || `Gmail ${r.status}`);
  return r.json();
}

const fromHeader = () => `${process.env.RELEASE_SIGNATURE_NAME || "Eli Levy"} <${process.env.GMAIL_USER}>`;
const encSubject = (s) => `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;

function emailsOf(str) {
  return String(str || "").split(/[,;\s]+/).map((s) => s.replace(/^<|>$/g, "").trim()).filter((s) => EMAIL_RX.test(s));
}

/** Pull text, html and attachments out of a Gmail message payload. */
async function messageParts(gmail, msg) {
  const out = { text: "", html: "", files: [] };
  const walk = async (p) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      const a = await gmail.users.messages.attachments.get({ userId: "me", messageId: msg.id, id: p.body.attachmentId });
      out.files.push({ name: p.filename, mime: p.mimeType || "application/octet-stream", data: Buffer.from(a.data.data, "base64url") });
    } else if (p.mimeType === "text/plain" && p.body?.data && !out.text) out.text = Buffer.from(p.body.data, "base64url").toString("utf8");
    else if (p.mimeType === "text/html" && p.body?.data && !out.html) out.html = Buffer.from(p.body.data, "base64url").toString("utf8");
    for (const c of p.parts || []) await walk(c);
  };
  await walk(msg.payload);
  if (!out.html && out.text) out.html = `<pre style="font-family:inherit;white-space:pre-wrap">${esc(out.text)}</pre>`;
  return out;
}

/** Forward a Gmail message the way Gmail does: signature, then the forwarded header block and original body. */
async function forwardMessage(gmail, msg, to) {
  const h = msg.payload.headers;
  const subject = hdr(h, "subject");
  const meta = { from: hdr(h, "from"), date: hdr(h, "date"), subject, to: hdr(h, "to") };
  const parts = await messageParts(gmail, msg);
  const sig = signature();
  // Same layout as Eli's own release forwards: forwarded block first, signature at the bottom
  const text = ["---------- Forwarded message ---------",
    `From: ${meta.from}`, `Date: ${meta.date}`, `Subject: ${meta.subject}`, `To: ${meta.to}`, "", parts.text, "", "", sig.text].join("\r\n");
  const html = `<div dir="ltr"><div class="gmail_quote">` +
    `<div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: ${esc(meta.from)}<br>` +
    `Date: ${esc(meta.date)}<br>Subject: ${esc(meta.subject)}<br>To: ${esc(meta.to)}<br></div><br><br>${parts.html}</div>` +
    `<br clear="all"><div><br></div>${sig.html}</div>`;
  const B = "FWD_" + Date.now(), A = "ALT_" + Date.now();
  const lines = [
    `From: ${fromHeader()}`, `To: ${to.join(", ")}`, `Subject: ${encSubject("Fwd: " + subject)}`,
    "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${B}"`, "",
    `--${B}`, `Content-Type: multipart/alternative; boundary="${A}"`, "",
    `--${A}`, 'Content-Type: text/plain; charset="UTF-8"', "", text,
    `--${A}`, 'Content-Type: text/html; charset="UTF-8"', "", html,
    `--${A}--`,
  ];
  for (const f of parts.files) {
    lines.push(`--${B}`, `Content-Type: ${f.mime}; name="${f.name}"`, "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${f.name}"`, "", b64lines(f.data));
  }
  lines.push(`--${B}--`);
  return sendRaw(lines);
}

/** Paid invoice + forwarded release → Completed. Returns true when it completed the order. */
async function completeIfReady(order) {
  if (!order?.release?.forwardedAt || order.status === "Completed" || order.status === "Canceled") return false;
  const paid = await Invoice.exists({ orderId: order._id, status: "paid" });
  if (!paid) return false;
  await Order.updateOne({ _id: order._id }, {
    $set: { status: "Completed" },
    $push: { timeline: { action: "Status Changed", details: "Completed — invoice paid and release sent to customer", createdAt: new Date() } },
  });
  return true;
}

async function findOrderByVin(vin) {
  const orders = await Order.find({ vin, status: { $ne: "Canceled" } }).sort({ createdAt: -1 }).limit(1);
  return orders[0] || null;
}

/** Did we already forward this line's release ourselves (from Gmail, by hand)? */
async function forwardedByHand(gmail, vin) {
  const r = await gmailCall(() => gmail.users.messages.list({
    userId: "me", maxResults: 5,
    q: `in:sent subject:(fwd ${vin}) (subject:"TELEX RELEASE" OR subject:"PRINT AT DESTINATION") newer_than:120d`,
  }));
  const id = r.data.messages?.[0]?.id;
  if (!id) return null;
  const m = await gmailCall(() => gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["To", "Date"] }));
  return { to: hdr(m.data.payload.headers, "to"), at: new Date(Number(m.data.internalDate)) };
}

/**
 * Find new release emails and forward each to its customer.
 * opts.days   — how far back to look (default 3)
 * opts.dryRun — report only, send/save nothing
 * opts.recordOnly — record releases you already forwarded, never send anything (backfill)
 */
async function scanReleases({ days = 3, dryRun = false, recordOnly = false } = {}) {
  const gmail = readClient();
  const ids = [];
  let pageToken;
  do {
    const list = await gmail.users.messages.list({ userId: "me", q: `${RELEASE_QUERY} newer_than:${days}d`, maxResults: 100, pageToken });
    ids.push(...(list.data.messages || []));
    pageToken = list.data.nextPageToken;
  } while (pageToken && ids.length < 600);
  // Emails already tied to an order were handled on an earlier run — don't touch Gmail for them
  const known = new Set((await Order.find({ "release.gmailId": { $in: ids.map((m) => m.id) } })
    .select("release.gmailId").lean()).map((o) => o.release.gmailId));
  const results = [];
  for (const { id } of ids) {
    if (known.has(id)) continue;
    const r = { gmailId: id };
    results.push(r);
    try {
      await sleep(400); // stay well under Gmail's per-minute quota
      const msg = (await gmailCall(() => gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Subject"] }))).data;
      const subject = hdr(msg.payload.headers, "subject");
      r.subject = subject;
      r.line = /TELEX RELEASE/i.test(subject) ? "SALLAUM" : "ACL";
      const vin = (subject.toUpperCase().match(VIN_RX) || [])[0];
      if (!vin) { r.result = "no VIN in subject"; continue; }
      r.vin = vin;
      const order = await findOrderByVin(vin);
      if (!order) { r.result = "no order for this VIN"; continue; }
      r.orderRef = order.refNumber;
      if (order.release?.forwardedAt) { r.result = "already sent"; continue; }

      const hand = await forwardedByHand(gmail, vin);
      if (hand) {
        r.result = `you already forwarded it (${hand.to})`;
        if (!dryRun) {
          await Order.updateOne({ _id: order._id }, { $set: {
            "release.forwardedAt": hand.at, "release.forwardedTo": hand.to, "release.gmailId": id, "release.how": "manual",
          } });
          r.completed = await completeIfReady(await Order.findById(order._id));
        }
        continue;
      }

      const to = emailsOf(order.customerEmail);
      if (!to.length) { r.result = "order has no customer email — forward it yourself"; continue; }
      r.to = to.join(", ");
      if (dryRun || recordOnly) { r.result = recordOnly ? "not forwarded yet (record-only run, nothing sent)" : "would forward"; continue; }

      const full = (await gmailCall(() => gmail.users.messages.get({ userId: "me", id, format: "full" }))).data;
      await forwardMessage(gmail, full, to);
      await Order.updateOne({ _id: order._id }, {
        $set: { "release.forwardedAt": new Date(), "release.forwardedTo": r.to, "release.gmailId": id, "release.how": "auto" },
        $push: { timeline: { action: "Release Sent", details: `${r.line} release forwarded to ${r.to}`, createdAt: new Date() } },
      });
      r.result = "forwarded";
      r.completed = await completeIfReady(await Order.findById(order._id));
      await sleep(300);
    } catch (e) {
      r.result = "error: " + e.message;
    }
  }
  return results;
}

const last6 = (vin) => String(vin || "").trim().toUpperCase().slice(-6);

/**
 * Sallaum release request: reply on the voyage's "<VOYAGE> RELEASES" thread with
 * "PLEASE RELEASE" + one VIN last-6 per line, to whoever you wrote to last on that thread.
 */
async function requestSallaumReleases(voyage, orderIds, { dryRun = false } = {}) {
  voyage = String(voyage || "").trim().toUpperCase();
  if (!voyage) throw new Error("voyage required");
  const orders = await Order.find({ _id: { $in: orderIds } }).select("refNumber vin voyage shippingLine").lean();
  if (!orders.length) throw new Error("no orders");
  const bad = orders.filter((o) => String(o.voyage || "").trim().toUpperCase() !== voyage);
  if (bad.length) throw new Error(`not on ${voyage}: #${bad.map((o) => o.refNumber).join(", #")}`);

  const gmail = readClient();
  const subjectWanted = `${voyage} RELEASES`;
  const found = await gmail.users.messages.list({ userId: "me", q: `subject:"${subjectWanted}" newer_than:180d`, maxResults: 20 });
  if (!found.data.messages?.length) throw new Error(`no "${subjectWanted}" email thread found — start it once in Gmail, then this button replies on it`);
  // Newest message on the thread, and the newest one WE sent (its To/Cc are the release desk)
  const threadId = found.data.messages[0].threadId;
  const thread = (await gmail.users.threads.get({ userId: "me", id: threadId, format: "metadata",
    metadataHeaders: ["From", "To", "Cc", "Subject", "Message-ID", "References"] })).data;
  const msgs = thread.messages || [];
  const last = msgs[msgs.length - 1];
  const mine = [...msgs].reverse().find((m) => (m.labelIds || []).includes("SENT"));
  if (!mine) throw new Error(`you haven't written on the "${subjectWanted}" thread yet — reply once in Gmail first`);
  const to = hdr(mine.payload.headers, "to"), cc = hdr(mine.payload.headers, "cc");
  const msgId = hdr(last.payload.headers, "message-id");
  const refs = [hdr(last.payload.headers, "references"), msgId].filter(Boolean).join(" ");
  const subject = /^re:/i.test(hdr(last.payload.headers, "subject")) ? hdr(last.payload.headers, "subject") : `Re: ${subjectWanted}`;

  const vins = orders.map((o) => last6(o.vin)).filter(Boolean);
  const sig = signature();
  const text = ["PLEASE RELEASE", "", ...vins, "", "", sig.text].join("\r\n");
  const html = `<div dir="ltr">PLEASE RELEASE<div><br></div>${vins.map((v) => `<div>${esc(v)}</div>`).join("")}` +
    `<div><br></div><div><br></div>${sig.html}</div>`;
  const preview = { to, cc, subject, vins, orders: orders.map((o) => o.refNumber) };
  if (dryRun) return preview;

  const A = "ALT_" + Date.now();
  const lines = [
    `From: ${fromHeader()}`, `To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), `Subject: ${encSubject(subject)}`,
    ...(msgId ? [`In-Reply-To: ${msgId}`, `References: ${refs}`] : []),
    "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${A}"`, "",
    `--${A}`, 'Content-Type: text/plain; charset="UTF-8"', "", text,
    `--${A}`, 'Content-Type: text/html; charset="UTF-8"', "", html,
    `--${A}--`,
  ];
  await sendRaw(lines, threadId);
  await Order.updateMany({ _id: { $in: orders.map((o) => o._id) } }, {
    $set: { "release.requestedAt": new Date() },
    $push: { timeline: { action: "Release Requested", details: `Sallaum release requested on "${subjectWanted}"`, createdAt: new Date() } },
  });
  return preview;
}

/** ACL: the PAYMENT FOR RELEASE email is the request — mark those bookings' orders requested. */
async function markRequestedByBookings(bookings) {
  const list = (bookings || []).map((b) => String(b).trim()).filter(Boolean);
  if (!list.length) return 0;
  const r = await Order.updateMany(
    { bookingNumber: { $in: list }, "release.requestedAt": null },
    { $set: { "release.requestedAt": new Date() },
      $push: { timeline: { action: "Release Requested", details: "ACL release requested with the payment email", createdAt: new Date() } } },
  );
  return r.modifiedCount || 0;
}

/** Send a car's release to its customer again (customer says they never got it). */
async function resendRelease(vin) {
  vin = String(vin || "").trim().toUpperCase();
  if (!VIN_RX.test(vin)) throw new Error("enter the full 17-character VIN");
  const order = await findOrderByVin(vin);
  if (!order) throw new Error("no order for this VIN");
  const to = emailsOf(order.customerEmail);
  if (!to.length) throw new Error(`#${order.refNumber} has no customer email`);
  const gmail = readClient();
  const found = await gmailCall(() => gmail.users.messages.list({ userId: "me", maxResults: 1, q: `${RELEASE_QUERY} subject:${vin}` }));
  const id = found.data.messages?.[0]?.id;
  if (!id) throw new Error("no Sallaum TELEX RELEASE / ACL PRINT AT DESTINATION email found for this VIN");
  const full = (await gmailCall(() => gmail.users.messages.get({ userId: "me", id, format: "full" }))).data;
  await forwardMessage(gmail, full, to);
  await Order.updateOne({ _id: order._id }, {
    $set: { "release.forwardedAt": order.release?.forwardedAt || new Date(), "release.forwardedTo": to.join(", "), "release.gmailId": id },
    $push: { timeline: { action: "Release Sent", details: `Release re-sent to ${to.join(", ")}`, createdAt: new Date() } },
  });
  return { orderRef: order.refNumber, to: to.join(", "), subject: hdr(full.payload.headers, "subject") };
}

module.exports = { scanReleases, requestSallaumReleases, markRequestedByBookings, completeIfReady, last6, forwardMessage, readClient, resendRelease };
