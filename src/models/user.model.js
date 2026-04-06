'use strict';
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    fId:      { type: String, required: true, unique: true, index: true }, // Firebase UID
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    avatarUrl:{ type: String, default: null },   // URL to avatar image
    avatarId: { type: Number, default: 0 },       // numeric avatar index (legacy)
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
