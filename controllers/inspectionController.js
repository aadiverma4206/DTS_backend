const db = require("../config/db");

const createFullInspection = async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const inspector_id = req.user?.user_id;

    const { target_user_id, inspection_type, items, checks, remarks } =
      req.body;

    if (!inspector_id || !target_user_id || !inspection_type) {
      throw new Error("Missing required fields");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Items required");
    }

    if (inspector_id === target_user_id) {
      throw new Error("Invalid inspection");
    }

    const [[target]] = await conn.query(
      `SELECT user_id FROM mas_users WHERE user_id = ?`,
      [target_user_id],
    );

    if (!target) {
      throw new Error("Target user not found");
    }

    const [inspectionRes] = await conn.query(
      `INSERT INTO trx_inspections
       (inspector_id, target_user_id, inspection_type, status, remarks)
       VALUES (?, ?, ?, 'in_progress', ?)`,
      [inspector_id, target_user_id, inspection_type, remarks || null],
    );

    const inspection_id = inspectionRes.insertId;

    let totalSystem = 0;
    let totalPhysical = 0;

    for (const item of items) {
      const { batch_id, drug_id, physical_qty } = item;

      if (!batch_id || !drug_id || physical_qty < 0) {
        throw new Error("Invalid item data");
      }

      const [stockRows] = await conn.query(
        `SELECT quantity FROM trx_stock
         WHERE user_id = ? AND batch_id = ?`,
        [target_user_id, batch_id],
      );

      const system_qty = Number(stockRows[0]?.quantity || 0);

      totalSystem += system_qty;
      totalPhysical += physical_qty;

      await conn.query(
        `INSERT INTO trx_inspection_items
         (inspection_id, drug_id, batch_id, system_qty, physical_qty)
         VALUES (?, ?, ?, ?, ?)`,
        [inspection_id, drug_id, batch_id, system_qty, physical_qty],
      );
    }

    let hasIssue = totalSystem !== totalPhysical;

    if (Array.isArray(checks)) {
      for (const c of checks) {
        const { check_name, check_value, remarks } = c;

        if (!check_name) continue;

        if (check_value === "no" || check_value === "fail") {
          hasIssue = true;
        }

        await conn.query(
          `INSERT INTO trx_inspection_checks
           (inspection_id, check_name, check_value, remarks)
           VALUES (?, ?, ?, ?)`,
          [inspection_id, check_name, check_value || "yes", remarks || null],
        );
      }
    }

    const finalStatus = hasIssue ? "discrepancy" : "verified";

    await conn.query(
      `UPDATE trx_inspections
       SET status = ?, completed_at = NOW(),
           total_system_qty = ?, total_physical_qty = ?
       WHERE inspection_id = ?`,
      [finalStatus, totalSystem, totalPhysical, inspection_id],
    );

    await conn.commit();

    return res.json({
      success: true,
      inspection_id,
      status: finalStatus,
      total_system_qty: totalSystem,
      total_physical_qty: totalPhysical,
    });
  } catch (error) {
    if (conn) await conn.rollback();

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (conn) conn.release();
  }
};

