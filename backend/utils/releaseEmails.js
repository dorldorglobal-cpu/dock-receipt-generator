// "PAYMENT FOR RELEASES" emails to the carriers / container loaders after a payment,
// in the same layout Eli uses:
//
//   Subject: PAYMENT FOR RELEASES 11/12/2026
//   SEE ATTACHED PAYMENT FOR $4260
//   PLEASE APPLY AND RELEASE
//   <table>  booking | container # | (date, for loaders set to show it) | amount   — container loaders
//   <table>  S3-xxxxxxxx | PAD                                                   — ACL, one row per booking
//   -- Regards, signature
//
// Recipients come from each vendor's record ("Release emails" on Edit Vendor) — nothing
// is sent to a company that has none set. The bank proof goes along, redacted so each
// company only sees its own payment.

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const Order = require("../models/Order");
const Vendor = require("../models/Vendor");

// Which payees get a release request, and how their lines are laid out
const RELEASE_VENDORS = [
  { key: "ACL",      company: "ACL / Grimaldi",       match: /\bACL\b|GRIMALDI|ATLANTIC CONTAINER/i, style: "acl" },
  { key: "EZCARGO",  company: "E-Z Cargo",            match: /E\s*-?\s*Z\s*CARGO/i, style: "loader", withDate: true },
  { key: "ISHIP",    company: "iShip",                match: /\bISHIP\b/i,          style: "loader" },
  { key: "SAVANNAH", company: "Savannah Auto Export", match: /SAVANNAH/i,           style: "loader" },
  { key: "CEDARS",   company: "Cedars Express",       match: /CEDARS/i,             style: "loader" },
];
const releaseVendorFor = (name) => RELEASE_VENDORS.find(v => v.match.test(String(name || ""))) || null;

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
// "SEE ATTACHED PAYMENT FOR $4260" — no commas, cents only when there are any
const fmtHead = (n) => "$" + (Number.isInteger(r2(n)) ? String(r2(n)) : r2(n).toFixed(2));
const fmtCell = (n) => "$" + r2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function signature() {
  const name  = process.env.RELEASE_SIGNATURE_NAME  || "Eli Levy";
  const phone = process.env.RELEASE_SIGNATURE_PHONE || "9172003998";
  const email = process.env.RELEASE_SIGNATURE_EMAIL || "DorLdorGlobal@gmail.com";
  return {
    html: '<span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature"><div dir="ltr">Regards,' +
      `<div><br></div><div>${esc(name)}</div><div>${esc(phone)}</div>` +
      (email ? `<div><a href="mailto:${esc(email)}" target="_blank">${esc(email)}</a></div>` : "") + "</div></div>",
    text: ["-- ", "Regards,", "", name, phone, email].filter((x, i) => i < 5 || x).join("\r\n"),
  };
}

// Same table markup as the Sheets table pasted into the emails
function loaderTableHtml(rows, withDate) {
  const first = "border:1px solid rgb(0,0,0);font-size:14pt;text-align:right;overflow:hidden;padding:2px 3px;vertical-align:bottom";
  const rest = (align) => `border-width:1px;border-style:solid;border-color:rgb(0,0,0) rgb(0,0,0) rgb(0,0,0) rgb(204,204,204);font-size:14pt;text-align:${align};overflow:hidden;padding:2px 3px;vertical-align:bottom`;
  const trs = rows.map(r =>
    `<tr><td style="${first}">${esc(r.booking)}</td><td style="${rest("center")}">${esc(r.ref)}</td>` +
    `<td style="${rest("right")}">${withDate ? esc(r.date) : ""}</td><td style="${rest("right")}">${esc(fmtCell(r.amount))}</td></tr>`).join("");
  return '<table cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border-width:medium;border-style:none;border-color:currentcolor">' +
    '<colgroup><col width="179"><col width="100"><col width="100"><col width="100"></colgroup><tbody>' + trs + "</tbody></table>";
}
function aclTableHtml(bookings) {
  const td = "border:1px solid rgb(204,204,204);overflow:hidden;padding:2px 3px;vertical-align:bottom";
  const trs = bookings.map(b => `<tr><td style="${td}">${esc(b)}</td><td style="${td}">PAD</td></tr>`).join("");
  return '<table cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:arial,sans,sans-serif;width:0px;border-collapse:collapse;border-width:medium;border-style:none;border-color:currentcolor">' +
    '<colgroup><col width="112"><col width="107"></colgroup><tbody>' + trs + "</tbody></table>";
}

// Release recipients saved on the vendor's record (Edit Vendor → "Release emails")
async function releaseRecipients(vendorNames) {
  const { makeCanonicalizer } = require("./vendorMatch");
  const canon = await makeCanonicalizer();
  const names = [...new Set(vendorNames.map(n => canon(n)).filter(Boolean))];
  const recs = await Vendor.find({ releaseEmails: { $nin: ["", null] } }).select("name releaseEmails").lean();
  const lc = new Map(recs.map(r => [String(r.name).toLowerCase().trim(), r.releaseEmails]));
  const out = [];
  for (const n of names) {
    const v = lc.get(String(n).toLowerCase().trim());
    if (v) out.push(...String(v).split(/[\n;]+|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s => s.trim()).filter(s => /@/.test(s)));
  }
  return [...new Set(out)];
}

/**
 * Drafts for the release vendors paid in one payment-proof import.
 * @param paidLog  [{ vendor, orderRef, amount, payee }]  what this import paid (payee = bank payee name)
 * @param dateStr  "11/12/2026"
 */
