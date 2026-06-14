const express = require("express");
const router = express.Router();

const stockController = require("../controllers/stockController");
const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

router.get("/", (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  return stockController.getStock(req, res, next);
});

router.get("/history", (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  return stockController.getStockHistory(req, res, next);
});

router.get("/detail/:batch_id", (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  return stockController.getStockDetail(req, res, next);
});

router.get("/admin/all", (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  return stockController.getAllStock(req, res, next);
});

module.exports = router;
