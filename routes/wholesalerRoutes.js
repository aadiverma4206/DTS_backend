const express = require("express");

const router = express.Router();

const wholesalerController = require("../controllers/wholesalerController");

const authMiddleware = require("../middleware/authMiddleware");

router.post("/", authMiddleware, wholesalerController.createWholesaler);

router.get("/profile", authMiddleware, wholesalerController.getMyProfile);

router.get(
  "/dashboard",
  authMiddleware,
  wholesalerController.getDashboardStats,
);

router.get(
  "/received-stock-history",
  authMiddleware,
  wholesalerController.getReceivedStockHistory,
);
router.get(
  "/rejected-stock-history",
  authMiddleware,
  wholesalerController.getRejectedStockHistory,
);
router.get(
  "/manufacturers",
  authMiddleware,
  wholesalerController.getMyManufacturers,
);

router.get(
  "/manufacturers/:manufacturer_id",
  authMiddleware,
  wholesalerController.getManufacturerDetails,
);
router.get("/retailers", authMiddleware, wholesalerController.getRetailers);

router.get(
  "/retailers/:retailer_id",
  authMiddleware,
  wholesalerController.getRetailerDetails,
);
router.get(
  "/my-profile",
  authMiddleware,
  wholesalerController.getWholesalerProfile,
);
module.exports = router;
