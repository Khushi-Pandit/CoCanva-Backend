// we need to desing a a controler such that that controll will first check that weather the id comming is corect or not, and thn it will return the all existing canvas data for that perticular user.

const CanvasData = require('../models/canvasdata.model.js');
const User = require('../models/user.model.js');

exports.getUserCanvasData = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            return res.status(400).send({ message: 'Missing userId parameter' });
        }
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).send({ message: 'User not found' });
        }
        const canvasData = await CanvasData.find({ userId });
        res.status(200).send({ canvasData });
    } catch (error) {
        console.error('Error fetching user canvas data: ', error.message);
        res.status(500).send({ message: 'Internal server error' });
    }
};

exports.saveUserCanvasData = async (req, res) => {
    try {
        const { userId, canvasContent } = req.body;
        if (!userId || !canvasContent) {
            return res.status(400).send({ message: 'Missing required fields' });
        }
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).send({ message: 'User not found' });
        }
        const newCanvasData = new CanvasData({ userId, canvasContent });
        await newCanvasData.save();
        res.status(201).send({ message: 'Canvas data saved successfully', canvasDataId: newCanvasData._id });
    } catch (error) {
        console.error('Error saving user canvas data: ', error.message);
        res.status(500).send({ message: 'Internal server error' });
    }
};