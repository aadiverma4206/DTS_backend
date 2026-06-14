const db = require("../config/db");

const getDashboardStats = async (req, res) => {
  try {
    const [[users]] = await db.query(`SELECT COUNT(*) as total FROM mas_users`);

    const [[inspections]] = await db.query(
      `SELECT COUNT(*) as total FROM trx_inspections`,
    );

    const [[stock]] = await db.query(
      `SELECT SUM(quantity) as total FROM trx_stock`,
    );

    return res.json({
      users: users.total,
      inspections: inspections.total,
      stock: stock.total || 0,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getInspectionSummary = async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT status, COUNT(*) as count
      FROM trx_inspections
      GROUP BY status
    `);

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getSalesReport = async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT DATE(created_at) as date, SUM(total_amount) as total
      FROM trx_sales
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getStockUsers = async (req, res) => {
  try {
    const { role = "all", search = "" } = req.query;

    let query = `
      SELECT
        u.user_id,
        u.name,
        r.role_name,
        mw.company_name,
        mw.drug_license_no AS wholesaler_license,
        mr.shop_name,
        mr.drug_license_no AS retailer_license
      FROM mas_users u
      JOIN mas_roles r ON u.role_id = r.role_id
      LEFT JOIN mas_wholesalers mw ON mw.user_id = u.user_id
      LEFT JOIN mas_retailers mr ON mr.user_id = u.user_id
      WHERE r.role_name IN ('wholesaler', 'retailer')
      AND (
            (r.role_name = 'wholesaler'
             AND mw.drug_license_no IS NOT NULL
             AND TRIM(mw.drug_license_no) <> '')
         OR
            (r.role_name = 'retailer'
             AND mr.drug_license_no IS NOT NULL
             AND TRIM(mr.drug_license_no) <> '')
      )
    `;

    const params = [];

    if (role !== "all") {
      query += ` AND r.role_name = ? `;
      params.push(role);
    }

    if (search.trim() !== "") {
      query += `
        AND (
          u.name LIKE ?
          OR mw.drug_license_no LIKE ?
          OR mr.drug_license_no LIKE ?
        )
      `;

      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY u.name ASC `;

    const [result] = await db.query(query, params);

    return res.json(result);
  } catch (err) {
    console.error("getStockUsers Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
const getUserStockList = async (req, res) => {
  try {
    const { userId } = req.params;

    const [result] = await db.query(
      `
      SELECT
        ts.stock_id,
        ts.quantity,
        md.drug_name,
        tb.batch_id,
        tb.batch_no,
        tb.expiry_date
      FROM trx_stock ts
      JOIN trx_batches tb ON tb.batch_id = ts.batch_id
      JOIN mas_drugs md ON md.drug_id = tb.drug_id
      WHERE ts.user_id = ?
      ORDER BY md.drug_name ASC
    `,
      [userId],
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
const getStockDetail = async (req, res) => {
  try {
    const { stockId } = req.params;

    const [[result]] = await db.query(
      `
      SELECT
        ts.stock_id,
        ts.quantity,
        ts.last_updated,

        u.user_id,
        u.name AS user_name,
        u.email,
        u.mobile,
        u.status AS user_status,

        r.role_name,

        md.drug_id,
        md.drug_name,
        md.composition,
        md.category,
        md.dosage_form,
        md.strength,
        md.is_narcotic,

        tb.batch_id,
        tb.batch_no,
        tb.manufacture_date,
        tb.expiry_date,
        tb.purchase_price AS manufacturer_price,
        tb.mrp AS wholesaler_price,
        tb.status AS batch_status,

        mm.manufacturer_id,
        mm.company_name AS manufacturer_name,
        mm.gstin AS manufacturer_gstin,
        mm.drug_license_no AS manufacturer_license,
        mm.pan_no AS manufacturer_pan,
        mm.cin_no AS manufacturer_cin,
        mm.address AS manufacturer_address,
        mm.phone AS manufacturer_phone,
        mm.email AS manufacturer_email,
        mm.website AS manufacturer_website,
        mm.product_info AS manufacturer_product_info,

        mw.wholesaler_id,
        mw.company_name AS wholesaler_name,
        mw.gstin AS wholesaler_gstin,
        mw.drug_license_no AS wholesaler_license,
        mw.address AS wholesaler_address,
        mw.phone AS wholesaler_phone,
        mw.email AS wholesaler_email,

        mr.retailer_id,
        mr.shop_name AS retailer_shop_name,
        mr.gstin AS retailer_gstin,
        mr.drug_license_no AS retailer_license,
        mr.address AS retailer_address,
        mr.phone AS retailer_phone,
        mr.email AS retailer_email,

        (
          SELECT ti.price
          FROM trx_invoice_items ti
          JOIN trx_invoices inv
          ON inv.invoice_id = ti.invoice_id
          WHERE ti.batch_id = tb.batch_id
          ORDER BY ti.item_id DESC
          LIMIT 1
        ) AS retailer_price

      FROM trx_stock ts

      JOIN mas_users u
      ON u.user_id = ts.user_id

      JOIN mas_roles r
      ON r.role_id = u.role_id

      JOIN trx_batches tb
      ON tb.batch_id = ts.batch_id

      JOIN mas_drugs md
      ON md.drug_id = tb.drug_id

      LEFT JOIN mas_manufacturers mm
      ON mm.manufacturer_id = md.manufacturer_id

      LEFT JOIN mas_wholesalers mw
      ON mw.user_id = ts.user_id

      LEFT JOIN mas_retailers mr
      ON mr.user_id = ts.user_id

      WHERE ts.stock_id = ?
      LIMIT 1
    `,
      [stockId],
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Stock detail not found",
      });
    }

    if (result.role_name === "retailer") {
      const [[supplierWholesaler]] = await db.query(
        `
        SELECT
          mw.wholesaler_id,
          mw.company_name,
          mw.gstin,
          mw.drug_license_no,
          mw.address,
          mw.phone,
          mw.email,

          wu.user_id,
          wu.name AS owner_name,
          wu.mobile AS owner_mobile,
          wu.email AS owner_email

        FROM trx_invoice_items ti

        JOIN trx_invoices inv
        ON inv.invoice_id = ti.invoice_id

        JOIN mas_wholesalers mw
        ON mw.user_id = inv.sender_id

        JOIN mas_users wu
        ON wu.user_id = mw.user_id

        WHERE ti.batch_id = ?
        ORDER BY inv.invoice_id DESC
        LIMIT 1
      `,
        [result.batch_id],
      );

      result.supplier_wholesaler = supplierWholesaler || null;
    }

    if (result.role_name === "wholesaler") {
      const [[manufacturerData]] = await db.query(
        `
        SELECT
          mm.manufacturer_id,
          mm.company_name,
          mm.gstin,
          mm.drug_license_no,
          mm.pan_no,
          mm.cin_no,
          mm.address,
          mm.phone,
          mm.email,
          mm.website,
          mm.product_info

        FROM trx_batches tb

        JOIN mas_drugs md
        ON md.drug_id = tb.drug_id

        JOIN mas_manufacturers mm
        ON mm.manufacturer_id = md.manufacturer_id

        WHERE tb.batch_id = ?
        LIMIT 1
      `,
        [result.batch_id],
      );

      result.source_manufacturer = manufacturerData || null;
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
const getAdminProfile = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    if (role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        user_id,
        name,
        email,
        mobile,
        role_id,
        status,
        created_at,
        last_login
      FROM mas_users
      WHERE user_id = ?
      LIMIT 1
      `,
      [user_id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Admin profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("getAdminProfile Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
module.exports = {
  getDashboardStats,
  getInspectionSummary,
  getSalesReport,
  getStockUsers,
  getUserStockList,
  getStockDetail,
  getAdminProfile,
};
