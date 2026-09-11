const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    refNumber: { type: String, required: true, unique: true },

    customerName: String,
    contactName:  String,
    customerPhone: String,
    customerEmail: String,
    buyerName:   { type: String, default: "" }, // auction account name (may differ from customerName)
    buyerNumber: { type: String, default: "" }, // auction buyer/member number (e.g. IAA 690717, Copart 964631)

    requestType: {
      type: String,
      enum: ["RORO", "Container", "Inland Only"],
      required: true,
    },
    dispatchMethod: { type: String, enum: ["Post", "Self Dispatch"], default: "Post" },

    year: String,
    make: String,
    model: String,
    vin: String,

    pickupLocation: String,
    pickupName: String,
    pickupAddress: String,
    pickupCity: String,
    pickupState: String,
    pickupZip: String,

    deliveryLocation: String,
    deliveryName: String,
    deliveryAddress: String,
    deliveryCity: String,
    deliveryState: String,
    deliveryZip: String,

    consigneeName: String,
    consigneeAddress: String,
    consigneeCity: String,
    consigneeState: String,
    consigneeZip: String,
    consigneeCountry: String,

    // The USPPI on the AES filing — confirmed from a real accepted filing that
    // this is the vehicle's seller of record (insurance co., bank, individual…),
    // NOT DDG. DDG files as the authorized/forwarding agent — see AesConfig.
    exporterName: String,
    exporterAddress: String,
    exporterCity: String,
    exporterState: String,
    exporterZip: String,
    exporterCountry: String,
    usppiEin: { type: String, default: "" }, // IT1/AD0_2 — not on older parsed AES PDFs (was skipped)

    color: String,
    processedBy: String,
    requestDate: String,

    vessel: String,
    voyage: String,
    cutoffDate:  String,
    sailDate:    String,
    arrivalDate: String,
    aesItn: String,
    weightKgs: String,
    value: String,
    vehicleYearMakeModel: String,

    // ── AES / EEI filing ────────────────────────────────────────────────────
    // aesItn (above) stays the canonical ITN consumed by the DR / BL pipeline.
    // These support building + tracking the WebLink filing that produces it.
    titleNumber:     { type: String, default: "" },  // IT1_18
    titleState:      { type: String, default: "" },  // IT1_19 (2-letter)
    scheduleB:       { type: String, default: "" },  // IT1_13 override (else AesConfig default)
    exportInfoCode:  { type: String, default: "" },  // IT1_1 override (else "OS")
    originIndicator: { type: String, default: "" },  // IT1_21 override ("D" domestic / "F" foreign)
    aesScac:         { type: String, default: "" },  // SCAC override (else port-based default — varies per sailing)

    // USPPI's own contact (AD0_9/AD0_11/AD0_12) — confirmed from a live ACE
    // filing screen (order 14217) that this is a person AT the USPPI (e.g.
    // "Pablo Cejas" at State Farm Mutual), not DDG's own contact — it varies
    // per order same as the USPPI itself. Falls back to AesConfig's
    // usppiContact* (DDG's own contact) when an order doesn't have one.
    usppiContactFirst: { type: String, default: "" },
    usppiContactLast:  { type: String, default: "" },
    usppiContactPhone: { type: String, default: "" },

    // Full title assignment chain, as read off the uploaded title photo(s) by
    // the Title OCR feature — one entry for the registered owner ("seller")
    // and one per reassignment block filled in on the back ("buyer1",
    // "buyer2", ...), in chronological order. Kept as an audit trail for how
    // the USPPI (exporterName/exporterAddress) suggestion was derived — see
    // utils/titleOcr.js#pickUsppi for the selection rule.
    titleChain: [{
      role:    { type: String, default: "" }, // "seller" | "buyer1" | "buyer2" | ...
      name:    { type: String, default: "" },
      address: { type: String, default: "" },
      city:    { type: String, default: "" },
      state:   { type: String, default: "" },
      zip:     { type: String, default: "" },
      country: { type: String, default: "" },
    }],

    aesFiling: {
      // No default: the sparse unique index below only excludes documents
      // where this field is genuinely missing, not "". A default of ""
      // made every order collide on that empty string (E11000).
      srn:           String,
      returnToken:   { type: String, default: "" },  // guards the public wl_success_url callback
      status: {
        type: String,
        enum: ["", "built", "handed_off", "accepted", "rejected", "itn_received", "abandoned"],
        default: "",
      },
      itn:           { type: String, default: "" },  // provenance copy of the captured ITN
      handedOffAt:   Date,
      itnReceivedAt: Date,
      lastPolledAt:  Date,
      pollAttempts:  { type: Number, default: 0 },
      lastError:     { type: String, default: "" },
      env:           { type: String, default: "" },  // "test" | "prod" the filing was built for
    },

    lotNumber: { type: String, default: "" },
    pin:       { type: String, default: "" },

    // From the Central Dispatch sheet
    dispatchCarrier:      { type: String, default: "" }, // hauling company
    dispatchPickupDate:   { type: String, default: "" }, // ISO yyyy-mm-dd
    dispatchDeliveryDate: { type: String, default: "" }, // ISO yyyy-mm-dd (est. warehouse delivery)

    shippingLine: String,
    pol: String,
    pod: String,
    bookingNumber: String,
    containerNumber: { type: String, default: "" },
    sealNumber:      { type: String, default: "" },

    condition: {
      type: String,
      enum: ["Runner", "Nonrunner", "Forklift"],
      default: "Runner",
    },

    titleStatus: {
      type: String,
      enum: ["Title", "No Title", "Pending"],
      default: "Pending",
    },

    status: {
      type: String,
      default: "New Order",
    },

    voyageFolderId: String,
    voyageFolderName: String,

    notes: String,
    holdNote: { type: String, default: "" },  // problem/hold issue description
    emailNote: { type: String, default: "" }, // copy of buyer receipt email
    source: { type: String, default: "" }, // e.g. "GHANA OFFICE", "DIRECT"

    charges: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    driveFolderId: String,
    driveFolderLink: String,

    files: [
      {
        label:       String,
        originalName: String,
        filename:    String,
        driveFileId: String,
        path:        String,
        mimetype:    String,
        uploadedAt:  { type: Date, default: Date.now },
      },
    ],

    additionalCosts: [
      {
        description: String,
        sell:        Number,
        cost:        Number,
      },
    ],

    pendingInvoiceItems: [
      {
        description: { type: String, required: true },
        amount:      { type: Number, required: true },
        addedAt:     { type: Date, default: Date.now },
      },
    ],

    timeline: [
      {
        action: String,
        details: String,
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

// SRN must be unique per filer; sparse so orders without a filing don't collide.
orderSchema.index({ "aesFiling.srn": 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Order", orderSchema);