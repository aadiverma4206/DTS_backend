const express = require("express");
const router = express.Router();

const {
  createFullInvoice,
  updateInvoiceStatus,
  getMyInvoices,
  getIncomingInvoices,
  getInvoiceDetails,
  getInvoicesBySender,
  getInvoicesByReceiver,
  getInvoiceById,
} = require("../controllers/invoiceController");

const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

router.post("/", createFullInvoice);

router.get("/incoming", getIncomingInvoices);

router.get("/buyers", async (req, res) => {
  try {
    const data = await getInvoicesBySender(req.user.user_id);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});

router.get("/buyer/:buyerId", async (req, res) => {
  try {
    const data = await getInvoicesByReceiver(req.params.buyerId);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});

router.get("/:invoice_id/details", getInvoiceDetails);

router.patch("/:id/status", updateInvoiceStatus);

router.get("/:invoice_id", async (req, res) => {
  try {
    const data = await getInvoiceById(req.params.invoice_id);
    if (!data) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});

router.get("/", getMyInvoices);

module.exports = router;
