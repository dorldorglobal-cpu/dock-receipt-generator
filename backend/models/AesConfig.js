const mongoose = require("mongoose");

/**
 * Singleton document holding the company-wide constants an AES / EEI filing
 * needs that are NOT derivable from an Order: DDG's own identity as the
 * authorized/forwarding agent, the CBP Filer ID, and the handful of
 * "always the same" filing defaults for a used-vehicle export.
 *
 * IMPORTANT — confirmed from a real accepted filing (order 14217): DDG files
 * as the AUTHORIZED AGENT (forwardingAgent below), NOT the USPPI. The USPPI
 * varies per vehicle (it's the seller of record — an insurance company, a
 * bank, an individual, etc.) and is captured per-Order (exporterName/
 * exporterAddress/... + usppiEin — see Order.js), not here. The usppi*
 * fields below exist only as a fallback for the rare order where DDG really
 * is the USPPI (e.g. vehicles DDG owns outright).
 *
 * There is exactly one of these — load it with AesConfig.getSingleton().
 * Port / country / carrier / Schedule B code tables do NOT live here; they are
 * in backend/utils/aesCodes.js (like PORT_DEFS / WAREHOUSES).
 */
const aesConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "singleton", unique: true },

    // ── USPPI fallback (party type "E") — used only when the order has no
    // exporterName of its own. See the note above: normally per-order. ───────
    usppiName:         { type: String, default: "" },
    usppiEin:          { type: String, default: "" },   // digits only (EIN + 2-digit suffix, e.g. 11 digits)
    usppiIdType:       { type: String, default: "E" },  // "E" = EIN (per WebLink sample)
    usppiAddress1:     { type: String, default: "" },
    usppiAddress2:     { type: String, default: "" },
    usppiCity:         { type: String, default: "" },
    // Not read by the builder — state of origin (ST) IS the USPPI's state on
    // every real filing, so there's one shared fallback: defaultStateOfOrigin
    // below. Kept in the schema only so an old value here isn't silently lost.
    usppiState:        { type: String, default: "" },
    usppiZip:          { type: String, default: "" },
    usppiContactFirst: { type: String, default: "" },
    usppiContactLast:  { type: String, default: "" },
    usppiPhone:        { type: String, default: "" },

    // ── Forwarding agent — party type "F". This is DDG's own identity and is
    // sent on every filing (it's how DDG actually files — see note above).
    // Defaults below are DDG's real agent info as printed on a CBP-accepted
    // EEI (order 14217) — override on the AES Settings page if anything changed. ─
    forwardingAgent: {
      idType:   { type: String, default: "E" },
      name:     { type: String, default: "DOR LDOR GLOBAL" },
      partyId:  { type: String, default: "" },   // DDG's EIN — not shown on the EEI printout, add it here
      contact:  { type: String, default: "" },
      phone:    { type: String, default: "" },
      address1: { type: String, default: "23 GALAHAD DR" },
      address2: { type: String, default: "" },
      city:     { type: String, default: "MANALAPAN" },
      state:    { type: String, default: "NJ" },
      country:  { type: String, default: "US" },
      postal:   { type: String, default: "07726" },
    },

    // ── Filer + filing defaults ───────────────────────────────────────────────
    filerId:              { type: String, default: "" },    // CBP Filer ID (FID), <= 11 chars
    // Shipment Reference Number prefix. Default "" — confirmed against a real DDG
    // filing, CBP shows "Shipment Reference Number: 14217" with no prefix, i.e.
    // the convention already in use is just the bare order number.
    srnPrefix:            { type: String, default: "" },
    responseEmail:        { type: String, default: "" },     // AES response notifications go here

    defaultFilingAction:  { type: String, default: "A" },    // A = Add
    // Filing option. Default "2" (PREDEPARTURE) — confirmed in all 307 sampled filings.
    defaultFilingOption:  { type: String, default: "2" },
    defaultFilingType:    { type: String, default: "" },     // AEI filing type — not visible on the EEI printout; set from CBP profile

    defaultExportInfoCode:{ type: String, default: "OS" },   // OS — confirmed in all 307 sampled filings
    defaultLicenseCode:   { type: String, default: "C33" },  // C33 = No License Required
    defaultLicenseNumber: { type: String, default: "NLR" },
    defaultEccn:          { type: String, default: "" },     // "" ⇒ EAR99
    // D=Direct consumer, R=Reseller, G=Gov, O=Other/Unknown. Default "O" — confirmed
    // in 306/307 sampled filings (buyer type is usually unknown/unverified at filing time).
    ultConsigneeType:     { type: String, default: "O" },
    // Last-resort U.S. state of origin (ST), used only when an order has
    // neither exporterState nor pickupState. "NJ" was the plurality value
    // (177/307) in the sampled filings — likely the default when the USPPI's
    // actual state wasn't captured. A real per-order value always wins.
    defaultStateOfOrigin: { type: String, default: "NJ" },
    // Foreign/Domestic origin indicator (IT1_21). Default "D" — confirmed from
    // order 14217: a USED vehicle being re-exported from US domestic commerce is
    // "Domestic" regardless of where it was originally manufactured.
    defaultOriginIndicator:{ type: String, default: "D" },
    // In-bond code (IBT). "70" = merchandise not shipped in-bond — the standard
    // case for these exports, confirmed from order 14217.
    defaultInBondCode:    { type: String, default: "70" },

    relatedParty:         { type: String, default: "N" },
    hazmat:               { type: String, default: "N" },
    routedExport:         { type: String, default: "N" },

    // ── Schedule B for used vehicles ─────────────────────────────────────────
    // 10 digits, used passenger vehicle. Default "8703600045" — confirmed in
    // 303/307 sampled filings; used for essentially every vehicle regardless
    // of engine type. scheduleBOverrides below still wins for the exceptions.
    defaultScheduleB:     { type: String, default: "8703600045" },
    scheduleBOverrides:   { type: mongoose.Schema.Types.Mixed, default: {} }, // { keyword: "code" }

    // ── Environment ─────────────────────────────────────────────────────────
    // process.env.AES_ENV wins over this if set.
    aesEnv: { type: String, enum: ["test", "prod"], default: "test" },
  },
  { timestamps: true }
);

aesConfigSchema.statics.getSingleton = function () {
  return this.findOneAndUpdate(
    { key: "singleton" },
    { $setOnInsert: { key: "singleton" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

module.exports = mongoose.model("AesConfig", aesConfigSchema);
