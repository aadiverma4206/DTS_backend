const db = require("../config/db");

const createRetailer = async (req, res) => {
  let conn;

  try {
    const user_id = req.user?.user_id;
    const role = req.user?.role;

    if (!user_id || role !== "retailer") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    let { shop_name, gstin, drug_license_no, address, phone, email } = req.body;

    shop_name = shop_name?.trim();
    gstin = gstin?.trim();
    drug_license_no = drug_license_no?.trim();
    address = address?.trim();
    phone = phone?.trim();
    email = email?.trim().toLowerCase();

    if (
      !shop_name ||
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

    if (!/^[0-9]{10}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be 10 digits",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email address",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [existing] = await conn.query(
      `SELECT retailer_id
       FROM mas_retailers
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
      `INSERT INTO mas_retailers
      (
        user_id,
        shop_name,
        gstin,
        drug_license_no,
        address,
        phone,
        email
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user_id, shop_name, gstin, drug_license_no, address, phone, email],
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Retailer profile created successfully",
    });
  } catch (err) {
    if (conn) {
      await conn.rollback();
    }

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "Duplicate entry found",
      });
    }

    console.error("Create Retailer Error:", err);

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

const formatAbhaId = (value) => {
  const digits = String(value || "").replace(/\D/g, "");

  if (digits.length !== 14) {
    return null;
  }

  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10, 14)}`;
};

const sellProduct = async (req, res) => {
  let conn;

  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id || role !== "retailer") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      items,
      patient_name,
      patient_mobile,
      abha_id,
      doctor_name,
      payment_mode,
    } = req.body;

    const validModes = ["Cash", "Online", "Card"];

    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      !patient_name?.trim() ||
      !abha_id?.trim() ||
      !validModes.includes(payment_mode)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid input",
      });
    }

    const formattedAbhaId = formatAbhaId(abha_id);

    if (!formattedAbhaId) {
      return res.status(400).json({
        success: false,
        message: "Invalid ABHA ID",
      });
    }

    conn = await db.getConnection();

    await conn.beginTransaction();

    let total_amount = 0;

    const sale_ids = [];
    const movement_ids = [];

    for (const item of items) {
      const batch_id = Number(item.batch_id);
      const qty = Number(item.quantity);
      const price = Number(item.price);

      if (
        !batch_id ||
        !Number.isInteger(qty) ||
        qty <= 0 ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        throw new Error("Invalid item data");
      }

      const [stockRows] = await conn.query(
        `
        SELECT
            s.quantity,
            b.mrp,

            (
              SELECT ii.price
              FROM trx_invoice_items ii
              INNER JOIN trx_invoices i
                ON i.invoice_id = ii.invoice_id
              WHERE ii.batch_id = s.batch_id
                AND i.receiver_id = s.user_id
                AND i.status IN ('accepted','paid')
              ORDER BY i.invoice_date DESC, i.invoice_id DESC
              LIMIT 1
            ) AS purchase_price

        FROM trx_stock s
        INNER JOIN trx_batches b
          ON b.batch_id = s.batch_id

        WHERE s.user_id = ?
          AND s.batch_id = ?

        FOR UPDATE
        `,
        [user_id, batch_id],
      );

      if (!stockRows.length) {
        throw new Error(`Batch ${batch_id} not found in stock`);
      }

      const currentQty = Number(stockRows[0].quantity) || 0;
      const mrp = Number(stockRows[0].mrp) || 0;
      const purchasePrice = Number(stockRows[0].purchase_price) || 0;

      if (currentQty <= 0) {
        throw new Error(`Batch ${batch_id} is out of stock`);
      }

      if (currentQty < qty) {
        throw new Error(
          `Insufficient stock for batch ${batch_id}. Available: ${currentQty}`,
        );
      }

      if (purchasePrice > 0 && price < purchasePrice) {
        throw new Error(
          `Selling price cannot be lower than purchase price ₹${purchasePrice} for batch ${batch_id}`,
        );
      }

      if (price > mrp) {
        throw new Error(
          `Selling price cannot exceed MRP ₹${mrp} for batch ${batch_id}`,
        );
      }

      await conn.query(
        `
        UPDATE trx_stock
        SET quantity = quantity - ?
        WHERE user_id = ?
          AND batch_id = ?
        `,
        [qty, user_id, batch_id],
      );

      const [saleRes] = await conn.query(
        `
        INSERT INTO trx_sales
        (
          user_id,
          batch_id,
          quantity,
          price,
          patient_name,
          patient_mobile,
          doctor_name,
          payment_mode,
          abha_id
        )
        VALUES
        (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        )
        `,
        [
          user_id,
          batch_id,
          qty,
          price,
          patient_name.trim(),
          patient_mobile?.trim() || null,
          doctor_name?.trim() || null,
          payment_mode,
          formattedAbhaId,
        ],
      );

      const sale_id = saleRes.insertId;

      sale_ids.push(sale_id);

      const [movementRes] = await conn.query(
        `
        INSERT INTO trx_stock_movement
        (
          user_id,
          batch_id,
          change_qty,
          movement_type,
          reference_id,
          reference_type
        )
        VALUES
        (
          ?,
          ?,
          ?,
          'OUT',
          ?,
          'sale'
        )
        `,
        [user_id, batch_id, qty, sale_id],
      );

      const movement_id = movementRes.insertId;

      movement_ids.push(movement_id);

      await conn.query(
        `
        UPDATE trx_sales
        SET movement_id = ?
        WHERE sale_id = ?
        `,
        [movement_id, sale_id],
      );

      total_amount += qty * price;
    }

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Products sold successfully",
      data: {
        sale_ids,
        movement_ids,
        patient_name: patient_name.trim(),
        patient_mobile: patient_mobile?.trim() || null,
        abha_id: formattedAbhaId,
        payment_mode,
        total_items: items.length,
        total_amount,
      },
    });
  } catch (err) {
    if (conn) {
      await conn.rollback();
    }

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
};

const getMyStock = async (req, res) => {
  try {
    const user_id = req.user?.user_id;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Invalid user",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          s.batch_id,
          s.quantity,

          b.batch_no,
          b.mrp,
          b.manufacture_date,
          b.expiry_date,

          d.drug_name,
          d.composition,
          d.category,
          d.dosage_form,
          d.strength,

          m.company_name AS manufacturer_name,

          (
            SELECT ii.price
            FROM trx_invoice_items ii
            INNER JOIN trx_invoices i
              ON i.invoice_id = ii.invoice_id
            WHERE ii.batch_id = s.batch_id
              AND i.receiver_id = s.user_id
              AND i.status = 'accepted'
            ORDER BY i.invoice_date DESC
            LIMIT 1
          ) AS purchase_price,

          (
            SELECT i.invoice_date
            FROM trx_invoice_items ii
            INNER JOIN trx_invoices i
              ON i.invoice_id = ii.invoice_id
            WHERE ii.batch_id = s.batch_id
              AND i.receiver_id = s.user_id
              AND i.status = 'accepted'
            ORDER BY i.invoice_date DESC
            LIMIT 1
          ) AS accepted_at

      FROM trx_stock s
      INNER JOIN trx_batches b
        ON s.batch_id = b.batch_id
      INNER JOIN mas_drugs d
        ON b.drug_id = d.drug_id
      INNER JOIN mas_manufacturers m
        ON d.manufacturer_id = m.manufacturer_id

      WHERE s.user_id = ?
        AND s.quantity > 0

      ORDER BY s.batch_id DESC
      `,
      [user_id],
    );

    return res.status(200).json({
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

const getStockDetail = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const batchId = Number(req.params.batchId);

    if (!user_id || !batchId) {
      return res.status(400).json({
        success: false,
        message: "Invalid request",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          s.stock_id,
          s.user_id,
          s.batch_id,
          s.quantity,
          s.last_updated,

          b.batch_no,
          b.manufacture_date,
          b.expiry_date,
          b.stock_receive_date,
          b.mrp,
          b.purchase_price AS manufacturer_purchase_price,
          b.status AS batch_status,

          d.drug_id,
          d.drug_name,
          d.composition,
          d.category,
          d.dosage_form,
          d.strength,
          d.is_narcotic,

          m.manufacturer_id,
          m.company_name AS manufacturer_name,
          m.gstin,
          m.drug_license_no,
          m.pan_no,
          m.cin_no,
          m.address AS manufacturer_address,
          m.phone AS manufacturer_phone,
          m.email AS manufacturer_email,
          m.website AS manufacturer_website,

          (
            SELECT ii.price
            FROM trx_invoice_items ii
            INNER JOIN trx_invoices i
              ON i.invoice_id = ii.invoice_id
            WHERE ii.batch_id = s.batch_id
              AND i.receiver_id = s.user_id
              AND i.status = 'accepted'
            ORDER BY i.invoice_date DESC
            LIMIT 1
          ) AS retailer_purchase_price,

          (
            SELECT i.invoice_number
            FROM trx_invoice_items ii
            INNER JOIN trx_invoices i
              ON i.invoice_id = ii.invoice_id
            WHERE ii.batch_id = s.batch_id
              AND i.receiver_id = s.user_id
              AND i.status = 'accepted'
            ORDER BY i.invoice_date DESC
            LIMIT 1
          ) AS invoice_number,

          (
            SELECT i.invoice_date
            FROM trx_invoice_items ii
            INNER JOIN trx_invoices i
              ON i.invoice_id = ii.invoice_id
            WHERE ii.batch_id = s.batch_id
              AND i.receiver_id = s.user_id
              AND i.status = 'accepted'
            ORDER BY i.invoice_date DESC
            LIMIT 1
          ) AS accepted_at,

          (
            SELECT mw.company_name
            FROM trx_invoice_items ii
            INNER JOIN trx_invoices i
              ON i.invoice_id = ii.invoice_id
            INNER JOIN mas_wholesalers mw
              ON mw.user_id = i.sender_id
            WHERE ii.batch_id = s.batch_id
              AND i.receiver_id = s.user_id
              AND i.status = 'accepted'
            ORDER BY i.invoice_date DESC
            LIMIT 1
          ) AS wholesaler_name,

          (
            SELECT mw.gstin
            FROM trx_invoice_items ii
            INNER JOIN trx_invoices i
              ON i.invoice_id = ii.invoice_id
            INNER JOIN mas_wholesalers mw
              ON mw.user_id = i.sender_id
            WHERE ii.batch_id = s.batch_id
              AND i.receiver_id = s.user_id
              AND i.status = 'accepted'
            ORDER BY i.invoice_date DESC
            LIMIT 1
          ) AS wholesaler_gstin,

          (
            SELECT mw.drug_license_no
            FROM trx_invoice_items ii
            INNER JOIN trx_invoices i
              ON i.invoice_id = ii.invoice_id
            INNER JOIN mas_wholesalers mw
              ON mw.user_id = i.sender_id
            WHERE ii.batch_id = s.batch_id
              AND i.receiver_id = s.user_id
              AND i.status = 'accepted'
            ORDER BY i.invoice_date DESC
            LIMIT 1
          ) AS wholesaler_drug_license_no,

          (
            SELECT u.mobile
            FROM trx_invoice_items ii
            INNER JOIN trx_invoices i
              ON i.invoice_id = ii.invoice_id
            INNER JOIN mas_users u
              ON u.user_id = i.sender_id
            WHERE ii.batch_id = s.batch_id
              AND i.receiver_id = s.user_id
              AND i.status = 'accepted'
            ORDER BY i.invoice_date DESC
            LIMIT 1
          ) AS wholesaler_phone,

          (
            SELECT u.email
            FROM trx_invoice_items ii
            INNER JOIN trx_invoices i
              ON i.invoice_id = ii.invoice_id
            INNER JOIN mas_users u
              ON u.user_id = i.sender_id
            WHERE ii.batch_id = s.batch_id
              AND i.receiver_id = s.user_id
              AND i.status = 'accepted'
            ORDER BY i.invoice_date DESC
            LIMIT 1
          ) AS wholesaler_email

      FROM trx_stock s
      INNER JOIN trx_batches b
        ON s.batch_id = b.batch_id
      INNER JOIN mas_drugs d
        ON b.drug_id = d.drug_id
      INNER JOIN mas_manufacturers m
        ON d.manufacturer_id = m.manufacturer_id

      WHERE s.user_id = ?
        AND s.batch_id = ?
      LIMIT 1
      `,
      [user_id, batchId],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Stock not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

const getDashboard = async (req, res) => {
  try {
    const user_id = req.user?.user_id;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "Invalid user" });
    }

    const [rows] = await db.query(
      `SELECT COUNT(*) AS total_products,
              COALESCE(SUM(quantity),0) AS total_quantity
       FROM trx_stock
       WHERE user_id = ?`,
      [user_id],
    );

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
const getSaleHistory = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Invalid user",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          s.sale_id,
          s.batch_id,
          s.quantity,
          s.price,
          s.total_amount,
          s.patient_name,
          s.patient_mobile,
          s.doctor_name,
          s.abha_id,
          s.payment_mode,
          s.created_at,

          b.batch_no,

          d.drug_id,
          d.drug_name,
          d.strength,
          d.dosage_form,

          m.company_name AS manufacturer_name

      FROM trx_sales s
      INNER JOIN trx_batches b
          ON s.batch_id = b.batch_id

      INNER JOIN mas_drugs d
          ON b.drug_id = d.drug_id

      INNER JOIN mas_manufacturers m
          ON d.manufacturer_id = m.manufacturer_id

      WHERE s.user_id = ?
      ORDER BY s.created_at DESC
      `,
      [user_id],
    );

    const groupedSales = {};

    rows.forEach((sale) => {
      const key = `${sale.patient_name}_${sale.patient_mobile}_${sale.created_at}`;

      if (!groupedSales[key]) {
        groupedSales[key] = {
          patient_name: sale.patient_name,
          patient_mobile: sale.patient_mobile,
          doctor_name: sale.doctor_name,
          abha_id: sale.abha_id,
          payment_mode: sale.payment_mode,
          manufacturer_name: sale.manufacturer_name,
          created_at: sale.created_at,
          total_amount: 0,
          drugs: [],
        };
      }

      groupedSales[key].total_amount += Number(sale.total_amount);

      groupedSales[key].drugs.push({
        sale_id: sale.sale_id,
        batch_id: sale.batch_id,
        batch_no: sale.batch_no,
        drug_id: sale.drug_id,
        drug_name: sale.drug_name,
        strength: sale.strength,
        dosage_form: sale.dosage_form,
        quantity: sale.quantity,
        price: sale.price,
        total_amount: sale.total_amount,
      });
    });

    return res.status(200).json({
      success: true,
      count: Object.keys(groupedSales).length,
      data: Object.values(groupedSales),
    });
  } catch (err) {
    console.error("Get Sale History Error:", err);

    return res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};
const getMyProfile = async (req, res) => {
  try {
    const user_id = req.user?.user_id;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "Invalid user" });
    }

    const [rows] = await db.query(
      `SELECT retailer_id, shop_name, gstin, drug_license_no,
              address, phone, email, created_at
       FROM mas_retailers
       WHERE user_id = ?
       LIMIT 1`,
      [user_id],
    );

    return res.status(200).json({ success: true, data: rows[0] || null });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
const getDashboardStats = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);

    const role = req.user?.role;

    if (!user_id || role !== "retailer") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [stockResult, purchaseResult, salesResult, historyResult] =
      await Promise.all([
        db.query(
          `
          SELECT
            COALESCE(
              SUM(quantity),
              0
            ) AS stock
          FROM trx_stock
          WHERE user_id = ?
          `,
          [user_id],
        ),

        db.query(
          `
          SELECT
            COUNT(*) AS purchased
          FROM trx_invoices
          WHERE receiver_id = ?
            AND status IN (
              'accepted',
              'paid'
            )
          `,
          [user_id],
        ),

        db.query(
          `
          SELECT
            COALESCE(
              SUM(quantity),
              0
            ) AS sales
          FROM trx_sales
          WHERE user_id = ?
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
      ]);

    const stock = Number(stockResult?.[0]?.[0]?.stock) || 0;

    const purchased = Number(purchaseResult?.[0]?.[0]?.purchased) || 0;

    const sales = Number(salesResult?.[0]?.[0]?.sales) || 0;

    const history = Number(historyResult?.[0]?.[0]?.history) || 0;

    return res.status(200).json({
      success: true,

      data: {
        stock,
        purchased,
        sales,
        history,
      },
    });
  } catch (error) {
    console.error("Retailer Dashboard Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};
const getMyManufacturers = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);

    const role = req.user?.role;

    if (!user_id || role !== "retailer") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [rows] = await db.query(
      `
        SELECT DISTINCT
            m.manufacturer_id,
            m.company_name,
            m.drug_license_no,
            m.phone,
            COUNT(DISTINCT d.drug_id) AS total_drugs

        FROM trx_invoices i

        INNER JOIN trx_invoice_items ii
            ON i.invoice_id = ii.invoice_id

        INNER JOIN trx_batches b
            ON ii.batch_id = b.batch_id

        INNER JOIN mas_drugs d
            ON b.drug_id = d.drug_id

        INNER JOIN mas_manufacturers m
            ON d.manufacturer_id = m.manufacturer_id

        WHERE i.receiver_id = ?
          AND i.status IN ('accepted','paid')

        GROUP BY
            m.manufacturer_id,
            m.company_name,
            m.drug_license_no,
            m.phone

        ORDER BY m.company_name ASC
        `,
      [user_id],
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getManufacturerDetails = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);

    const role = req.user?.role;

    const manufacturer_id = Number(req.params.manufacturer_id);

    if (!user_id || role !== "retailer") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [manufacturer] = await db.query(
      `
          SELECT
              manufacturer_id,
              company_name,
              gstin,
              drug_license_no,
              address,
              phone,
              email,
              website
          FROM mas_manufacturers
          WHERE manufacturer_id = ?
          LIMIT 1
          `,
      [manufacturer_id],
    );

    if (manufacturer.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Manufacturer not found",
      });
    }

    const [drugs] = await db.query(
      `
          SELECT DISTINCT
              d.drug_id,
              d.drug_name,
              d.strength,
              d.dosage_form

          FROM trx_invoices i

          INNER JOIN trx_invoice_items ii
              ON i.invoice_id = ii.invoice_id

          INNER JOIN trx_batches b
              ON ii.batch_id = b.batch_id

          INNER JOIN mas_drugs d
              ON b.drug_id = d.drug_id

          WHERE i.receiver_id = ?
            AND d.manufacturer_id = ?
            AND i.status IN ('accepted','paid')

          ORDER BY d.drug_name
          `,
      [user_id, manufacturer_id],
    );

    return res.status(200).json({
      success: true,

      data: {
        manufacturer: manufacturer[0],

        drugs,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getMyWholesalers = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id || role !== "retailer") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [rows] = await db.query(
      `
        SELECT DISTINCT
            w.wholesaler_id,
            u.name,
            w.company_name,
            w.drug_license_no,
            w.phone,
            w.email
        FROM trx_invoices i
        INNER JOIN mas_wholesalers w
            ON i.sender_id = w.user_id
        INNER JOIN mas_users u
            ON w.user_id = u.user_id
        WHERE i.receiver_id = ?
        ORDER BY u.name ASC
        `,
      [user_id],
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getWholesalerDetails = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;
    const wholesaler_id = Number(req.params.wholesaler_id);

    if (!user_id || role !== "retailer") {
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
               u.email,
               u.mobile,
               w.company_name,
               w.gstin,
               w.drug_license_no,
               w.address,
               w.phone
           FROM mas_wholesalers w
           INNER JOIN mas_users u
               ON w.user_id = u.user_id
           WHERE w.wholesaler_id = ?
           LIMIT 1
           `,
      [wholesaler_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Wholesaler not found",
      });
    }

    const [drugs] = await db.query(
      `
           SELECT DISTINCT
               d.drug_id,
               d.drug_name,
               d.strength,
               d.dosage_form
           FROM trx_invoices i
           INNER JOIN trx_invoice_items ii
               ON i.invoice_id = ii.invoice_id
           INNER JOIN trx_batches b
               ON ii.batch_id = b.batch_id
           INNER JOIN mas_drugs d
               ON b.drug_id = d.drug_id
           WHERE i.receiver_id = ?
             AND i.sender_id = ?
           ORDER BY d.drug_name
           `,
      [user_id, rows[0].user_id],
    );

    return res.status(200).json({
      success: true,
      data: {
        wholesaler: rows[0],
        drugs,
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getMyPatients = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id || role !== "retailer") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          patient_mobile,
          patient_name,
          MAX(created_at) AS last_purchase_at,
          COUNT(*) AS total_purchases
      FROM trx_sales
      WHERE user_id = ?
      GROUP BY patient_mobile, patient_name
      ORDER BY last_purchase_at DESC
      `,
      [user_id],
    );

    return res.status(200).json({
      success: true,
      total_records: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("Get Patients Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getPatientDetails = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    const patient_mobile = req.params.patient_mobile;

    if (!user_id || role !== "retailer") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [patientRows] = await db.query(
      `
      SELECT
          patient_name,
          patient_mobile,
          COUNT(*) AS total_purchases,
          SUM(quantity) AS total_quantity,
          MAX(created_at) AS last_purchase_at
      FROM trx_sales
      WHERE user_id = ?
        AND patient_mobile = ?
      GROUP BY patient_name, patient_mobile
      `,
      [user_id, patient_mobile],
    );

    if (patientRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    const [sales] = await db.query(
      `
      SELECT
          s.sale_id,
          s.patient_name,
          s.patient_mobile,
          s.abha_id,
          s.quantity,
          s.price,
          s.payment_mode,
          s.doctor_name,
          s.created_at,
          d.drug_name,
          d.strength,
          d.dosage_form,
          b.batch_no
      FROM trx_sales s
      INNER JOIN trx_batches b
          ON s.batch_id = b.batch_id
      INNER JOIN mas_drugs d
          ON b.drug_id = d.drug_id
      WHERE s.user_id = ?
        AND s.patient_mobile = ?
      ORDER BY s.created_at DESC
      `,
      [user_id, patient_mobile],
    );

    return res.status(200).json({
      success: true,
      data: {
        patient: patientRows[0],
        sales,
      },
    });
  } catch (error) {
    console.error("Get Patient Details Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getRetailerProfile = async (req, res) => {
  try {
    const user_id = Number(req.user?.user_id);
    const role = req.user?.role;

    if (!user_id || role !== "retailer") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
          r.retailer_id,
          r.user_id,

          u.name,
          u.email AS account_email,
          u.mobile,
          u.status,
          u.created_at AS account_created_at,

          r.shop_name,
          r.gstin,
          r.drug_license_no,
          r.address,
          r.phone,
          r.email,
          r.created_at

      FROM mas_retailers r

      INNER JOIN mas_users u
          ON r.user_id = u.user_id

      WHERE r.user_id = ?
      LIMIT 1
      `,
      [user_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Retailer profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("Get Retailer Profile Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = {
  createRetailer,
  getMyProfile,
  getRetailerProfile,
  getMyStock,
  getStockDetail,
  sellProduct,
  getSaleHistory,
  getDashboardStats,
  getMyManufacturers,
  getManufacturerDetails,
  getMyWholesalers,
  getWholesalerDetails,
  getMyPatients,
  getPatientDetails,
};
