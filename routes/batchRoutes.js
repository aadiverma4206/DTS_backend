const express = require("express");
const router = express.Router();

const batchController = require("../controllers/batchController");
const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

router.post("/", batchController.createBatch);
router.get("/my", batchController.getMyBatches);
router.get("/", batchController.getBatches);

module.exports = router;
