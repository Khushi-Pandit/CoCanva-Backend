const mongoose = require('mongoose');
const { ref } = require('node:process');
const Schema = mongoose.Schema;

const canvasSchema = new Schema({
    title: {
        type: String,
        required: true,
    },
    owner: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    collaborators: [{
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
        role: {
            type: String,
            enum: ["viewer", "editor"],
            default: "viewer",
        },
    }],
    isPublic: {
        type: Boolean,
        default: false,
    },
    thumbnail: {
        type: String,
        default: null,
    },
});

exports.CanvasData = mongoose.model('CanvasData', canvasDataSchema);