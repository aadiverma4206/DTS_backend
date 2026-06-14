const express = require("express");
const router = express.Router();

const {
  getProfileById,
  getProfileInfo,
  getWholesalers,
  getRetailers,
  getAllUsers,
  approveUser,
  rejectUser,
  createInspector,
  getUserDetail,
} = require("../controllers/userController");

const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

router.get("/profile/:id", getProfileById);
router.get("/profile", getProfileInfo);

router.get("/wholesalers", getWholesalers);
router.get("/retailers", getRetailers);

router.get("/detail/:id", getUserDetail);

router.patch("/approve/:id", approveUser);
router.patch("/reject/:id", rejectUser);

router.post("/inspector", createInspector);

router.get("/", getAllUsers);

module.exports = router;
