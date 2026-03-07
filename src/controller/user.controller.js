const User = require('../models/user.model.js');

exports.userSignup = async (req, res) => {
    try {
        const { email, token, fId, fullName } = req.body;
        if (!email || !fullName || !token || !fId) {
            return res.status(400).send({ message: 'Missing required fields' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).send({ message: 'Already having an account' });
        }
        const newUser = new User({ email, fId, fullName });
        await newUser.save();
        res.status(201).send({ message: 'User account created successfully', userId: newUser._id });
    } catch (error) {
        console.error('Error creating user account: ', error.message);
        res.status(500).send({ message: 'Internal server error' });
    }
};

exports.loginUser = async (req, res) => {
    try {
        const { email, token } = req.body;
        if (!email || !token) {
            return res.status(400).send({ message: 'Missing required fields' });
        }
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).send({ message: 'User not found. Please sign up first.' });
        }
        // Token is already verified by Firebase on frontend
        // Just return the user data
        res.status(200).send({ 
            message: 'Login successful', 
            user: {
                _id: user._id,
                fullName: user.fullName,
                email: user.email,
                fId: user.fId,
                avatarId: user.avatarId,
            }
        });
    } catch (error) {
        console.error('Error logging in user: ', error.message);
        res.status(500).send({ message: 'Internal server error' });
    }
};