const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// FIX: Added fId (Firebase UID) — auth.middleware does User.findOne({ fId: decoded.uid })
// Without this field, ALL authenticated requests fail with 401 "User not found"
const userSchema = new Schema(
  {
    fId: { type: String, required: true, unique: true }, // Firebase UID — CRITICAL
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    avatarId: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
