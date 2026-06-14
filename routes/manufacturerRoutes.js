const express = require("express");
const router = express.Router();

const {
  createManufacturer,
  getManufacturers,
} = require("../controllers/manufacturerController");

const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

router.post("/", createManufacturer);
router.get("/", getManufacturers);

module.exports = router;
