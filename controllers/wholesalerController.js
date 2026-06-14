const db = require("../config/db");
const createWholesaler = async (req, res) => {
  let conn;

  try {
    const user_id = req.user?.user_id;
    const role = req.user?.role;

    if (!user_id || role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Only wholesaler can create profile",
      });
    }

    let { company_name, gstin, drug_license_no, address, phone, email } =
      req.body;

    company_name = company_name?.trim();
    gstin = gstin?.trim().toUpperCase();
    drug_license_no = drug_license_no?.trim();
    address = address?.trim();
    phone = phone?.trim();
    email = email?.trim().toLowerCase();

    if (
      !company_name ||
      !gstin ||
      !drug_license_no ||
      !address ||
      !phone ||
      !email
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const gstRegex = /^[0-9A-Z]{15}$/;

    if (!gstRegex.test(gstin)) {
      return res.status(400).json({
        success: false,
        message: "Invalid GSTIN format",
      });
    }

    const phoneRegex = /^[0-9]{10}$/;

    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be 10 digits",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [existing] = await conn.query(
      `SELECT wholesaler_id
       FROM mas_wholesalers
       WHERE user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [user_id],
    );

    if (existing.length > 0) {
      await conn.rollback();

      return res.status(400).json({
        success: false,
        message: "Profile already exists",
      });
    }

    await conn.query(
      `INSERT INTO mas_wholesalers
      (
        user_id,
        company_name,
        gstin,
        drug_license_no,
        address,
        phone,
        email
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user_id, company_name, gstin, drug_license_no, address, phone, email],
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Wholesaler profile created successfully",
    });
  } catch (error) {
    if (conn) {
      await conn.rollback();
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "GSTIN already registered",
      });
    }

    console.error("Create Wholesaler Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
};
const getMyProfile = async (req, res) => {
  try {
    const user_id = req.user?.user_id;

    const [rows] = await db.query(
      `SELECT
        wholesaler_id,
        company_name,
        gstin,
        drug_license_no,
        address,
        phone,
        email,
        created_at
       FROM mas_wholesalers
       WHERE user_id = ?
       LIMIT 1`,
      [user_id],
    );

    return res.status(200).json({
      success: true,
      data: rows[0] || null,
    });
  } catch (error) {
    console.error("Get Profile Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id || role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [stockRows, suppliedRows, historyRows, manufacturerRows] =
      await Promise.all([
        db.query(
          `
        SELECT
          COALESCE(SUM(quantity), 0) AS total_stock
        FROM trx_stock
        WHERE user_id = ?
        `,
          [user_id],
        ),

        db.query(
          `
        SELECT
          COUNT(*) AS supplied
        FROM trx_invoices
        WHERE sender_id = ?
          AND status = 'accepted'
        `,
          [user_id],
        ),

        db.query(
          `
        SELECT
          COUNT(*) AS history
        FROM trx_stock_movement
        WHERE user_id = ?
        `,
          [user_id],
        ),

        db.query(
          `
        SELECT
          COUNT(*) AS manufacturers
        FROM mas_manufacturers
        WHERE created_by = ?
        `,
          [user_id],
        ),
      ]);

    return res.status(200).json({
      success: true,
      data: {
        total_stock: Number(stockRows[0][0]?.total_stock) || 0,

        supplied: Number(suppliedRows[0][0]?.supplied) || 0,

        history: Number(historyRows[0][0]?.history) || 0,

        manufacturers: Number(manufacturerRows[0][0]?.manufacturers) || 0,
      },
    });
  } catch (error) {
    console.error("Dashboard Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};
// ================= RECEIVED STOCK HISTORY =================
const getReceivedStockHistory = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id || role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          d.drug_name,
          b.batch_no,
          sm.change_qty AS received_qty,
          sm.created_at AS received_date
      FROM trx_stock_movement sm
      INNER JOIN trx_batches b
          ON sm.batch_id = b.batch_id
      INNER JOIN mas_drugs d
          ON b.drug_id = d.drug_id
      WHERE sm.user_id = ?
          AND sm.movement_type = 'IN'
          AND sm.reference_type = 'batch'
      ORDER BY sm.created_at DESC
      `,
      [user_id],
    );

    return res.status(200).json({
      success: true,
      total_records: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("Received Stock History Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getRejectedStockHistory = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id || role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          i.invoice_id,
          i.invoice_number,
          i.invoice_date,

          d.drug_name,
          b.batch_no,

          ii.quantity AS rejected_qty,
          ii.price,

          i.total_amount,
          i.status,

          u.name AS retailer_name

      FROM trx_invoices i

      INNER JOIN trx_invoice_items ii
          ON i.invoice_id = ii.invoice_id

      INNER JOIN trx_batches b
          ON ii.batch_id = b.batch_id

      INNER JOIN mas_drugs d
          ON b.drug_id = d.drug_id

      INNER JOIN mas_users u
          ON i.receiver_id = u.user_id

      WHERE i.sender_id = ?
        AND i.status = 'rejected'

      ORDER BY i.created_at DESC
      `,
      [user_id],
    );

    return res.status(200).json({
      success: true,
      total_records: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("Rejected Stock History Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
const getMyManufacturers = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id || role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          manufacturer_id,
          company_name,
          phone,
          created_at
      FROM mas_manufacturers
      WHERE created_by = ?
      ORDER BY company_name ASC
      `,
      [user_id],
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Get Manufacturers Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getManufacturerDetails = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    const manufacturer_id = Number(req.params.manufacturer_id);

    if (!user_id || role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!manufacturer_id) {
      return res.status(400).json({
        success: false,
        message: "Manufacturer id required",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          manufacturer_id,
          company_name,
          gstin,
          drug_license_no,
          pan_no,
          cin_no,
          address,
          phone,
          email,
          website,
          product_info,
          created_at
      FROM mas_manufacturers
      WHERE manufacturer_id = ?
        AND created_by = ?
      LIMIT 1
      `,
      [manufacturer_id, user_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Manufacturer not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("Get Manufacturer Details Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getRetailers = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id || role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          r.retailer_id,
          u.name AS retailer_name,
          r.shop_name,
          r.drug_license_no
      FROM mas_retailers r
      INNER JOIN mas_users u
          ON r.user_id = u.user_id
      ORDER BY u.name ASC
      `,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Get Retailers Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
const getRetailerDetails = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    const retailer_id = Number(req.params.retailer_id);

    if (!user_id || role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!retailer_id) {
      return res.status(400).json({
        success: false,
        message: "Retailer id required",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          r.retailer_id,
          r.user_id,

          u.name,
          u.email,
          u.mobile,
          u.status,
          u.created_at AS account_created_at,

          r.shop_name,
          r.gstin,
          r.drug_license_no,
          r.address,
          r.phone,
          r.email AS retailer_email,
          r.created_at

      FROM mas_retailers r

      INNER JOIN mas_users u
          ON r.user_id = u.user_id

      WHERE r.retailer_id = ?
      LIMIT 1
      `,
      [retailer_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Retailer not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("Get Retailer Details Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getWholesalerProfile = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id || role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          w.wholesaler_id,
          w.user_id,

          u.name,
          u.email AS account_email,
          u.mobile,
          u.status,
          u.created_at AS account_created_at,

          w.company_name,
          w.gstin,
          w.drug_license_no,
          w.address,
          w.phone,
          w.email,
          w.created_at

      FROM mas_wholesalers w

      INNER JOIN mas_users u
          ON w.user_id = u.user_id

      WHERE w.user_id = ?
      LIMIT 1
      `,
      [user_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Wholesaler profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("Get Wholesaler Profile Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = {
  createWholesaler,
  getMyProfile,
  getWholesalerProfile,
  getDashboardStats,
  getReceivedStockHistory,
  getRejectedStockHistory,
  getMyManufacturers,
  getManufacturerDetails,
  getRetailers,
  getRetailerDetails,
};
