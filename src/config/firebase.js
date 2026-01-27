//initialize firebase admin which will enables auth verification

const admin = require("firebase-admin");
const serviceAccount = require("/firebaseServiceAccountKey.json");

try {
    admin.initializeApp({
        credential : admin.credential.cert(serviceAccount), 
    });
    console.log("Firebase admin initialized");
}catch (error){
    console.log("Firebase admin initialization error", error.stack);
}

module.exports = admin;