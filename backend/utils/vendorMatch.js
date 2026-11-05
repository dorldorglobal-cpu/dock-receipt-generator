/**
 * Vendor-name matching shared by bill imports, payment proofs, DR sends and
 * trucker payment emails. Names on dispatch sheets and bank proofs are looser
 * than our vendor names ("ACL" vs "ACL / Grimaldi", "Castle Auto" vs "Castle
 * Auto Transportation"), so they're compared case/punctuation/LLC-insensitively.
 */
const Expense = require("../models/Expense");
const Vendor  = require("../models/Vendor");

const normVendorName = (s) => (s || "").replace(/['‘’`]/g, "").replace(/\b(LLC|INC|CORP|LTD|CO)\b\.?/gi, "")
  .replace(/\bTRANSPORTATION\b/gi, "TRANSPORT")
  .replace(/[^A-Z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();

const sameVendor = (a, b) => {
  const x = normVendorName(a), y = normVendorName(b);
  return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " "));
};

// Map a name ("Castle Auto") to the vendor name already in use ("Castle Auto
// Transportation"), so each new bill doesn't start a new vendor. With several
// matches, the one with the most bills wins.
async function canonicalVendor(name) {
  name = (name || "").trim();
  if (!name) return name;
  const counts = await Expense.aggregate([{ $match: { vendor: { $nin: ["", null] } } }, { $group: { _id: "$vendor", n: { $sum: 1 } } }]);
  const vendorRecs = await Vendor.find({}).select("name").lean();
  const pool = new Map(counts.map(c => [c._id, c.n]));
  for (const v of vendorRecs) if (!pool.has(v.name)) pool.set(v.name, 0);
  const want = normVendorName(name);
  // Exact match (ignoring case/punctuation/LLC) always counts; a prefix match
  // only when the shorter name is 2+ words, so "A" doesn't grab "A TO Z"
  const ok = (n) => {
    const have = normVendorName(n);
    if (have === want) return true;
    const shorter = have.length < want.length ? have : want;
    return shorter.split(" ").length >= 2 && sameVendor(n, name);
  };
  const matches = [...pool.entries()].filter(([n]) => ok(n)).sort((a, b) => b[1] - a[1]);
  return matches[0]?.[0] || name;
}

const exactName = (n) => ({ $regex: `^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" });
const emailList = (s) => (s || "").split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

/** The email(s) on file for a vendor name (matched loosely), or "". */
async function vendorEmail(name) {
  const canon = await canonicalVendor(name);
  if (!canon) return "";
  const rec = await Vendor.findOne({ name: exactName(canon) }).select("email").lean();
  return rec?.email || "";
}

/**
 * Remember an email for a vendor: added to the vendor record (created if the
 * vendor only exists on bills). Existing addresses are kept; a new one is
 * appended, up to 3.
 */
async function saveVendorEmail(name, email, category = "") {
  const add = emailList(email);
  const canon = await canonicalVendor(name);
  if (!canon || !add.length) return null;
  const rec = await Vendor.findOne({ name: exactName(canon) });
  if (!rec) return Vendor.create({ name: canon, email: add.slice(0, 3).join(", "), category });
  const have = emailList(rec.email);
  const merged = [...new Set([...have, ...add])].slice(0, 3);
  if (merged.length === have.length) return rec;
  rec.email = merged.join(", ");
  return rec.save();
}

module.exports = { normVendorName, sameVendor, canonicalVendor, vendorEmail, saveVendorEmail, emailList };
