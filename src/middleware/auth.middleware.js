const admin = require('../config/firebase');
const User = require('../models/user.model');

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUser = decoded;

    // Attach MongoDB user
    const user = await User.findOne({ fId: decoded.uid });
    if (!user) {
      return res.status(404).json({ message: 'User not registered' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = { verifyFirebaseToken };