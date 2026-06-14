const express = require("express");
const router = express.Router();

const {
  addDrug,
  getMyDrugs,
  getDrugs,
  getDrugsByWholesaler,
  getDrugsByManufacturer,
} = require("../controllers/drugController");

const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

router.post("/", addDrug);
router.get("/my", getMyDrugs);
router.get("/wholesaler", getDrugsByWholesaler);
router.get("/manufacturer/:id", getDrugsByManufacturer);
router.get("/", getDrugs);

module.exports = router;