const getInspections = async (req, res) => {
  try {
    const user_id = req.user?.user_id;
    const role = req.user?.role;

    const { inspector_id, target_type, search } = req.query;

    let query = `
      SELECT
        i.inspection_id,
        i.inspection_type,
        i.inspection_date,
        i.status,
        i.total_system_qty,
        i.total_physical_qty,

        u1.user_id AS inspector_id,
        u1.name AS inspector_name,

        u2.user_id AS target_user_id,
        u2.name AS target_name,
        u2.role_id AS target_role

      FROM trx_inspections i
      JOIN mas_users u1 ON i.inspector_id = u1.user_id
      JOIN mas_users u2 ON i.target_user_id = u2.user_id
      WHERE 1=1
    `;

    const params = [];

    if (role === "inspector") {
      query += ` AND i.inspector_id = ?`;
      params.push(user_id);
    }

    if (role === "admin") {
      if (inspector_id && inspector_id !== "all") {
        query += ` AND i.inspector_id = ?`;
        params.push(inspector_id);
      }

      if (target_type === "wholesaler") {
        query += ` AND u2.role_id = 3`;
      }

      if (target_type === "retailer") {
        query += ` AND u2.role_id = 4`;
      }

      if (search) {
        query += ` AND (
          u1.name LIKE ? OR
          u2.name LIKE ?
        )`;
        params.push(`%${search}%`, `%${search}%`);
      }
    }

    query += ` ORDER BY i.inspection_id DESC`;

    const [rows] = await db.query(query, params);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const getInspectionDetails = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [[inspection]] = await db.query(
      `SELECT i.*, u1.name AS inspector_name, u2.name AS target_name
       FROM trx_inspections i
       JOIN mas_users u1 ON i.inspector_id = u1.user_id
       JOIN mas_users u2 ON i.target_user_id = u2.user_id
       WHERE i.inspection_id = ?`,
      [id],
    );

    const [items] = await db.query(
      `SELECT it.*, b.batch_no, b.expiry_date, d.drug_name
       FROM trx_inspection_items it
       JOIN trx_batches b ON it.batch_id = b.batch_id
       JOIN mas_drugs d ON it.drug_id = d.drug_id
       WHERE it.inspection_id = ?`,
      [id],
    );

    const [checks] = await db.query(
      `SELECT check_name, check_value, remarks
       FROM trx_inspection_checks
       WHERE inspection_id = ?`,
      [id],
    );

    return res.json({
      success: true,
      data: {
        inspection: inspection || {},
        items: items || [],
        checks: checks || [],
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getInspectionTargets = async (req, res) => {
  try {
    const { type, search } = req.query;

    let roleId = null;

    if (type === "retailer") roleId = 4;
    if (type === "wholesaler") roleId = 3;

    if (!roleId) {
      return res.status(400).json({
        success: false,
        message: "Invalid type",
      });
    }

    let query = `
      SELECT
        u.user_id,
        u.name,

        r.shop_name,
        r.drug_license_no AS retailer_dl,

        w.company_name,
        w.drug_license_no AS wholesaler_dl

      FROM mas_users u

      LEFT JOIN mas_retailers r
        ON u.user_id = r.user_id

      LEFT JOIN mas_wholesalers w
        ON u.user_id = w.user_id

      WHERE u.role_id = ?

      AND (
        (u.role_id = 4
          AND r.shop_name IS NOT NULL
          AND r.shop_name <> ''
          AND r.drug_license_no IS NOT NULL
          AND r.drug_license_no <> '')

        OR

        (u.role_id = 3
          AND w.company_name IS NOT NULL
          AND w.company_name <> ''
          AND w.drug_license_no IS NOT NULL
          AND w.drug_license_no <> '')
      )
    `;

    const params = [roleId];

    if (search) {
      query += `
        AND (
          u.name LIKE ?
          OR r.shop_name LIKE ?
          OR w.company_name LIKE ?
          OR r.drug_license_no LIKE ?
          OR w.drug_license_no LIKE ?
        )
      `;

      params.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
      );
    }

    query += ` ORDER BY u.name ASC`;

    const [rows] = await db.query(query, params);

    const data = rows.map((r) => ({
      user_id: r.user_id,
      name: r.name,
      shop_name: r.shop_name || r.company_name || "",
      drug_license_no: r.retailer_dl || r.wholesaler_dl || "",
    }));

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
const getInspectionStock = async (req, res) => {
  try {
    const user_id = Number(req.params.user_id);

    const [rows] = await db.query(
      `SELECT d.drug_id, d.drug_name, b.batch_id, b.batch_no, b.expiry_date, s.quantity
       FROM trx_stock s
       JOIN trx_batches b ON s.batch_id = b.batch_id
       JOIN mas_drugs d ON b.drug_id = d.drug_id
       WHERE s.user_id = ?
       AND s.quantity > 0
       AND b.expiry_date > CURDATE()`,
      [user_id],
    );

    const grouped = {};

    rows.forEach((r) => {
      if (!grouped[r.drug_id]) {
        grouped[r.drug_id] = {
          drug_id: r.drug_id,
          drug_name: r.drug_name,
          batches: [],
        };
      }

      grouped[r.drug_id].batches.push({
        batch_id: r.batch_id,
        batch_no: r.batch_no,
        expiry_date: r.expiry_date,
        system_qty: r.quantity,
      });
    });

    return res.json({
      success: true,
      data: Object.values(grouped),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const getExpiredStock = async (req, res) => {
  try {
    const user_id = Number(req.params.user_id);

    const [rows] = await db.query(
      `SELECT d.drug_name, b.batch_no, b.expiry_date, s.quantity
       FROM trx_stock s
       JOIN trx_batches b ON s.batch_id = b.batch_id
       JOIN mas_drugs d ON b.drug_id = d.drug_id
       WHERE s.user_id = ?
       AND s.quantity > 0
       AND b.expiry_date <= CURDATE()`,
      [user_id],
    );

    return res.json({
      success: true,
      data: rows || [],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
const getInspectionById = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [[inspection]] = await db.query(
      `SELECT i.*, u1.name AS inspector_name, u2.name AS target_name
       FROM trx_inspections i
       JOIN mas_users u1 ON i.inspector_id = u1.user_id
       JOIN mas_users u2 ON i.target_user_id = u2.user_id
       WHERE i.inspection_id = ?`,
      [id],
    );

    const [items] = await db.query(
      `SELECT it.*, b.batch_no, b.expiry_date, d.drug_name
       FROM trx_inspection_items it
       JOIN trx_batches b ON it.batch_id = b.batch_id
       JOIN mas_drugs d ON it.drug_id = d.drug_id
       WHERE it.inspection_id = ?`,
      [id],
    );

    const [checks] = await db.query(
      `SELECT check_name, check_value, remarks
       FROM trx_inspection_checks
       WHERE inspection_id = ?`,
      [id],
    );

    return res.json({
      success: true,
      data: {
        inspection: inspection || {},
        items: items || [],
        checks: checks || [],
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getWholesalerList = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        u.user_id,
        u.name,
        w.company_name,
        w.drug_license_no
      FROM mas_users u
      INNER JOIN mas_wholesalers w
        ON u.user_id = w.user_id
      WHERE u.role_id = 3
      ORDER BY u.name ASC
    `);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getWholesalerDetails = async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wholesaler id",
      });
    }

    const [[data]] = await db.query(
      `
        SELECT
          u.user_id,
          u.name,
          u.email,
          u.mobile,
          u.status,
          u.created_at,
          w.wholesaler_id,
          w.company_name,
          w.gstin,
          w.drug_license_no,
          w.address,
          w.phone,
          w.email AS wholesaler_email
        FROM mas_users u
        INNER JOIN mas_wholesalers w
        ON u.user_id = w.user_id
        WHERE u.user_id = ?
        `,
      [userId],
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Wholesaler not found",
      });
    }

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getRetailerList = async (req, res) => {
  try {
    const [rows] = await db.query(`
        SELECT
          u.user_id,
          u.name,
          r.shop_name,
          r.drug_license_no
        FROM mas_users u
        INNER JOIN mas_retailers r
          ON u.user_id = r.user_id
        WHERE u.role_id = 4
        ORDER BY u.name ASC
      `);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getRetailerDetails = async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid retailer id",
      });
    }

    const [[data]] = await db.query(
      `
        SELECT
          u.user_id,
          u.name,
          u.email,
          u.mobile,
          u.status,
          u.created_at,

          r.retailer_id,
          r.shop_name,
          r.gstin,
          r.drug_license_no,
          r.address,
          r.phone,
          r.email AS retailer_email

        FROM mas_users u
        INNER JOIN mas_retailers r
          ON u.user_id = r.user_id

        WHERE u.user_id = ?
        `,
      [userId],
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Retailer not found",
      });
    }

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getStockTargets = async (req, res) => {
  try {
    const [rows] = await db.query(`
        SELECT
          u.user_id,
          u.name,
          'wholesaler' AS user_type,
          w.company_name AS business_name,
          w.drug_license_no
        FROM mas_users u
        INNER JOIN mas_wholesalers w
        ON u.user_id = w.user_id

        UNION ALL

        SELECT
          u.user_id,
          u.name,
          'retailer' AS user_type,
          r.shop_name AS business_name,
          r.drug_license_no
        FROM mas_users u
        INNER JOIN mas_retailers r
        ON u.user_id = r.user_id

        ORDER BY name
      `);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getStockDetails = async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const [[user]] = await db.query(
      `
      SELECT user_id, role_id
      FROM mas_users
      WHERE user_id = ?
      `,
      [userId],
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    let rows = [];

    if (user.role_id === 4) {
      [rows] = await db.query(
        `
        SELECT DISTINCT

          wu.name AS supplier_name,
          w.company_name AS supplier_shop,
          w.drug_license_no,

          d.drug_name,

          COALESCE(st.quantity,0) AS available_stock,

          COALESCE(
            (
              SELECT SUM(s.quantity)
              FROM trx_sales s
              WHERE s.user_id = ?
              AND s.batch_id = b.batch_id
            ),
            0
          ) AS sold_stock

        FROM trx_stock st

        INNER JOIN trx_batches b
          ON st.batch_id = b.batch_id

        INNER JOIN mas_drugs d
          ON b.drug_id = d.drug_id

        LEFT JOIN trx_invoice_items ii
          ON ii.batch_id = b.batch_id

        LEFT JOIN trx_invoices inv
          ON ii.invoice_id = inv.invoice_id

        LEFT JOIN mas_users wu
          ON inv.sender_id = wu.user_id

        LEFT JOIN mas_wholesalers w
          ON wu.user_id = w.user_id

        WHERE st.user_id = ?
        `,
        [userId, userId],
      );
    } else {
      [rows] = await db.query(
        `
        SELECT

          m.company_name AS supplier_name,
          m.company_name AS supplier_shop,
          m.drug_license_no,

          d.drug_name,

          st.quantity AS available_stock,

          COALESCE(
            (
              SELECT SUM(sm.change_qty)
              FROM trx_stock_movement sm
              WHERE sm.user_id = ?
              AND sm.batch_id = b.batch_id
              AND sm.movement_type = 'OUT'
            ),
            0
          ) AS sold_stock

        FROM trx_stock st

        INNER JOIN trx_batches b
          ON st.batch_id = b.batch_id

        INNER JOIN mas_drugs d
          ON b.drug_id = d.drug_id

        INNER JOIN mas_manufacturers m
          ON d.manufacturer_id = m.manufacturer_id

        WHERE st.user_id = ?
        `,
        [userId, userId],
      );
    }

    const groupedAvailable = {};

    for (const row of rows) {
      const supplierKey = `${row.supplier_name}_${row.drug_license_no}`;

      if (!groupedAvailable[supplierKey]) {
        groupedAvailable[supplierKey] = {
          supplier_name: row.supplier_name,
          supplier_shop: row.supplier_shop,
          drug_license_no: row.drug_license_no,
          drugs: [],
        };
      }

      const existingDrug = groupedAvailable[supplierKey].drugs.find(
        (item) => item.drug_name === row.drug_name,
      );

      if (existingDrug) {
        existingDrug.total_stock +=
          Number(row.available_stock) + Number(row.sold_stock);

        existingDrug.sold_stock += Number(row.sold_stock);

        existingDrug.available_stock += Number(row.available_stock);
      } else {
        groupedAvailable[supplierKey].drugs.push({
          drug_name: row.drug_name,
          total_stock: Number(row.available_stock) + Number(row.sold_stock),
          sold_stock: Number(row.sold_stock),
          available_stock: Number(row.available_stock),
        });
      }
    }

    const [expiredRows] = await db.query(
      `
      SELECT
        d.drug_name,
        b.expiry_date,
        st.quantity
      FROM trx_stock st
      INNER JOIN trx_batches b
        ON st.batch_id = b.batch_id
      INNER JOIN mas_drugs d
        ON b.drug_id = d.drug_id
      WHERE st.user_id = ?
      AND b.expiry_date < CURDATE()
      AND st.quantity > 0
      `,
      [userId],
    );

    return res.json({
      success: true,
      available_stock: Object.values(groupedAvailable),
      expired_stock: expiredRows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getSalesList = async (req, res) => {
  try {
    const { type } = req.query;

    let rows = [];

    if (type === "wholesaler") {
      [rows] = await db.query(`
        SELECT
          u.user_id,
          u.name,
          w.company_name AS business_name,
          w.drug_license_no,
          'wholesaler' AS user_type
        FROM mas_users u
        INNER JOIN mas_wholesalers w
          ON u.user_id = w.user_id
        WHERE u.role_id = 3
        ORDER BY u.name ASC
      `);
    } else {
      [rows] = await db.query(`
        SELECT
          u.user_id,
          u.name,
          r.shop_name AS business_name,
          r.drug_license_no,
          'retailer' AS user_type
        FROM mas_users u
        INNER JOIN mas_retailers r
          ON u.user_id = r.user_id
        WHERE u.role_id = 4
        ORDER BY u.name ASC
      `);
    }

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getSaleDetails = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const type = req.query.type;

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    let profile = null;
    let sales = [];

    if (type === "wholesaler") {
      const [[wholesaler]] = await db.query(
        `
          SELECT
            u.user_id,
            u.name,
            w.company_name,
            w.drug_license_no,
            u.mobile
          FROM mas_users u
          INNER JOIN mas_wholesalers w
            ON u.user_id = w.user_id
          WHERE u.user_id = ?
          `,
        [userId],
      );

      if (!wholesaler) {
        return res.status(404).json({
          success: false,
          message: "Wholesaler not found",
        });
      }

      profile = wholesaler;

      [sales] = await db.query(
        `
          SELECT
            inv.invoice_id,
            inv.invoice_number,
            inv.invoice_date,
            inv.total_amount,
            inv.status,

            ru.user_id AS retailer_id,
            ru.name AS retailer_name,
            ru.mobile AS retailer_mobile,

            r.shop_name,
            r.drug_license_no,

            d.drug_name,
            d.strength,
            d.dosage_form,

            b.batch_no,

            ii.quantity,
            ii.price

          FROM trx_invoices inv

          INNER JOIN trx_invoice_items ii
            ON inv.invoice_id = ii.invoice_id

          INNER JOIN trx_batches b
            ON ii.batch_id = b.batch_id

          INNER JOIN mas_drugs d
            ON b.drug_id = d.drug_id

          INNER JOIN mas_users ru
            ON inv.receiver_id = ru.user_id

          INNER JOIN mas_retailers r
            ON ru.user_id = r.user_id

          WHERE inv.sender_id = ?

          ORDER BY inv.invoice_date DESC,
                   inv.invoice_id DESC
          `,
        [userId],
      );
    } else {
      const [[retailer]] = await db.query(
        `
          SELECT
            u.user_id,
            u.name,
            u.mobile,
            r.shop_name,
            r.drug_license_no
          FROM mas_users u
          INNER JOIN mas_retailers r
            ON u.user_id = r.user_id
          WHERE u.user_id = ?
          `,
        [userId],
      );

      if (!retailer) {
        return res.status(404).json({
          success: false,
          message: "Retailer not found",
        });
      }

      profile = retailer;

      [sales] = await db.query(
        `
          SELECT
            s.sale_id,
            s.patient_name,
            s.patient_mobile,
            s.doctor_name,
            s.quantity,
            s.price,
            s.total_amount,
            s.payment_mode,
            s.created_at,

            d.drug_name,
            d.strength,
            d.dosage_form,

            b.batch_no,
            b.manufacture_date,
            b.expiry_date

          FROM trx_sales s

          INNER JOIN trx_batches b
            ON s.batch_id = b.batch_id

          INNER JOIN mas_drugs d
            ON b.drug_id = d.drug_id

          WHERE s.user_id = ?

          ORDER BY s.created_at DESC
          `,
        [userId],
      );
    }

    return res.status(200).json({
      success: true,
      profile,
      sales,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getDrugList = async (req, res) => {
  try {
    const { search = "" } = req.query;

    const [drugs] = await db.query(
      `
        SELECT
          drug_id,
          drug_name,
          composition,
          category,
          dosage_form,
          strength,
          is_narcotic
        FROM mas_drugs_master
        WHERE status = 'active'
        AND (
          ? = ''
          OR drug_name LIKE ?
          OR composition LIKE ?
          OR category LIKE ?
          OR strength LIKE ?
        )
        ORDER BY drug_name ASC
        `,
      [search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`],
    );

    return res.json({
      success: true,
      data: drugs,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getDrugHolders = async (req, res) => {
  try {
    const drugId = Number(req.params.drugId);
    const type = req.query.type || "all";
    const search = req.query.search || "";

    if (!drugId) {
      return res.status(400).json({
        success: false,
        message: "Invalid drug id",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        u.user_id,
        u.name,
        u.role_id,

        CASE
          WHEN u.role_id = 3 THEN 'wholesaler'
          WHEN u.role_id = 4 THEN 'retailer'
        END AS user_type,

        w.company_name,
        r.shop_name,

        COALESCE(
          w.drug_license_no,
          r.drug_license_no
        ) AS drug_license_no,

        COALESCE((
          SELECT SUM(sm.change_qty)
          FROM trx_stock_movement sm
          INNER JOIN trx_batches tb ON tb.batch_id = sm.batch_id
          INNER JOIN mas_drugs md ON md.drug_id = tb.drug_id
          WHERE sm.user_id = u.user_id
            AND sm.movement_type = 'IN'
            AND md.master_drug_id = ?
        ), 0) AS total_received_qty,

        COALESCE((
          SELECT SUM(sm.change_qty)
          FROM trx_stock_movement sm
          INNER JOIN trx_batches tb ON tb.batch_id = sm.batch_id
          INNER JOIN mas_drugs md ON md.drug_id = tb.drug_id
          WHERE sm.user_id = u.user_id
            AND sm.movement_type = 'OUT'
            AND sm.reference_type = 'invoice'
            AND md.master_drug_id = ?
        ), 0) AS total_supplied_qty,

        COALESCE((
          SELECT SUM(s.quantity)
          FROM trx_stock s
          INNER JOIN trx_batches tb ON tb.batch_id = s.batch_id
          INNER JOIN mas_drugs md ON md.drug_id = tb.drug_id
          WHERE s.user_id = u.user_id
            AND md.master_drug_id = ?
        ), 0) AS available_qty,

        COALESCE((
          SELECT SUM(ts.quantity)
          FROM trx_sales ts
          INNER JOIN trx_batches tb ON tb.batch_id = ts.batch_id
          INNER JOIN mas_drugs md ON md.drug_id = tb.drug_id
          WHERE ts.user_id = u.user_id
            AND md.master_drug_id = ?
        ), 0) AS sold_qty

      FROM mas_users u

      LEFT JOIN mas_wholesalers w ON w.user_id = u.user_id
      LEFT JOIN mas_retailers r ON r.user_id = u.user_id

      WHERE u.role_id IN (3, 4)

      AND EXISTS (
        SELECT 1
        FROM trx_stock st
        INNER JOIN trx_batches b ON b.batch_id = st.batch_id
        INNER JOIN mas_drugs md ON md.drug_id = b.drug_id
        WHERE st.user_id = u.user_id
          AND md.master_drug_id = ?
      )

      AND (
        (? = 'all')
        OR (? = 'wholesaler' AND u.role_id = 3)
        OR (? = 'retailer' AND u.role_id = 4)
      )

      AND (
        ? = ''
        OR u.name LIKE ?
        OR w.company_name LIKE ?
        OR r.shop_name LIKE ?
        OR w.drug_license_no LIKE ?
        OR r.drug_license_no LIKE ?
      )

      ORDER BY available_qty DESC
      `,
      [
        drugId,
        drugId,
        drugId,
        drugId,
        drugId,

        type,
        type,
        type,

        search,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
      ],
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getDrugHolderDetails = async (req, res) => {
  try {
    const drugId = Number(req.params.drugId);
    const userId = Number(req.params.userId);

    if (!drugId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Invalid parameters",
      });
    }

    const [[holder]] = await db.query(
      `
        SELECT
          u.user_id,
          u.name,
          u.email,
          u.mobile,
          u.role_id,

          w.company_name,
          w.gstin,
          w.drug_license_no,
          w.address,

          r.shop_name,
          r.gstin AS retailer_gstin,
          r.drug_license_no AS retailer_dl,
          r.address AS retailer_address

        FROM mas_users u
        LEFT JOIN mas_wholesalers w ON u.user_id = w.user_id
        LEFT JOIN mas_retailers r ON u.user_id = r.user_id
        WHERE u.user_id = ?
        `,
      [userId],
    );

    if (!holder) {
      return res.status(404).json({
        success: false,
        message: "Holder not found",
      });
    }

    const [[summary]] = await db.query(
      `
        SELECT
          COALESCE((
            SELECT SUM(sm.change_qty)
            FROM trx_stock_movement sm
            INNER JOIN trx_batches tb ON sm.batch_id = tb.batch_id
            INNER JOIN mas_drugs md ON md.drug_id = tb.drug_id
            WHERE sm.user_id = ?
              AND sm.movement_type = 'IN'
              AND md.master_drug_id = ?
          ), 0) AS received_qty,

          COALESCE((
            SELECT SUM(sm.change_qty)
            FROM trx_stock_movement sm
            INNER JOIN trx_batches tb ON sm.batch_id = tb.batch_id
            INNER JOIN mas_drugs md ON md.drug_id = tb.drug_id
            WHERE sm.user_id = ?
              AND sm.movement_type = 'OUT'
              AND md.master_drug_id = ?
          ), 0) AS supplied_qty,

          COALESCE((
            SELECT SUM(s.quantity)
            FROM trx_stock s
            INNER JOIN trx_batches tb ON s.batch_id = tb.batch_id
            INNER JOIN mas_drugs md ON md.drug_id = tb.drug_id
            WHERE s.user_id = ?
              AND md.master_drug_id = ?
          ), 0) AS available_qty,

          COALESCE((
            SELECT SUM(sl.quantity)
            FROM trx_sales sl
            INNER JOIN trx_batches tb ON sl.batch_id = tb.batch_id
            INNER JOIN mas_drugs md ON md.drug_id = tb.drug_id
            WHERE sl.user_id = ?
              AND md.master_drug_id = ?
          ), 0) AS sold_qty,

          COALESCE((
            SELECT SUM(s.quantity)
            FROM trx_stock s
            INNER JOIN trx_batches tb ON s.batch_id = tb.batch_id
            INNER JOIN mas_drugs md ON md.drug_id = tb.drug_id
            WHERE s.user_id = ?
              AND md.master_drug_id = ?
              AND tb.expiry_date <= CURDATE()
          ), 0) AS expired_qty
        `,
      [
        userId,
        drugId,
        userId,
        drugId,
        userId,
        drugId,
        userId,
        drugId,
        userId,
        drugId,
      ],
    );

    const [manufacturerBatches] = await db.query(
      `
        SELECT
          m.manufacturer_id,
          m.company_name AS manufacturer_name,
          m.drug_license_no AS manufacturer_dl,
          m.gstin AS manufacturer_gstin,

          b.batch_id,
          b.batch_no,
          b.manufacture_date,
          b.expiry_date,
          b.mrp,
          b.purchase_price,

          COALESCE(stock.available_qty, 0) AS available_qty,

          COALESCE((
            SELECT SUM(sm.change_qty)
            FROM trx_stock_movement sm
            WHERE sm.batch_id = b.batch_id
              AND sm.user_id = ?
              AND sm.movement_type = 'IN'
          ), 0) AS received_qty,

          COALESCE((
            SELECT SUM(sm.change_qty)
            FROM trx_stock_movement sm
            WHERE sm.batch_id = b.batch_id
              AND sm.user_id = ?
              AND sm.movement_type = 'OUT'
          ), 0) AS supplied_qty

        FROM trx_batches b
        INNER JOIN mas_drugs d ON b.drug_id = d.drug_id
        LEFT JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
        LEFT JOIN (
          SELECT batch_id, SUM(quantity) AS available_qty
          FROM trx_stock
          WHERE user_id = ?
          GROUP BY batch_id
        ) stock ON stock.batch_id = b.batch_id

        WHERE d.master_drug_id = ?
          AND EXISTS (
            SELECT 1
            FROM trx_stock st
            WHERE st.batch_id = b.batch_id
              AND st.user_id = ?
          )

        ORDER BY m.company_name, b.expiry_date
        `,
      [userId, userId, userId, drugId, userId],
    );

    let purchaseHistory = [];

    if (holder.role_id === 3) {
      const [rows] = await db.query(
        `
          SELECT
            sm.movement_id AS invoice_id,
            CONCAT('STOCK-', sm.movement_id) AS invoice_number,
            sm.created_at AS invoice_date,

            m.manufacturer_id AS wholesaler_id,
            m.company_name AS wholesaler_name,
            m.company_name,
            m.drug_license_no,

            sm.change_qty AS quantity,
            b.batch_no

          FROM trx_stock_movement sm
          INNER JOIN trx_batches b ON sm.batch_id = b.batch_id
          INNER JOIN mas_drugs d ON b.drug_id = d.drug_id
          LEFT JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id

          WHERE sm.user_id = ?
            AND d.master_drug_id = ?
            AND sm.movement_type = 'IN'
            AND sm.reference_type = 'batch'

          ORDER BY sm.created_at DESC
          `,
        [userId, drugId],
      );
      purchaseHistory = rows;
    } else {
      const [rows] = await db.query(
        `
          SELECT
            i.invoice_id,
            i.invoice_number,
            i.invoice_date,

            sender.user_id AS wholesaler_id,
            sender.name AS wholesaler_name,

            ws.company_name,
            ws.drug_license_no,

            ii.quantity,
            b.batch_no

          FROM trx_invoice_items ii
          INNER JOIN trx_invoices i ON ii.invoice_id = i.invoice_id
          INNER JOIN trx_batches b ON ii.batch_id = b.batch_id
          INNER JOIN mas_drugs d ON b.drug_id = d.drug_id
          INNER JOIN mas_users sender ON i.sender_id = sender.user_id
          LEFT JOIN mas_wholesalers ws ON sender.user_id = ws.user_id

          WHERE i.receiver_id = ?
            AND d.master_drug_id = ?

          ORDER BY i.invoice_date DESC
          `,
        [userId, drugId],
      );
      purchaseHistory = rows;
    }

    const [supplyHistory] = await db.query(
      `
        SELECT
          i.invoice_id,
          i.invoice_number,
          i.invoice_date,

          receiver.user_id AS retailer_id,
          receiver.name AS retailer_name,

          r.shop_name,
          r.drug_license_no,

          ii.quantity,
          b.batch_no

        FROM trx_invoice_items ii
        INNER JOIN trx_invoices i ON ii.invoice_id = i.invoice_id
        INNER JOIN trx_batches b ON ii.batch_id = b.batch_id
        INNER JOIN mas_drugs d ON b.drug_id = d.drug_id
        INNER JOIN mas_users receiver ON i.receiver_id = receiver.user_id
        LEFT JOIN mas_retailers r ON receiver.user_id = r.user_id

        WHERE i.sender_id = ?
          AND d.master_drug_id = ?

        ORDER BY i.invoice_date DESC
        `,
      [userId, drugId],
    );

    const [salesHistory] = await db.query(
      `
        SELECT
          sl.sale_id,
          sl.created_at AS sale_date,
          sl.quantity,
          sl.patient_name,
          sl.patient_mobile AS mobile,
          sl.abha_id,
          b.batch_no

        FROM trx_sales sl
        INNER JOIN trx_batches b ON sl.batch_id = b.batch_id
        INNER JOIN mas_drugs d ON b.drug_id = d.drug_id

        WHERE sl.user_id = ?
          AND d.master_drug_id = ?

        ORDER BY sl.created_at DESC
        `,
      [userId, drugId],
    );

    const groupedManufacturers = {};

    manufacturerBatches.forEach((row) => {
      const key = row.manufacturer_id || 0;

      if (!groupedManufacturers[key]) {
        groupedManufacturers[key] = {
          manufacturer_id: row.manufacturer_id,
          manufacturer_name: row.manufacturer_name,
          manufacturer_dl: row.manufacturer_dl,
          manufacturer_gstin: row.manufacturer_gstin,
          batches: [],
        };
      }

      groupedManufacturers[key].batches.push({
        batch_id: row.batch_id,
        batch_no: row.batch_no,
        manufacture_date: row.manufacture_date,
        expiry_date: row.expiry_date,
        mrp: row.mrp,
        purchase_price: row.purchase_price,
        received_qty: Number(row.received_qty || 0),
        supplied_qty: Number(row.supplied_qty || 0),
        available_qty: Number(row.available_qty || 0),
      });
    });

    return res.json({
      success: true,
      data: {
        holder,
        summary: {
          received_qty: Number(summary.received_qty || 0),
          supplied_qty: Number(summary.supplied_qty || 0),
          available_qty: Number(summary.available_qty || 0),
          sold_qty: Number(summary.sold_qty || 0),
          expired_qty: Number(summary.expired_qty || 0),
        },
        manufacturer_batches: Object.values(groupedManufacturers),
        purchase_history: purchaseHistory,
        supply_history: supplyHistory,
        sales_history: salesHistory,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getInspectorProfile = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);

    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    if (req.user?.role !== "inspector") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        u.user_id,
        i.inspector_id,
        u.name,
        u.email,
        u.mobile,
        u.status,
        u.role_id,
        i.department,
        u.created_at,
        u.last_login
      FROM mas_users u
      INNER JOIN mas_inspectors i
        ON i.user_id = u.user_id
      WHERE u.user_id = ?
      LIMIT 1
      `,
      [user_id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Inspector profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("getInspectorProfile Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
module.exports = {
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
};
