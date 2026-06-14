const express = require("express");
const router = express.Router();

const {
  register,
  login,
  forgetPassword,
} = require("../controllers/authController");

router.post("/register", register);
router.post("/login", login);
router.post("/forget-password", forgetPassword);
module.exports = router;