async function buildReleaseDrafts(paidLog, dateStr) {
  const ContainerLoad = require("../models/ContainerLoad");
  const groups = new Map();
  for (const p of paidLog) {
    const rv = releaseVendorFor(p.vendor) || releaseVendorFor(p.payee);
    if (!rv) continue;
    if (!groups.has(rv.key)) groups.set(rv.key, { rv, lines: [], payees: new Set(), vendors: new Set() });
    const g = groups.get(rv.key);
    g.lines.push(p);
    if (p.payee) g.payees.add(p.payee);
    if (p.vendor) g.vendors.add(p.vendor);
  }
  const sig = signature();
  const drafts = [];
  for (const { rv, lines, payees, vendors } of groups.values()) {
    const total = r2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
    const refs = [...new Set(lines.map(l => l.orderRef).filter(Boolean))];
    const orders = await Order.find({ refNumber: { $in: refs } }).select("_id refNumber bookingNumber").lean();
    const byRef = new Map(orders.map(o => [o.refNumber, o]));
    let tableHtml, textRows, bookings = [];
    if (rv.style === "acl") {
      bookings = [...new Set(refs.map(r => byRef.get(r)?.bookingNumber).filter(Boolean))].sort();
      tableHtml = aclTableHtml(bookings);
      textRows = bookings.map(b => `${b} PAD`);
    } else {
      // One row per container: booking | container # (from the load's name) | date | amount
      const loads = await ContainerLoad.find({ orderIds: { $in: orders.map(o => o._id) } }).select("name bookingNumber orderIds").lean();
      const loadOf = (o) => loads.find(l => (l.orderIds || []).some(id => String(id) === String(o?._id)));
      const rows = new Map();
      for (const l of lines) {
        const o = byRef.get(l.orderRef);
        const load = loadOf(o);
        const key = load ? String(load._id) : (o?.bookingNumber || l.orderRef);
        if (!rows.has(key)) rows.set(key, {
          booking: load?.bookingNumber || o?.bookingNumber || "",
          ref: (String(load?.name || "").match(/^\s*(\d{4,6})/) || [])[1] || l.orderRef,
          date: dateStr, amount: 0,
        });
        const row = rows.get(key);
        row.amount = r2(row.amount + Number(l.amount || 0));
      }
      const list = [...rows.values()];
      tableHtml = loaderTableHtml(list, rv.withDate);
      textRows = list.map(r => [r.booking, r.ref, rv.withDate ? r.date : "", fmtCell(r.amount)].filter(Boolean).join(" "));
    }
    const html = `<div dir="ltr"><div><div>SEE ATTACHED PAYMENT FOR ${esc(fmtHead(total))}</div><div>PLEASE APPLY AND RELEASE</div></div>` +
      `<div><br></div><div>${tableHtml}</div><div><br></div>${sig.html}</div>`;
    const text = [`SEE ATTACHED PAYMENT FOR ${fmtHead(total)}`, "PLEASE APPLY AND RELEASE", "", ...textRows, "", sig.text].join("\r\n");
    drafts.push({
      key: rv.key, company: rv.company, to: await releaseRecipients([...vendors, ...payees]),
      subject: `PAYMENT FOR RELEASES ${dateStr}`, html, text, total, payees: [...payees], orderRefs: refs,
      bookings, paidDate: dateStr, style: rv.style,
      vendorName: [...vendors][0] || rv.company,
    });
  }
  return drafts;
}

/** Redact the bank proof so only these payees' payments show. → { buffer, info } */
function redactProof(pdfBuffer, payees) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proof-"));
    const src = path.join(dir, "in.pdf"), dst = path.join(dir, "out.pdf");
    fs.writeFileSync(src, pdfBuffer);
    const py = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
    execFile(py, [path.join(__dirname, "..", "redact_proof.py"), src, dst, payees.join("|")], { timeout: 60000 }, (err, stdout, stderr) => {
      try {
        if (err) return reject(new Error((stderr || err.message).trim().split("\n").pop()));
        const info = JSON.parse(String(stdout).trim().split("\n").pop() || "{}");
        if (!info.kept?.length) return reject(new Error(`the proof has no payment to ${payees.join(" / ")}`));
        resolve({ buffer: fs.readFileSync(dst), info });
      } catch (e) { reject(e); }
      finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
    });
  });
}

/** Send one release email with its redacted proof. */
async function sendReleaseEmail(draft, proof /* { buffer, name } */) {
  if (!draft.to?.length) throw new Error("no release emails set on this vendor");
  const { getGmailAccessToken } = require("./gmail");
  const { b64lines } = require("./mime");
  const from = `${process.env.RELEASE_SIGNATURE_NAME || "Eli Levy"} <${process.env.GMAIL_USER}>`;
  const boundary = "REL_" + Date.now(), alt = "ALT_" + Date.now();
  const mime = [
    `From: ${from}`, `To: ${draft.to.join(", ")}`,
    `Subject: =?UTF-8?B?${Buffer.from(draft.subject).toString("base64")}?=`,
    "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    `--${boundary}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "",
    `--${alt}`, 'Content-Type: text/plain; charset="UTF-8"', "", draft.text,
    `--${alt}`, 'Content-Type: text/html; charset="UTF-8"', "", draft.html,
    `--${alt}--`,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${proof.name}"`, "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${proof.name}"`, "",
    b64lines(proof.buffer.toString("base64")), `--${boundary}--`,
  ];
  const token = await getGmailAccessToken();
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(mime.join("\r\n")).toString("base64url") }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || `Gmail ${r.status}`);
  return true;
}

module.exports = { RELEASE_VENDORS, releaseVendorFor, buildReleaseDrafts, redactProof, sendReleaseEmail, releaseRecipients, signature };
