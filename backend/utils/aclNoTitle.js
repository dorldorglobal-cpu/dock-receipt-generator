/**
 * ACL (Grimaldi) "Cargo Received without Title/Bill of Sale" forms.
 *
 * ACL requires a port-specific form whenever a unit is delivered to the
 * terminal without its title. The blank forms (from ACL, one per port) live in
 * backend/aclNoTitle/; this fills the blanks by drawing text over them.
 *
 * Coordinates are PDF points from the bottom-left, measured from each blank
 * form (Letter, 612×792). All four share the same top section; the date line
 * and signature line sit at different heights per form.
 */
const fs   = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const SHIPPER_NAME = "DOR L DOR GLOBAL";
const SIGNER       = "Eli Levy";

const COMMON = { shipment: [135, 670.5], shipper: [138, 657], pol: [92, 643.6], pod: [94, 630.2] };

const FORMS = {
  JAX:  { file: "JAX.pdf",  label: "Jacksonville", ...COMMON, date: [273, 590], signature: [72, 388] },
  WILM: { file: "WILM.pdf", label: "Wilmington",   ...COMMON, date: [274, 603.5], signature: [72, 429] },
  FPO:  { file: "FPO.pdf",  label: "Freeport",     ...COMMON, date: [273, 590], signature: [72, 388] },
  // Baltimore form is converted from ACL's Word doc: no underscores, POL is pre-printed
  BWI:  { file: "BWI.pdf",  label: "Baltimore",    shipment: [136, 669], shipper: [143, 655.6], pol: null,
          pod: [98, 628.8], date: [264, 588.6], signature: [72, 388] },
};

// Ports ACL ships from that have no form on file yet
const NO_FORM_PORTS = { PVD: "Providence" };

const isAclOrder = (order) => /\b(ACL|GRIMALDI|ATLANTIC CONTAINER)\b/i.test(order?.shippingLine || "");

/** Which ACL port form applies — the delivery terminal wins over POL. */
function aclNoTitlePort(order) {
  const text = `${order?.deliveryLocation || ""} | ${order?.pol || ""}`.toUpperCase();
  if (/JACKSONVILLE|\bJAX\b/.test(text))         return "JAX";
  if (/DELAWARE|WILMINGTON/.test(text))          return "WILM";
  if (/FREEPORT/.test(text))                     return "FPO";
  if (/BALTIMORE|DUNDALK|\bBALT\b/.test(text))   return "BWI";
  if (/PROVIDENCE/.test(text))                   return "PVD";
  return null;
}

/** "YYYY-MM-DD" → "M/D/YYYY"; anything else → one week from today. */
function expectedDateStr(input) {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split("-");
    return `${+m}/${+d}/${y}`;
  }
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/**
 * Fill the port's form for an order.
 * @param {object} order — needs bookingNumber, pod (and pol/deliveryLocation for the port)
 * @param {object} opts  — { port?, expectedDate?: "YYYY-MM-DD" }
 * @returns {Promise<{ bytes: Uint8Array, port: string }>}
 */
async function buildAclNoTitlePdf(order, { port, expectedDate } = {}) {
  port = port || aclNoTitlePort(order);
  const form = FORMS[port];
  if (!form) {
    const err = new Error(NO_FORM_PORTS[port]
      ? `No ACL no-title form on file for ${NO_FORM_PORTS[port]}`
      : "Couldn't tell which ACL port this order delivers to");
    err.status = 404;
    throw err;
  }

  const pdf  = await PDFDocument.load(fs.readFileSync(path.join(__dirname, "..", "aclNoTitle", form.file)));
  const page = pdf.getPages()[0];
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const put  = (pos, text) => {
    if (!pos || !text) return;
    // Standard fonts are WinAnsi-only
    page.drawText(String(text).replace(/[^\x20-\x7E]/g, ""), { x: pos[0], y: pos[1], size: 10.5, font, color: rgb(0, 0, 0) });
  };

  put(form.shipment,  order.bookingNumber);
  put(form.shipper,   SHIPPER_NAME);
  put(form.pol,       form.label);
  put(form.pod,       (order.pod || "").toUpperCase());
  put(form.date,      expectedDateStr(expectedDate));
  put(form.signature, SIGNER);

  return { bytes: await pdf.save(), port };
}

module.exports = { FORMS, NO_FORM_PORTS, isAclOrder, aclNoTitlePort, buildAclNoTitlePdf };
