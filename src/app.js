const express = require('express');
const app = express();
const PORT = 4000;
const cors = require("cors");
const connectDB = require('./config/db');
require("dotenv").config();

const userRouter = require('./routes/user.routes');

connectDB();

app.use(cors());
app.use(express.json());

app.use('/api/v1/user', userRouter);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));