const db = require("../config/db");

const validate = (user_id, batch_id, quantity) => {
  const uid = Number(user_id);
  const bid = Number(batch_id);
  const qty = Number(quantity);

  if (!uid || !bid || !Number.isFinite(qty) || qty <= 0) return null;

  return { uid, bid, qty };
};

const increaseStock = async (user_id, batch_id, quantity, conn) => {
  if (!conn) throw new Error("DB connection required");

  const data = validate(user_id, batch_id, quantity);
  if (!data) throw new Error("Invalid stock data");

  const { uid, bid, qty } = data;

  const [res] = await conn.query(
    `INSERT INTO trx_stock (user_id, batch_id, quantity)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
    [uid, bid, qty],
  );

  return res;
};

const decreaseStock = async (user_id, batch_id, quantity, conn) => {
  if (!conn) throw new Error("DB connection required");

  const data = validate(user_id, batch_id, quantity);
  if (!data) throw new Error("Invalid stock data");

  const { uid, bid, qty } = data;

  const [rows] = await conn.query(
    `SELECT quantity FROM trx_stock
     WHERE user_id = ? AND batch_id = ?
     FOR UPDATE`,
    [uid, bid],
  );

  if (!rows.length) {
    throw new Error("Stock not found");
  }

  const currentQty = Number(rows[0].quantity) || 0;

  if (currentQty < qty) {
    throw new Error("Insufficient stock");
  }

  await conn.query(
    `UPDATE trx_stock
     SET quantity = quantity - ?
     WHERE user_id = ? AND batch_id = ?`,
    [qty, uid, bid],
  );

  return true;
};

const findStock = async (user_id, batch_id) => {
  const uid = Number(user_id);
  const bid = Number(batch_id);

  if (!uid || !bid) throw new Error("Invalid stock search");

  const [rows] = await db.query(
    `SELECT stock_id, user_id, batch_id, quantity
     FROM trx_stock
     WHERE user_id = ? AND batch_id = ?
     LIMIT 1`,
    [uid, bid],
  );

  return rows.length ? rows[0] : null;
};

const getMyStock = async (user_id) => {
  const uid = Number(user_id);

  if (!uid) throw new Error("Invalid user");

  const [rows] = await db.query(
    `SELECT s.stock_id,
            s.quantity,
            s.batch_id,
            b.batch_no,
            d.drug_name,
            m.company_name AS manufacturer_name,
            b.mrp,
            b.expiry_date
     FROM trx_stock s
     INNER JOIN trx_batches b ON s.batch_id = b.batch_id
     INNER JOIN mas_drugs d ON b.drug_id = d.drug_id
     INNER JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
     WHERE s.user_id = ?
     ORDER BY s.stock_id DESC`,
    [uid],
  );

  return rows || [];
};

module.exports = {
  increaseStock,
  decreaseStock,
  findStock,
  getMyStock,
};
