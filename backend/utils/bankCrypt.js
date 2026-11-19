// Vendor bank account / routing numbers are stored encrypted (AES-256-GCM).
// Key: BANK_DATA_KEY if set, otherwise the app's JWT_SECRET. If that secret
// is ever changed, set BANK_DATA_KEY to the old value or the saved numbers
// can't be read back (re-enter them).
const crypto = require("crypto");

function key() {
  const secret = process.env.BANK_DATA_KEY || process.env.JWT_SECRET;
  if (!secret) return null;
  return crypto.createHash("sha256").update("vendor-bank:" + secret).digest();
}

const hasKey = () => !!key();

function encrypt(plain) {
  const k = key();
  if (!k) throw new Error("Bank details can't be saved: no BANK_DATA_KEY / JWT_SECRET set on the server");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

function decrypt(blob) {
  if (!blob) return "";
  const k = key();
  if (!k) throw new Error("No BANK_DATA_KEY / JWT_SECRET set on the server");
  const [v, iv, tag, data] = String(blob).split(":");
  if (v !== "v1") throw new Error("Unknown bank data format");
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

// US ABA routing number: 9 digits with the 3-7-1 checksum
function validRouting(r) {
  if (!/^\d{9}$/.test(r)) return false;
  const d = r.split("").map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

// Turn plain bankAccount / bankRouting in a vendor save body into encrypted
// fields + last-4s. Blank = leave what's on file; bankClear = remove both.
// Throws { status: 400 } on a bad number.
function applyBankFields(body) {
  const out = { ...body };
  delete out.bankAccountEnc; delete out.bankRoutingEnc;
  delete out.bankAccountLast4; delete out.bankRoutingLast4; delete out.bankUpdatedAt;
  const acct = String(out.bankAccount ?? "").replace(/[\s-]/g, "");
  const rtn  = String(out.bankRouting ?? "").replace(/[\s-]/g, "");
  const clear = out.bankClear === true;
  delete out.bankAccount; delete out.bankRouting; delete out.bankClear;
  const bad = msg => Object.assign(new Error(msg), { status: 400 });
  if (clear) {
    Object.assign(out, { bankAccountEnc: "", bankRoutingEnc: "", bankAccountLast4: "", bankRoutingLast4: "", bankUpdatedAt: new Date() });
    return out;
  }
  if (acct) {
    if (!/^[0-9A-Za-z]{4,34}$/.test(acct)) throw bad("Account number should be 4–34 digits/letters");
    Object.assign(out, { bankAccountEnc: encrypt(acct), bankAccountLast4: acct.slice(-4), bankUpdatedAt: new Date() });
  }
  if (rtn) {
    if (!validRouting(rtn)) throw bad("Routing number isn't valid (must be 9 digits and pass the bank checksum)");
    Object.assign(out, { bankRoutingEnc: encrypt(rtn), bankRoutingLast4: rtn.slice(-4), bankUpdatedAt: new Date() });
  }
  return out;
}

module.exports = { encrypt, decrypt, validRouting, applyBankFields, hasKey };
