const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },

    orderId:  { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    orderRef: String,

    customerName:  String,
    customerEmail: String,
    customerPhone: String,

    vehicle:          String,   // "2019 Toyota Camry"
    vin:              String,
    pol:              String,
    pod:              String,
    requestType:      String,   // "RORO" | "Container" | "Inland Only"
    pickupLocation:   String,
    deliveryLocation: String,
    bookingNumber:    String,
    voyage:           String,
    arrivalDate:      String,
    shippingLine:     String,

    items: [
      {
        description: { type: String, default: "" },
        amount:      { type: Number, default: 0 },
      },
    ],

    subtotal: { type: Number, default: 0 },
    total:    { type: Number, default: 0 },

    notes:   String,
    dueDate: Date,

    status: {
      type:    String,
      enum:    ["draft", "sent", "paid"],
      default: "draft",
    },

    sentAt: Date,
    paidAt: Date,

    payments: [
      {
        amount:  { type: Number, required: true },
        method:  { type: String, default: "" },  // "Bank ACH", "Wire", "Zelle", etc.
        date:    { type: Date,   default: Date.now },
        notes:   { type: String, default: "" },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Invoice", invoiceSchema);
