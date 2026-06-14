const express = require("express");
const router = express.Router();

const adminController = require("../controllers/adminController");
const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

const allowAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied",
    });
  }

  next();
};

router.get("/my-profile", allowAdmin, adminController.getAdminProfile);

router.get("/dashboard", allowAdmin, adminController.getDashboardStats);

router.get(
  "/inspection-summary",
  allowAdmin,
  adminController.getInspectionSummary,
);

router.get("/sales-report", allowAdmin, adminController.getSalesReport);

router.get("/stock-users", allowAdmin, adminController.getStockUsers);

router.get("/user-stock/:userId", allowAdmin, adminController.getUserStockList);

router.get(
  "/stock-detail/:stockId",
  allowAdmin,
  adminController.getStockDetail,
);

module.exports = router;
