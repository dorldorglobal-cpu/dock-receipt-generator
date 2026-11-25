/**
 * Ghana office container-load emails → draft container loads.
 *
 * The Ghana office emails "<ref> CONTAINER TO <POD> ISRAEL – <NJ|GA|CA|TX>" with
 * the main consignee, the notify party, each car (year make model #VIN, then the
 * car owner's name/address) and sometimes parts/boxes with tracking numbers.
 * scanLoadEmails() reads those and builds a load named "<ref> LOAD-<MON><day>"
 * (the day it's built, US Eastern) with needsApproval set, so:
 *   - car statuses don't move (utils/loadStatus.js skips drafts),
 *   - the Dashboard and Containers page show it as needing approval,
 *   - nothing is emailed — the loader email is still sent by hand after approval.
 * If a load for that ref already exists (shares a car), nothing is changed; the
 * difference (cars/parts added or removed) is recorded for the Containers page.
 *
 * Reads with GMAIL_READ_REFRESH_TOKEN, like utils/releaseWatch.js.
 */
const ContainerLoad = require("../models/ContainerLoad");
const LoadEmail = require("../models/LoadEmail");
const Order = require("../models/Order");
const { findWarehouse } = require("./warehouses");
const { readClient } = require("./releaseWatch");

const GHANA_DOMAIN = "dorldorgh.com";
const QUERY = `from:${GHANA_DOMAIN} subject:"CONTAINER TO" -in:sent`;
const VIN_RX = /(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])/g;
const VIN_ONE = /^[A-HJ-NPR-Z0-9]{17}$/;
const hasVin = (l) => (String(l).toUpperCase().match(VIN_RX) || []).filter(v => /\d/.test(v) && /[A-Z]/.test(v));
const PARTS_HEAD = /^(PARTS?|BOX(ES)?|PACKAGES?|CARTONS?|ITEMS?)\b/i;
const PODS = ["TEMA", "TAKORADI", "LAGOS", "TINCAN", "LOME", "COTONOU", "ABIDJAN"];
const CARRIERS = [["UPS"], ["FEDEX", "FED EX"], ["USPS"], ["DHL"], ["TFORCE", "T-FORCE", "T FORCE"], ["ONTRAC"], ["AMAZON"], ["ESTES"], ["XPO"], ["SAIA"], ["OLD DOMINION", "ODFL"], ["R+L", "RL CARRIERS"], ["YRC", "YELLOW"], ["PITNEY"], ["LASERSHIP"]];

const clean = (s) => String(s || "").replace(/[​ ]/g, " ").replace(/mailto:/gi, "").replace(/[ \t]+/g, " ").trim();

// ── Subject: "14128 CONTAINER TO TEMA ISRAEL – NJ (UPDATED …)" ────────────────
function parseSubject(subject) {
  const s = clean(subject).toUpperCase();
  if (/^(RE|FW|FWD)\s*:/.test(s)) return null;
  const m = s.match(/^(\d{4,6})\s+CONTAINER\s+TO\s+([A-Z]+)/);
  if (!m) return null;
  const pod = PODS.find(p => m[2].startsWith(p)) || m[2];
  // Warehouse: the state/warehouse after the last dash ("– NJ", "- GA", "- HOUSTON")
  const tail = s.replace(/\(.*?\)/g, "").split(/\s[-–—]\s|[-–—]\s*(?=[A-Z]{2,}\s*$)/).pop().trim();
  const wh = tail && tail !== s ? findWarehouse(tail) : null;
  return { ref: m[1], pod, warehouse: wh?.key || "", polText: tail !== s ? tail : "", updated: /UPDATE|REVISED|REPLACE/.test(s) };
}

