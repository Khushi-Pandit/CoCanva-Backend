const User = require('../models/user.model.js');

exports.userSignup = async (req, res) => {
    try{
        const {email, token, fId, fullName} = req.body;
        if(!email || !fullName || !token || !fId){
            return res.status(400).send({message: 'Missing required fields'});
        }
        const existingUser = await User.findOne({email});
        if(existingUser){
            return res.status(400).send({message: 'Alreay having an account'});
        }
        const newUser = new User(req.body);
        await newUser.save();

        res.status(201).send({message: 'User account created successfully', userId: newUser._id});
    }catch (error) {
        console.error('Error creating user account: ', error.message);
        res.status(500).send({message: 'Internal server error'});
    }
};

exports.loginUser = async (req, res) => {
    try{
        const {email, token} = req.body;
        if(!email || !token){
            return res.status(400).send({message: 'Missing required fields'});
        }
        let user;
        user = await User.findOne({
            email,
        })
    }catch (error){
        console.error('Error logging in user: ', error.message);
        res.status(500).send({message: 'Internal server error'});
    }
}