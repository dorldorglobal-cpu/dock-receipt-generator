// Units going to Cotonou need their CTN (Cargo Tracking Note) PDF sent along with
// the invoice and the Draft BL. CTN files are order docs labelled "CTN".
const path = require("path");
const os = require("os");
const fs = require("fs");

const isCotonou = (order) => /COTONOU|BENIN/i.test(String(order?.pod || ""));
const ctnFiles  = (order) => (order?.files || []).filter(f => String(f.label || "").toUpperCase() === "CTN" && f.driveFileId);

// → [{ filename, content (base64), encoding }] for every CTN on a Cotonou order; [] otherwise.
// Never throws — a missing CTN must not stop the email.
async function ctnAttachments(order, skipIds = []) {
  if (!isCotonou(order)) return [];
  const { downloadDriveFile } = require("../googleDrive");
  const out = [];
  for (const f of ctnFiles(order)) {
    if (skipIds.includes(f.driveFileId)) continue;
    try {
      const tmp = path.join(os.tmpdir(), `ctn-${Date.now()}-${f.driveFileId}`);
      await downloadDriveFile(f.driveFileId, tmp);
      const buf = fs.readFileSync(tmp);
      fs.unlinkSync(tmp);
      out.push({ filename: f.originalName || f.filename || `CTN-${order.refNumber || ""}.pdf`, content: buf.toString("base64"), encoding: "base64" });
    } catch (e) {
      console.warn(`[CTN] couldn't attach CTN for #${order?.refNumber}:`, e.message);
    }
  }
  if (!out.length) console.warn(`[CTN] #${order?.refNumber} goes to Cotonou but has no CTN document`);
  return out;
}

module.exports = { isCotonou, ctnFiles, ctnAttachments };
