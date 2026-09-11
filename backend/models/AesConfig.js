const mongoose = require("mongoose");

/**
 * Singleton document holding the company-wide constants an AES / EEI filing
 * needs that are NOT derivable from an Order: the USPPI (exporter of record)
 * identity, the CBP Filer ID, and the handful of "always the same" filing
 * defaults for a used-vehicle export.
 *
 * There is exactly one of these — load it with AesConfig.getSingleton().
 * Port / country / carrier / Schedule B code tables do NOT live here; they are
 * in backend/utils/aesCodes.js (like PORT_DEFS / WAREHOUSES).
 */
const aesConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "singleton", unique: true },

    // ── USPPI (U.S. Principal Party in Interest) — party type "E" ──────────────
    usppiName:         { type: String, default: "" },
    usppiEin:          { type: String, default: "" },   // 9 digits, no dashes
    usppiIdType:       { type: String, default: "E" },  // "E" = EIN (per WebLink sample)
    usppiAddress1:     { type: String, default: "" },
    usppiAddress2:     { type: String, default: "" },
    usppiCity:         { type: String, default: "" },
    usppiState:        { type: String, default: "" },
    usppiZip:          { type: String, default: "" },
    usppiContactFirst: { type: String, default: "" },
    usppiContactLast:  { type: String, default: "" },
    usppiPhone:        { type: String, default: "" },

    // ── Forwarding agent — party type "F". Only sent when name is filled in. ───
    forwardingAgent: {
      idType:   { type: String, default: "E" },
      name:     { type: String, default: "" },
      partyId:  { type: String, default: "" },
      contact:  { type: String, default: "" },
      phone:    { type: String, default: "" },
      address1: { type: String, default: "" },
      address2: { type: String, default: "" },
      city:     { type: String, default: "" },
      state:    { type: String, default: "" },
      country:  { type: String, default: "" },
      postal:   { type: String, default: "" },
    },

    // ── Filer + filing defaults ───────────────────────────────────────────────
    filerId:              { type: String, default: "" },    // CBP Filer ID (FID), <= 11 chars
    srnPrefix:            { type: String, default: "DDG" },  // Shipment Reference Number prefix
    responseEmail:        { type: String, default: "" },     // AES response notifications go here

    defaultFilingAction:  { type: String, default: "A" },    // A = Add
    defaultFilingOption:  { type: String, default: "" },     // e.g. "2" (standard) — set from CBP profile
    defaultFilingType:    { type: String, default: "" },     // AEI filing type — set from CBP profile

    defaultExportInfoCode:{ type: String, default: "OS" },   // OS = all other exports
    defaultLicenseCode:   { type: String, default: "C33" },  // C33 = No License Required
    defaultLicenseNumber: { type: String, default: "NLR" },
    defaultEccn:          { type: String, default: "" },     // "" ⇒ EAR99
    ultConsigneeType:     { type: String, default: "" },     // D=Direct consumer, R=Reseller, G=Gov, O=Other
    defaultOriginIndicator:{ type: String, default: "F" },   // IT1_21 fallback when VIN is ambiguous

    relatedParty:         { type: String, default: "N" },
    hazmat:               { type: String, default: "N" },
    routedExport:         { type: String, default: "N" },

    // ── Schedule B for used vehicles ─────────────────────────────────────────
    defaultScheduleB:     { type: String, default: "" },      // 10 digits, used passenger vehicle
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
