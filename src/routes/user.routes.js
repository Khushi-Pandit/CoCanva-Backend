const router = require('express').Router();

router.post("/signup", require("../controller/user.controller").userSignup);
router.post("/login", require("../controller/user.controller").loginUser);

module.exports = router;