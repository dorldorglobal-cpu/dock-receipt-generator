const mongoose = require("mongoose");

const customerCreditSchema = new mongoose.Schema({
  customerName: { type: String, required: true, unique: true },
  balance: { type: Number, default: 0 },
  transactions: [
    {
      amount:    Number,   // positive = credit added, negative = credit applied
      date:      { type: Date, default: Date.now },
      notes:     String,
      invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
      invoiceNumber: String,
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model("CustomerCredit", customerCreditSchema);
