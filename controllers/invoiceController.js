const db = require("../config/db");

const createFullInvoice = async (req, res) => {
  const { receiver_id, items } = req.body;

  const sender_id = Number(req.user.user_id);

  if (!receiver_id || !Number.isInteger(Number(receiver_id))) {
    return res.status(400).json({
      success: false,
      message: "Invalid receiver",
    });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Invoice items required",
    });
  }

  if (Number(receiver_id) === sender_id) {
    return res.status(400).json({
      success: false,
      message: "Invalid receiver",
    });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [receiver] = await conn.query(
      `
        SELECT user_id

        FROM mas_users

        WHERE user_id = ?
          AND status = 'active'

        LIMIT 1
        `,
      [receiver_id],
    );

    if (!receiver.length) {
      throw new Error("Receiver not found");
    }

    const invoice_number = "INV-" + Date.now();

    const [invRes] = await conn.query(
      `
        INSERT INTO trx_invoices
        (
          sender_id,
          receiver_id,
          invoice_number,
          invoice_date,
          total_amount,
          status
        )
        VALUES
        (
          ?,
          ?,
          ?,
          NOW(),
          0,
          'pending'
        )
        `,
      [sender_id, receiver_id, invoice_number],
    );

    const invoice_id = invRes.insertId;

    let total_amount = 0;

    for (const item of items) {
      const batch_id = Number(item.batch_id);

      const qty = Number(item.quantity);

      const price = Number(item.price);

      if (!Number.isInteger(batch_id) || batch_id <= 0) {
        throw new Error("Invalid batch id");
      }

      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error("Invalid quantity");
      }

      if (isNaN(price) || price <= 0) {
        throw new Error("Invalid price");
      }

      const [batch] = await conn.query(
        `
          SELECT
            b.batch_id,
            b.mrp,
            b.purchase_price,
            b.expiry_date,
            b.status,
            s.quantity AS available_qty

          FROM trx_batches b

          INNER JOIN trx_stock s
            ON b.batch_id = s.batch_id

          WHERE b.batch_id = ?
            AND s.user_id = ?

          LIMIT 1
          `,
        [batch_id, sender_id],
      );

      if (!batch.length) {
        throw new Error("Batch not found");
      }

      const batchData = batch[0];

      const available_qty = Number(batchData.available_qty);

      const mrp = Number(batchData.mrp);

      const purchase_price = Number(batchData.purchase_price);

      const expiry_date = new Date(batchData.expiry_date);

      const today = new Date();

      today.setHours(0, 0, 0, 0);

      if (batchData.status !== "active") {
        throw new Error("Batch is not active");
      }

      if (expiry_date <= today) {
        throw new Error("Expired batch cannot be sold");
      }

      if (qty > available_qty) {
        throw new Error("Insufficient stock");
      }

      if (price > mrp) {
        throw new Error(`Selling price cannot exceed MRP ₹${mrp}`);
      }

      if (price < purchase_price) {
        throw new Error(
          `Selling price cannot be lower than purchase price ₹${purchase_price}`,
        );
      }

      const total = qty * price;

      total_amount += total;

      await conn.query(
        `
        INSERT INTO trx_invoice_items
        (
          invoice_id,
          batch_id,
          quantity,
          price
        )
        VALUES (?, ?, ?, ?)
        `,
        [invoice_id, batch_id, qty, price],
      );
    }

    if (total_amount <= 0) {
      throw new Error("Invalid total amount");
    }

    await conn.query(
      `
      UPDATE trx_invoices

      SET total_amount = ?

      WHERE invoice_id = ?
      `,
      [total_amount, invoice_id],
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Invoice created successfully",
      invoice_id,
      invoice_number,
      total_amount,
    });
  } catch (err) {
    await conn.rollback();

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    conn.release();
  }
};
const updateInvoiceStatus = async (req, res) => {
  const { id } = req.params;

  const { status } = req.body;

  const user_id = Number(req.user.user_id);

  if (!id || !status) {
    return res.status(400).json({
      success: false,
      message: "Missing data",
    });
  }

  const formattedStatus = status.trim().toLowerCase();

  if (!["accepted", "rejected"].includes(formattedStatus)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status",
    });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [invRows] = await conn.query(
      `
          SELECT *
          FROM trx_invoices
          WHERE invoice_id = ?
          FOR UPDATE
          `,
      [id],
    );

    if (!invRows.length) {
      throw new Error("Invoice not found");
    }

    const invoice = invRows[0];

    if (Number(invoice.receiver_id) !== user_id) {
      throw new Error("Not allowed");
    }

    if (invoice.status !== "pending") {
      throw new Error("Invoice already processed");
    }

    if (formattedStatus === "rejected") {
      await conn.query(
        `
          UPDATE trx_invoices

          SET status = 'rejected'

          WHERE invoice_id = ?
          `,
        [id],
      );

      await conn.commit();

      return res.status(200).json({
        success: true,
        message: "Invoice rejected successfully",
      });
    }

    const [items] = await conn.query(
      `
          SELECT
            batch_id,
            quantity
          FROM trx_invoice_items
          WHERE invoice_id = ?
          `,
      [id],
    );

    if (!items.length) {
      throw new Error("Invoice items not found");
    }

    for (const item of items) {
      const batch_id = Number(item.batch_id);

      const qty = Number(item.quantity);

      if (!batch_id || isNaN(batch_id) || !qty || isNaN(qty) || qty <= 0) {
        throw new Error("Invalid invoice item");
      }

      const [senderStock] = await conn.query(
        `
            SELECT quantity

            FROM trx_stock

            WHERE user_id = ?
              AND batch_id = ?

            FOR UPDATE
            `,
        [invoice.sender_id, batch_id],
      );

      if (!senderStock.length) {
        throw new Error("Sender stock not found");
      }

      const availableQty = Number(senderStock[0].quantity);

      if (availableQty < qty) {
        throw new Error("Insufficient stock");
      }

      await conn.query(
        `
          UPDATE trx_stock

          SET quantity =
            quantity - ?

          WHERE user_id = ?
            AND batch_id = ?
          `,
        [qty, invoice.sender_id, batch_id],
      );

      await conn.query(
        `
          INSERT INTO trx_stock
          (
            user_id,
            batch_id,
            quantity
          )
          VALUES (?, ?, ?)

          ON DUPLICATE KEY UPDATE

          quantity =
            quantity + VALUES(quantity)
          `,
        [invoice.receiver_id, batch_id, qty],
      );

      await conn.query(
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
            'invoice'
          )
          `,
        [invoice.sender_id, batch_id, qty, id],
      );

      await conn.query(
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
            'IN',
            ?,
            'invoice'
          )
          `,
        [invoice.receiver_id, batch_id, qty, id],
      );
    }

    await conn.query(
      `
        UPDATE trx_invoices

        SET status = 'accepted'

        WHERE invoice_id = ?
        `,
      [id],
    );

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: "Invoice accepted successfully",
    });
  } catch (err) {
    await conn.rollback();

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    conn.release();
  }
};
const getMyInvoices = async (req, res) => {
  const user_id = req.user.user_id;

  const [rows] = await db.query(
    `SELECT * FROM trx_invoices
     WHERE sender_id = ?
     ORDER BY invoice_id DESC`,
    [user_id],
  );

  return res.json(rows);
};

