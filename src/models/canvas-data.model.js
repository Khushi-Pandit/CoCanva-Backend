const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const elementSchema = new Schema({
  type: {
    type: String,
    enum: ["rectangle", "circle", "line", "arrow", "text", "image", "freeDraw"],
    required: true
  },

  x: Number,
  y: Number,

  width: Number,
  height: Number,

  points: [Number],

  text: String,

  strokeColor: String,
  fillColor: String,
  strokeWidth: Number,

  rotation: {
    type: Number,
    default: 0
  },

  zIndex: Number
}, { _id: true });


const canvasSchema = new mongoose.Schema({
  title: { type: String, default: "Untitled Canvas" },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  elements: [elementSchema],

}, { timestamps: true });