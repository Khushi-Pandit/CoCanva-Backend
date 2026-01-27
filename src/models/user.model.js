const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema({
    fullName: {
        type: String,
        required: true,    
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    fId : {
        type: String,
        required: true,
        unique: true,
    },
    avatarId: {
        type: String,
        default: null,
    },
});

module.exports = mongoose.model('User', userSchema);