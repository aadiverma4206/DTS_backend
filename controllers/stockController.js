const db = require("../config/db");
const getStock = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Invalid user",
      });
    }

    const [rows] = await db.query(
      `SELECT
          s.stock_id,
          s.batch_id,
          s.quantity,
          b.batch_no,
          d.drug_name,
          m.company_name AS manufacturer_name,
          b.mrp,
          b.purchase_price,
          DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
          b.created_at
       FROM trx_stock s
       INNER JOIN trx_batches b
         ON s.batch_id = b.batch_id
       INNER JOIN mas_drugs d
         ON b.drug_id = d.drug_id
       INNER JOIN mas_manufacturers m
         ON d.manufacturer_id = m.manufacturer_id
       WHERE s.user_id = ?
       ORDER BY s.stock_id DESC`,
      [user_id],
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error("Get Stock Error:", err);

    return res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

const getStockHistory = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);

    if (!user_id) {
      return res.status(400).json({ success: false, message: "Invalid user" });
    }

    const [rows] = await db.query(
      `SELECT
        m.movement_id,
        m.batch_id,
        m.change_qty,
        m.movement_type,
        m.reference_id,
        m.reference_type,
        m.created_at,
        b.batch_no,
        d.drug_name,
        mf.company_name AS manufacturer_name,
        sender.name AS sender_name,
        receiver.name AS receiver_name,
        CASE
          WHEN m.movement_type = 'IN' THEN mf.company_name
          WHEN m.movement_type = 'OUT' THEN sender.name
          ELSE NULL
        END AS from_name,
        CASE
          WHEN m.movement_type = 'OUT' THEN receiver.name
          ELSE NULL
        END AS to_name
       FROM trx_stock_movement m
       INNER JOIN trx_batches b ON m.batch_id = b.batch_id
       INNER JOIN mas_drugs d ON b.drug_id = d.drug_id
       INNER JOIN mas_manufacturers mf ON d.manufacturer_id = mf.manufacturer_id
       LEFT JOIN trx_invoices i
         ON m.reference_id = i.invoice_id
         AND m.reference_type = 'invoice'
       LEFT JOIN mas_users sender
         ON i.sender_id = sender.user_id
       LEFT JOIN mas_users receiver
         ON i.receiver_id = receiver.user_id
       WHERE m.user_id = ?
       ORDER BY m.movement_id DESC`,
      [user_id],
    );

    return res.status(200).json({ success: true, data: rows || [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAllStock = async (req, res) => {
  try {
    const role = req.user?.role;

    if (role !== "admin") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const [rows] = await db.query(
      `SELECT
        s.stock_id,
        s.user_id,
        u.name,
        s.batch_id,
        s.quantity,
        b.batch_no,
        d.drug_name,
        m.company_name AS manufacturer_name,
        b.mrp,
        b.purchase_price,
        b.expiry_date
       FROM trx_stock s
       INNER JOIN mas_users u ON s.user_id = u.user_id
       INNER JOIN trx_batches b ON s.batch_id = b.batch_id
       INNER JOIN mas_drugs d ON b.drug_id = d.drug_id
       INNER JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
       ORDER BY s.stock_id DESC`,
    );

    return res.status(200).json({ success: true, data: rows || [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getStockDetail = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const batch_id = Number(req.params?.batch_id);

    if (!user_id || !batch_id) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid request" });
    }

    const [rows] = await db.query(
      `SELECT
          s.stock_id,
          s.quantity,
          b.batch_id,
          b.batch_no,
          b.manufacture_date,
          b.expiry_date,
          b.stock_receive_date,
          b.mrp,
          b.purchase_price,
          b.status,
          b.created_at AS batch_created_at,
          d.drug_id,
          d.drug_name,
          d.composition,
          d.category,
          d.dosage_form,
          d.strength,
          d.is_narcotic,
          m.manufacturer_id,
          m.company_name,
          m.gstin,
          m.drug_license_no,
          m.pan_no,
          m.cin_no,
          m.address AS manufacturer_address,
          m.phone AS manufacturer_phone,
          m.email AS manufacturer_email,
          m.website AS manufacturer_website,
          u.user_id,
          u.name AS wholesaler_name,
          u.email AS wholesaler_email,
          u.mobile AS wholesaler_phone
       FROM trx_stock s
       INNER JOIN trx_batches b ON s.batch_id = b.batch_id
       INNER JOIN mas_drugs d ON b.drug_id = d.drug_id
       INNER JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
       INNER JOIN mas_users u ON s.user_id = u.user_id
       WHERE s.user_id = ? AND s.batch_id = ?
       LIMIT 1`,
      [user_id, batch_id],
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Stock not found" });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getStock,
  getStockHistory,
  getAllStock,
  getStockDetail,
};