const getIncomingInvoices = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const [rows] = await db.query(
      `
      SELECT
          i.invoice_id,
          i.invoice_number,
          i.invoice_date,
          i.total_amount,
          i.status,
          i.created_at,

          u.name AS wholesaler_name,
          w.company_name AS shop_name,
          w.drug_license_no,
          w.phone,
          w.email

      FROM trx_invoices i

      INNER JOIN mas_users u
          ON i.sender_id = u.user_id

      INNER JOIN mas_wholesalers w
          ON u.user_id = w.user_id

      WHERE i.receiver_id = ?

      ORDER BY i.invoice_id DESC
      `,
      [user_id],
    );

    return res.status(200).json(rows);
  } catch (error) {
    console.error("Get Incoming Invoices Error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getInvoiceDetails = async (req, res) => {
  try {
    const invoice_id = Number(req.params.invoice_id);

    if (!invoice_id) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice id",
      });
    }

    const [invoiceRows] = await db.query(
      `
      SELECT
          i.invoice_id,
          i.invoice_number,
          i.invoice_date,
          i.total_amount,
          i.status,
          i.created_at,

          wu.user_id AS wholesaler_user_id,
          wu.name AS wholesaler_name,
          wu.mobile AS wholesaler_mobile,
          wu.email AS wholesaler_user_email,

          w.company_name AS wholesaler_shop_name,
          w.drug_license_no AS wholesaler_dl_no,
          w.gstin AS wholesaler_gstin,
          w.address AS wholesaler_address,
          w.phone AS wholesaler_phone,
          w.email AS wholesaler_email,

          ru.user_id AS retailer_user_id,
          ru.name AS retailer_name,
          ru.mobile AS retailer_mobile,
          ru.email AS retailer_user_email,

          r.shop_name AS retailer_shop_name,
          r.drug_license_no AS retailer_dl_no,
          r.gstin AS retailer_gstin,
          r.address AS retailer_address,
          r.phone AS retailer_phone,
          r.email AS retailer_email

      FROM trx_invoices i

      INNER JOIN mas_users wu
          ON i.sender_id = wu.user_id

      INNER JOIN mas_wholesalers w
          ON wu.user_id = w.user_id

      INNER JOIN mas_users ru
          ON i.receiver_id = ru.user_id

      INNER JOIN mas_retailers r
          ON ru.user_id = r.user_id

      WHERE i.invoice_id = ?
      `,
      [invoice_id],
    );

    if (!invoiceRows.length) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const [items] = await db.query(
      `
      SELECT
          it.item_id,
          it.batch_id,
          it.quantity,
          it.price AS selling_price,
          (it.quantity * it.price) AS total,

          b.batch_no,
          b.manufacture_date,
          b.expiry_date,
          b.mrp,
          b.purchase_price,

          d.drug_id,
          d.drug_name,
          d.composition,
          d.category,
          d.strength,
          d.dosage_form,
          d.is_narcotic,

          m.manufacturer_id,
          m.company_name AS manufacturer_name,
          m.drug_license_no AS manufacturer_dl_no,
          m.phone AS manufacturer_phone,
          m.email AS manufacturer_email

      FROM trx_invoice_items it

      INNER JOIN trx_batches b
          ON it.batch_id = b.batch_id

      INNER JOIN mas_drugs d
          ON b.drug_id = d.drug_id

      INNER JOIN mas_manufacturers m
          ON d.manufacturer_id = m.manufacturer_id

      WHERE it.invoice_id = ?

      ORDER BY d.drug_name ASC
      `,
      [invoice_id],
    );

    return res.status(200).json({
      success: true,

      invoice: invoiceRows[0],

      wholesaler: {
        name: invoiceRows[0].wholesaler_name,
        shop_name: invoiceRows[0].wholesaler_shop_name,
        dl_no: invoiceRows[0].wholesaler_dl_no,
        gstin: invoiceRows[0].wholesaler_gstin,
        phone: invoiceRows[0].wholesaler_phone,
        email: invoiceRows[0].wholesaler_email,
        address: invoiceRows[0].wholesaler_address,
      },

      retailer: {
        name: invoiceRows[0].retailer_name,
        shop_name: invoiceRows[0].retailer_shop_name,
        dl_no: invoiceRows[0].retailer_dl_no,
        gstin: invoiceRows[0].retailer_gstin,
        phone: invoiceRows[0].retailer_phone,
        email: invoiceRows[0].retailer_email,
        address: invoiceRows[0].retailer_address,
      },

      items,

      summary: {
        total_items: items.length,
        total_quantity: items.reduce(
          (sum, item) => sum + Number(item.quantity || 0),
          0,
        ),
        total_amount: Number(invoiceRows[0].total_amount || 0),
      },
    });
  } catch (err) {
    console.error("Get Invoice Details Error:", err);

    return res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

const getInvoicesBySender = async (sender_id) => {
  const id = Number(sender_id);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid sender_id");
  }

  const [rows] = await db.query(
    `SELECT DISTINCT
        u.user_id,
        u.name
     FROM trx_invoices i
     JOIN mas_users u
     ON i.receiver_id = u.user_id
     WHERE i.sender_id = ?
     ORDER BY u.name ASC`,
    [id],
  );

  return rows;
};
const getInvoicesByReceiver = async (receiver_id) => {
  const id = Number(receiver_id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid receiver_id");
  }

  const [rows] = await db.query(
    `SELECT i.*, u.name AS sender_name
     FROM trx_invoices i
     JOIN mas_users u ON i.sender_id = u.user_id
     WHERE i.receiver_id = ?
     ORDER BY i.invoice_id DESC`,
    [id],
  );

  return rows;
};

const getInvoiceById = async (invoice_id) => {
  const id = Number(invoice_id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid invoice_id");
  }

  const [rows] = await db.query(
    `SELECT * FROM trx_invoices WHERE invoice_id = ? LIMIT 1`,
    [id],
  );

  return rows[0] || null;
};

module.exports = {
  createFullInvoice,
  updateInvoiceStatus,
  getMyInvoices,
  getIncomingInvoices,
  getInvoiceDetails,
  getInvoicesBySender,
  getInvoicesByReceiver,
  getInvoiceById,
};
