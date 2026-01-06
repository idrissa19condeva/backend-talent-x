const mongoose = require("mongoose");

const EmailVerificationSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, lowercase: true, trim: true, index: true },
        code: { type: String, required: true },
        expiresAt: { type: Date, required: true },
        attempts: { type: Number, default: 0 },
        verifiedAt: { type: Date },
    },
    { timestamps: true },
);

EmailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("EmailVerification", EmailVerificationSchema);
