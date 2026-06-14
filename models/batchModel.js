const db = require("../config/db");

const createBatch = async (data, conn = null) => {
  const connection = conn || db;

  let {
    batch_no,
    drug_id,
    manufacture_date,
    expiry_date,
    mrp,
    purchase_price,
    created_by,
  } = data;

  batch_no = batch_no?.trim();
  drug_id = Number(drug_id);
  mrp = Number(mrp);
  purchase_price = Number(purchase_price);
  created_by = Number(created_by);

  if (
    !batch_no ||
    !drug_id ||
    !manufacture_date ||
    !expiry_date ||
    isNaN(mrp) ||
    isNaN(purchase_price) ||
    !created_by
  ) {
    throw new Error("Invalid batch data");
  }

  const sql = `
    INSERT INTO trx_batches
    (batch_no, drug_id, manufacture_date, expiry_date, mrp, purchase_price, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    batch_no,
    drug_id,
    manufacture_date,
    expiry_date,
    mrp,
    purchase_price,
    created_by,
  ];

  const [result] = await connection.query(sql, values);
  return result;
};

const checkDuplicateBatch = async (drug_id, batch_no) => {
  const sql = `
    SELECT batch_id FROM trx_batches
    WHERE drug_id = ? AND batch_no = ?
    LIMIT 1
  `;
  const [rows] = await db.query(sql, [Number(drug_id), batch_no?.trim()]);
  return rows.length > 0;
};

const getAllBatches = async () => {
  const sql = `
    SELECT
      b.batch_id,
      b.batch_no,
      b.manufacture_date,
      b.expiry_date,
      b.mrp,
      b.purchase_price,
      b.status,
      b.created_at,
      b.created_by,
      d.drug_name,
      m.company_name AS manufacturer_name
    FROM trx_batches b
    JOIN mas_drugs d ON b.drug_id = d.drug_id
    JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
    ORDER BY b.batch_id DESC
  `;
  const [rows] = await db.query(sql);
  return rows;
};

const getBatchesByWholesaler = async (created_by) => {
  created_by = Number(created_by);

  if (!created_by) {
    throw new Error("Invalid user");
  }

  const sql = `
    SELECT
      b.batch_id,
      b.batch_no,
      b.manufacture_date,
      b.expiry_date,
      b.mrp,
      b.purchase_price,
      b.status,
      b.created_at,
      b.created_by,
      d.drug_name,
      m.company_name AS manufacturer_name
    FROM trx_batches b
    JOIN mas_drugs d ON b.drug_id = d.drug_id
    JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
    WHERE b.created_by = ?
    ORDER BY b.batch_id DESC
  `;
  const [rows] = await db.query(sql, [created_by]);
  return rows;
};

module.exports = {
  createBatch,
  checkDuplicateBatch,
  getAllBatches,
  getBatchesByWholesaler,
};