// ── Party block: name, address lines, TEL / EMAIL / TIN ───────────────────────
function parseParty(lines) {
  const p = { name: "", address: [], phone: "", email: "", tin: "" };
  for (const raw of lines) {
    const l = clean(raw);
    if (!l) continue;
    let m;
    if ((m = l.match(/^(?:TEL|PHONE|MOB(?:ILE)?)\s*[:#.]?\s*(.+)$/i))) p.phone = m[1].trim();
    else if ((m = l.match(/^E-?MAIL\s*[:#.]?\s*(.+)$/i))) p.email = (m[1].match(/[^\s<>]+@[^\s<>]+/) || [m[1]])[0].trim();
    else if ((m = l.match(/^TIN\s*(?:#|NO\.?|NUMBER)?\s*[:#.]?\s*(.+)$/i))) p.tin = m[1].trim();
    else if (!p.name) p.name = l;
    else p.address.push(l);
  }
  return { name: p.name, address: p.address.join(", "), phone: p.phone, email: p.email, tin: p.tin };
}

// Tracking-number-looking token on a parts line (not a VIN, not a phone number)
function trackingIn(line) {
  const u = clean(line).toUpperCase();
  if (/^(TEL|PHONE|MOB)/.test(u)) return "";
  const toks = u.match(/\b(1Z[0-9A-Z]{16}|[A-Z]{0,5}\d[0-9A-Z]{7,30})\b/g) || [];
  return toks.find(t => {
    if (/^1Z/.test(t)) return true;
    if (VIN_ONE.test(t) && /[A-Z]/.test(t)) return false;           // a VIN
    if (t.replace(/\D/g, "").length < 8) return false;
    if (/^0\d{9}$/.test(t) || /^233\d+$/.test(t)) return false;    // Ghana phone number
    return true;
  }) || "";
}
const carrierIn = (line) => {
  const u = clean(line).toUpperCase();
  const hit = CARRIERS.find(names => names.some(n => u.includes(n)));
  return hit ? hit[0] : "";
};

// ── Body ──────────────────────────────────────────────────────────────────────
function parseBody(text) {
  // Stop at the signature
  const body = String(text || "").split(/\n\s*(?:Regards|Best regards|Kind regards|Thanks|Thank you)\b/i)[0];
  const lines = body.split(/\r?\n/).map(clean);
  const idxCons = lines.findIndex(l => /^(MAIN\s+)?CONSIGNEE\b/i.test(l));
  const idxNotify = lines.findIndex((l, i) => i > idxCons && /^NOTIFY\b/i.test(l));
  const firstVinLine = lines.findIndex(l => hasVin(l).length);

  const consigneeLines = idxCons >= 0 ? lines.slice(idxCons + 1, idxNotify > idxCons ? idxNotify : firstVinLine) : [];
  let notifyLines = [];
  if (idxNotify >= 0) {
    // Notify block ends at its TIN line, else at the first car (a year line or a VIN line)
    const end = firstVinLine > idxNotify ? firstVinLine : lines.length;
    notifyLines = lines.slice(idxNotify + 1, end);
    const tinAt = notifyLines.findIndex(l => /^TIN\b/i.test(l));
    if (tinAt >= 0) notifyLines = notifyLines.slice(0, tinAt + 1);
    else notifyLines = notifyLines.filter(l => !/^(19|20)\d{2}$/.test(l));
  }

  // Cars: each VIN, with the year/make/model text just before it and the owner lines after
  const units = [];
  const vinLines = [];
  lines.forEach((l, i) => { const m = hasVin(l); if (m.length) vinLines.push({ i, vins: m }); });
  vinLines.forEach(({ i, vins }, k) => {
    const nextAt = k + 1 < vinLines.length ? vinLines[k + 1].i : lines.length;
    for (const vin of vins) {
      let ymm = lines[i].toUpperCase().split(vin)[0].replace(/#\s*$/, "").trim();
      if (!/^(19|20)\d{2}\b/.test(ymm)) {
        const prev = lines.slice(Math.max(0, i - 3), i).filter(Boolean);
        const year = [...prev].reverse().find(l => /^(19|20)\d{2}$/.test(l));
        if (year) ymm = `${year} ${ymm}`.trim();
      }
      // Owner: non-empty lines after the VIN, up to the next car / parts header (max 4)
      const after = [];
      for (let j = i + 1; j < nextAt && after.length < 4; j++) {
        const l = lines[j];
        if (!l) continue;
        if (/^(19|20)\d{2}$/.test(l) || PARTS_HEAD.test(l) || trackingIn(l)) break;
        after.push(l);
      }
      units.push({ vin, ymm: ymm.replace(/\s+/g, " "), owner: after.join(" · ") });
    }
  });

  // Parts / boxes: from a "Parts …" / "Boxes …" header on, or any later line with a tracking #
  const lastVinAt = vinLines.length ? vinLines[vinLines.length - 1].i : (idxNotify >= 0 ? idxNotify : 0);
  const parts = [];
  let owner = "";
  let inParts = false;
  for (let j = Math.max(lastVinAt, 0); j < lines.length; j++) {
    const l = lines[j];
    if (!l) continue;
    const head = l.match(/^(?:PARTS?|BOX(?:ES)?|PACKAGES?|CARTONS?|ITEMS?)\b(?:\s+(?:FOR|OF)\s+(.+?))?\s*:?\s*$/i)
      || l.match(/^(?:PARTS?|BOX(?:ES)?|PACKAGES?)\s+(?:FOR|OF)\s+(.+?)\s*:\s*(.*)$/i);
    if (head) { inParts = true; owner = clean(head[1] || ""); if (!head[2]) continue; }
    const tracking = trackingIn(l);
    const numbered = /^\s*(\d+[.)]|[-•*])\s+/.test(l);
    if (tracking || (inParts && numbered)) {
      const description = clean(l.replace(/^\s*(\d+[.)]|[-•*])\s+/, "").replace(tracking, "").replace(new RegExp(carrierIn(l), "i"), "")).replace(/^[-–:,\s]+|[-–:,\s]+$/g, "");
      parts.push({ owner, carrier: carrierIn(l), tracking, description });
    }
  }
  return { consignee: parseParty(consigneeLines), notify: parseParty(notifyLines), units, parts };
}

// ── Gmail helpers ─────────────────────────────────────────────────────────────
function bodyText(payload) {
  const parts = [];
  const walk = (p) => { if (p.parts) p.parts.forEach(walk); else parts.push(p); };
  walk(payload);
  const dec = (p) => Buffer.from(p.body?.data || "", "base64").toString("utf8");
  const plain = parts.filter(p => p.mimeType === "text/plain" && p.body?.data).map(dec).join("\n");
  if (plain.trim()) return plain;
  return parts.filter(p => p.mimeType === "text/html" && p.body?.data).map(dec).join("\n")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function easternLoadName(ref, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${ref} LOAD-${p.month.toUpperCase()}${p.day}`;
}

const v8 = (v) => String(v || "").toUpperCase().slice(-8);

// Match parsed VINs to orders: full VIN, then last 8 (Ghana sometimes mistypes the front)
async function matchOrders(units) {
  const lastEights = units.map(u => v8(u.vin));
  const orders = await Order.find({ $or: [{ vin: { $in: units.map(u => u.vin) } }, { vin: { $regex: `(${lastEights.join("|")})$`, $options: "i" } }] })
    .select("_id refNumber vin year make model status customerName").lean();
  return units.map(u => {
    const exact = orders.filter(o => String(o.vin || "").toUpperCase() === u.vin);
    const loose = exact.length ? exact : orders.filter(o => v8(o.vin) === v8(u.vin));
    // Several orders for one VIN: prefer one that isn't finished
    const pick = loose.find(o => !["Completed", "Canceled"].includes(o.status)) || loose[0] || null;
    return { ...u, order: pick };
  });
}

const unitLabel = (u) => `${u.order ? [u.order.year, u.order.make, u.order.model].filter(Boolean).join(" ") : u.ymm} ${u.vin}`.replace(/\s+/g, " ").trim();
const partLabel = (p) => [p.owner, p.carrier, p.tracking, p.description].filter(Boolean).join(" — ");

/**
 * Handle one email. Returns { result, loadName, ... } (also stored as a LoadEmail row).
 */
async function handleEmail({ gmailId, subject, from, receivedAt, text }, { dryRun = false } = {}) {
  const head = parseSubject(subject);
  if (!head) {
    const row = { gmailId, subject, from, receivedAt, result: "ignored", note: "subject isn't a new load list (reply / forward)" };
    if (!dryRun) await LoadEmail.create(row);
    return row;
  }
  const parsed = parseBody(text);
  const units = await matchOrders(parsed.units);
  const base = { gmailId, subject, from, receivedAt, ref: head.ref };
  if (!units.length) {
    const row = { ...base, result: "skipped", note: "no VINs found in the email" };
    if (!dryRun) await LoadEmail.create(row);
    return row;
  }

  // Existing load for this ref that shares a car → don't touch it, just record the difference
  const orderIds = units.filter(u => u.order).map(u => String(u.order._id));
  const candidates = await ContainerLoad.find({ name: { $regex: `^${head.ref}\\b` } }).sort({ createdAt: -1 }).lean();
  const existing = candidates.find(l => (l.orderIds || []).some(id => orderIds.includes(String(id))));
  if (existing) {
    const have = new Set((existing.orderIds || []).map(String));
    const want = new Set(orderIds);
    const added = units.filter(u => !u.order || !have.has(String(u.order._id))).map(unitLabel);
    const removedIds = [...have].filter(id => !want.has(id));
    const removedOrders = removedIds.length ? await Order.find({ _id: { $in: removedIds } }).select("year make model vin").lean() : [];
    const removed = removedOrders.map(o => `${[o.year, o.make, o.model].filter(Boolean).join(" ")} ${o.vin || ""}`.trim());
    const haveParts = new Set((existing.parts || []).map(p => (p.tracking || p.description || "").toUpperCase()));
    const partsAdded = parsed.parts.filter(p => !haveParts.has((p.tracking || p.description || "").toUpperCase())).map(partLabel);
    const changed = added.length || removed.length || partsAdded.length;
    const row = { ...base, result: changed ? "changed" : "same", loadId: existing._id, loadName: existing.name, added, removed, partsAdded };
    if (!dryRun) await LoadEmail.create(row);
    return row;
  }

  // New draft load
  const warnings = [];
  for (const u of units) if (!u.order) warnings.push(`${u.ymm || "Car"} ${u.vin} — no order with this VIN`);
  const inOther = orderIds.length ? await ContainerLoad.find({ orderIds: { $in: orderIds } }).select("name orderIds").lean() : [];
  for (const l of inOther) for (const id of l.orderIds.map(String).filter(id => orderIds.includes(id))) {
    const u = units.find(x => x.order && String(x.order._id) === id);
    warnings.push(`#${u.order.refNumber} ${u.vin} is already in load ${l.name}`);
  }
  for (const u of units) if (u.order && ["Completed", "Canceled", "Sailed", "Arrived"].includes(u.order.status))
    warnings.push(`#${u.order.refNumber} ${u.vin} is ${u.order.status}`);
  if (!head.warehouse) warnings.push(`Warehouse "${head.polText || "?"}" from the subject didn't match a loader — pick the POL`);

  const wh = head.warehouse ? findWarehouse(head.warehouse) : null;
  const name = easternLoadName(head.ref);
  const doc = {
    name, pod: head.pod, pol: head.warehouse || head.polText || "",
    loaderEmail: wh?.loaderTo || "", loaderCc: wh?.loaderCc || "",
    orderIds: [...new Set(orderIds)],
    consigneeName: parsed.consignee.name, consigneeAddress: parsed.consignee.address, consigneePhone: parsed.consignee.phone,
    consigneeEmail: parsed.consignee.email, consigneeTin: parsed.consignee.tin,
    notifyName: parsed.notify.name, notifyAddress: parsed.notify.address, notifyPhone: parsed.notify.phone,
    notifyEmail: parsed.notify.email, notifyTin: parsed.notify.tin,
    parts: parsed.parts,
    needsApproval: true,
    fromEmail: { gmailId, subject, from, receivedAt, body: String(text || "").slice(0, 20000) },
    emailWarnings: warnings,
    notes: units.map(u => `${u.order ? "#" + u.order.refNumber : "??"} ${u.vin}${u.owner ? " — " + u.owner : ""}`).join("\n"),
  };
  if (dryRun) return { ...base, result: "created", loadName: name, preview: doc, units: units.map(unitLabel) };
  const load = await ContainerLoad.create(doc);
  const row = { ...base, result: "created", loadId: load._id, loadName: name, added: units.map(unitLabel), partsAdded: parsed.parts.map(partLabel) };
  await LoadEmail.create(row);
  console.log(`[ghana-loads] Draft load ${name} — ${units.length} car(s), ${parsed.parts.length} part(s)${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
  return row;
}

async function scanLoadEmails({ days = 3, dryRun = false, only = null } = {}) {
  const gmail = readClient();
  const list = await gmail.users.messages.list({ userId: "me", q: `${QUERY} newer_than:${days}d`, maxResults: 25 });
  const ids = (list.data.messages || []).map(m => m.id).filter(id => !only || only.includes(id));
  const seen = new Set((await LoadEmail.find({ gmailId: { $in: ids } }).select("gmailId").lean()).map(r => r.gmailId));
  const out = [];
  for (const id of ids.reverse()) {   // oldest first, so an UPDATED email comes after the original
    if (seen.has(id) && !dryRun) continue;
    try {
      const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const h = Object.fromEntries((msg.data.payload.headers || []).map(x => [x.name.toLowerCase(), x.value]));
      if (!String(h.from || "").toLowerCase().includes(GHANA_DOMAIN)) continue;
      const r = await handleEmail({ gmailId: id, subject: h.subject || "", from: h.from || "",
        receivedAt: new Date(Number(msg.data.internalDate)), text: bodyText(msg.data.payload) }, { dryRun });
      out.push(r);
    } catch (e) {
      console.warn(`[ghana-loads] ${id}:`, e.message);
      out.push({ gmailId: id, result: "error", note: e.message });
    }
  }
  return out;
}

module.exports = { scanLoadEmails, handleEmail, parseSubject, parseBody, easternLoadName };
