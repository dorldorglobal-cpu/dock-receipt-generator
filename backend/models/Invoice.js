const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },

    orderId:  { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    orderRef: String,

    customerName:  String,
    customerEmail: String,
    customerPhone: String,

    vehicle: String,   // "2019 Toyota Camry"
    vin:     String,
    pol:     String,
    pod:     String,

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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Invoice", invoiceSchema);
