const db = require("../config/db");

const getInvoicesBySender = async (sender_id) => {
  const id = Number(sender_id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid sender_id");
  }

  const [rows] = await db.query(
    `SELECT i.invoice_id,
            i.invoice_number,
            i.invoice_date,
            i.total_amount,
            i.status,
            i.receiver_id,
            u.name AS receiver_name
     FROM trx_invoices i
     JOIN mas_users u ON i.receiver_id = u.user_id
     WHERE i.sender_id = ?
     ORDER BY i.invoice_id DESC`,
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
    `SELECT i.invoice_id,
            i.invoice_number,
            i.invoice_date,
            i.total_amount,
            i.status,
            i.sender_id,
            u.name AS sender_name
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
    `SELECT i.invoice_id,
            i.invoice_number,
            i.invoice_date,
            i.total_amount,
            i.status,
            i.sender_id,
            s.name AS sender_name,
            i.receiver_id,
            r.name AS receiver_name
     FROM trx_invoices i
     JOIN mas_users s ON i.sender_id = s.user_id
     JOIN mas_users r ON i.receiver_id = r.user_id
     WHERE i.invoice_id = ?
     LIMIT 1`,
    [id],
  );

  return rows[0] || null;
};

module.exports = {
  getInvoicesBySender,
  getInvoicesByReceiver,
  getInvoiceById,
};
