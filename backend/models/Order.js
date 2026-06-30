const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    refNumber: { type: String, required: true, unique: true },

    customerName: String,
    contactName:  String,
    customerPhone: String,
    customerEmail: String,
    buyerName: { type: String, default: "" }, // auction account name (may differ from customerName)

    requestType: {
      type: String,
      enum: ["RORO", "Container", "Inland Only"],
      required: true,
    },

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

    exporterName: String,
    exporterAddress: String,
    exporterCity: String,
    exporterState: String,
    exporterZip: String,
    exporterCountry: String,

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

    lotNumber: { type: String, default: "" },
    pin:       { type: String, default: "" },

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

module.exports = mongoose.model("Order", orderSchema);