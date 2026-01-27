import User from '../models/user.model.js';

exports.userSignup = async (req, res) => {
    try{
        const {email, token, firebaseId, fullName} = req.body;
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