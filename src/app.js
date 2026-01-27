const express = require('express');
const app = express();
const PORT = 3000;
const connectDB = require('./config/db');
require("dotenv").config();

const userRouter = require('./routes/user.routes');

connectDB();

app.use(express.json());

app.use('/api/v1/user', userRouter);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));