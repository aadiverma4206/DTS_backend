const express = require("express");

const router = express.Router();

const retailerController = require("../controllers/retailerController");

const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

const allowRetailer = (req, res, next) => {
  if (!req.user || req.user.role !== "retailer") {
    return res.status(403).json({
      success: false,
      message: "Forbidden",
    });
  }

  next();
};

router.get("/profile", allowRetailer, retailerController.getMyProfile);

router.post("/", allowRetailer, retailerController.createRetailer);

router.get("/stock", allowRetailer, retailerController.getMyStock);

router.get("/stock/:batchId", allowRetailer, retailerController.getStockDetail);

router.get("/dashboard", allowRetailer, retailerController.getDashboardStats);

router.post("/sell", allowRetailer, retailerController.sellProduct);

router.get("/sales", allowRetailer, retailerController.getSaleHistory);

router.get(
  "/manufacturers",
  allowRetailer,
  retailerController.getMyManufacturers,
);

router.get(
  "/manufacturers/:manufacturer_id",
  allowRetailer,
  retailerController.getManufacturerDetails,
);
router.get("/wholesalers", allowRetailer, retailerController.getMyWholesalers);

router.get(
  "/wholesalers/:wholesaler_id",
  allowRetailer,
  retailerController.getWholesalerDetails,
);
router.get("/patients", allowRetailer, retailerController.getMyPatients);

router.get(
  "/patients/:patient_mobile",
  allowRetailer,
  retailerController.getPatientDetails,
);
router.get("/my-profile", allowRetailer, retailerController.getRetailerProfile);
module.exports = router;
