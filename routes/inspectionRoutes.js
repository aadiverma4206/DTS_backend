const express = require("express");
const router = express.Router();

const {
  createFullInspection,
  getInspections,
  getInspectionById,
  getInspectionTargets,
  getInspectionStock,
  getExpiredStock,
  getWholesalerList,
  getWholesalerDetails,
  getRetailerList,
  getRetailerDetails,
  getStockTargets,
  getStockDetails,
  getSalesList,
  getSaleDetails,
  getDrugList,
  getDrugHolders,
  getDrugHolderDetails,
  getInspectorProfile,
} = require("../controllers/inspectionController");
const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

const allowInspectorOrAdmin = (req, res, next) => {
  if (!req.user || !["inspector", "admin"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Access denied",
    });
  }
  next();
};

const allowInspector = (req, res, next) => {
  if (!req.user || req.user.role !== "inspector") {
    return res.status(403).json({
      success: false,
      message: "Access denied",
    });
  }
  next();
};

const wrap = (fn) => async (req, res, next) => {
  try {
    if (typeof fn !== "function") {
      return res.status(500).json({
        success: false,
        message: "Handler not defined",
      });
    }

    await fn(req, res, next);
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

router.post("/", allowInspector, wrap(createFullInspection));

router.get("/targets", allowInspectorOrAdmin, wrap(getInspectionTargets));

router.get("/stock-targets", allowInspectorOrAdmin, wrap(getStockTargets));

router.get(
  "/stock-details/:userId",
  allowInspectorOrAdmin,
  wrap(getStockDetails),
);

router.get("/stock/:user_id", allowInspectorOrAdmin, wrap(getInspectionStock));

router.get("/expired/:user_id", allowInspectorOrAdmin, wrap(getExpiredStock));

router.get("/retailers", allowInspectorOrAdmin, wrap(getRetailerList));

router.get("/retailers/:id", allowInspectorOrAdmin, wrap(getRetailerDetails));

router.get("/wholesalers", allowInspectorOrAdmin, wrap(getWholesalerList));

router.get(
  "/wholesalers/:id",
  allowInspectorOrAdmin,
  wrap(getWholesalerDetails),
);
router.get("/sales", allowInspectorOrAdmin, wrap(getSalesList));

router.get("/sales/:userId", allowInspectorOrAdmin, wrap(getSaleDetails));
router.get("/drugs", allowInspectorOrAdmin, wrap(getDrugList));

router.get(
  "/drugs/:drugId/holders",
  allowInspectorOrAdmin,
  wrap(getDrugHolders),
);

router.get(
  "/drugs/:drugId/holder/:userId",
  allowInspectorOrAdmin,
  wrap(getDrugHolderDetails),
);
router.get("/my-profile", allowInspector, wrap(getInspectorProfile));

router.get("/", allowInspectorOrAdmin, wrap(getInspections));

router.get("/:id", allowInspectorOrAdmin, wrap(getInspectionById));
module.exports = router;
