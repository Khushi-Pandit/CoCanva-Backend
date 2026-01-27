const express = require('express');
const app = express();
const PORT = 3000;
const connectDB = require('./config/db');
require("dotenv").config();

// const router = require('./routes');

connectDB();

app.use(express.json());

// app.use('/', router);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));