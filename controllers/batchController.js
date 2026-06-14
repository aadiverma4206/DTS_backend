const db = require("../config/db");
const batchModel = require("../models/batchModel");

const createBatch = async (req, res) => {
  let conn;

  try {
    const created_by = Number(req.user.user_id);
    const role = req.user.role;

    if (role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Only wholesaler can create batch",
      });
    }

    let {
      batch_no,
      manufacturer_id,
      drug_id,
      manufacture_date,
      expiry_date,
      stock_receive_date,
      mrp,
      purchase_price,
      quantity,
    } = req.body;

    batch_no = batch_no?.trim();

    manufacturer_id = Number(manufacturer_id);
    drug_id = Number(drug_id);
    mrp = Number(mrp);
    purchase_price = Number(purchase_price);
    quantity = Number(quantity);

    if (
      !batch_no ||
      !manufacturer_id ||
      !drug_id ||
      !manufacture_date ||
      !expiry_date ||
      !stock_receive_date ||
      isNaN(mrp) ||
      isNaN(purchase_price) ||
      isNaN(quantity) ||
      quantity <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields including stock receive date are required",
      });
    }

    if (new Date(expiry_date) <= new Date(manufacture_date)) {
      return res.status(400).json({
        success: false,
        message: "Expiry date must be after manufacture date",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [masterDrug] = await conn.query(
      `SELECT drug_name, composition, category, is_narcotic, dosage_form, strength
       FROM mas_drugs_master
       WHERE drug_id = ?
       LIMIT 1`,
      [drug_id],
    );

    if (!masterDrug.length) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid drug selected",
      });
    }

    let finalDrugId;

    const [existingDrug] = await conn.query(
      `SELECT drug_id
       FROM mas_drugs
       WHERE manufacturer_id = ?
         AND master_drug_id = ?
       LIMIT 1`,
      [manufacturer_id, drug_id],
    );

    if (existingDrug.length) {
      finalDrugId = existingDrug[0].drug_id;
    } else {
      const [insertDrug] = await conn.query(
        `INSERT INTO mas_drugs
         (manufacturer_id, master_drug_id, drug_name, composition, category, is_narcotic, dosage_form, strength)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          manufacturer_id,
          drug_id,
          masterDrug[0].drug_name,
          masterDrug[0].composition,
          masterDrug[0].category,
          masterDrug[0].is_narcotic,
          masterDrug[0].dosage_form,
          masterDrug[0].strength,
        ],
      );
      finalDrugId = insertDrug.insertId;
    }

    const duplicate = await batchModel.checkDuplicateBatch(
      finalDrugId,
      batch_no,
    );

    if (duplicate) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "Stock already exists",
      });
    }

    const result = await batchModel.createBatch(
      {
        batch_no,
        drug_id: finalDrugId,
        manufacture_date,
        expiry_date,
        stock_receive_date,
        mrp,
        purchase_price,
        created_by,
      },
      conn,
    );

    await conn.query(
      `INSERT INTO trx_stock_movement
       (user_id, batch_id, change_qty, movement_type, reference_id, reference_type)
       VALUES (?, ?, ?, 'IN', ?, 'batch')`,
      [created_by, result.insertId, quantity, result.insertId],
    );

    await conn.query(
      `INSERT INTO trx_stock (user_id, batch_id, quantity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
      [created_by, result.insertId, quantity],
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Stock Receive successfully",
      batch_id: result.insertId,
      drug_id: finalDrugId,
    });
  } catch (error) {
    if (conn) {
      await conn.rollback();
    }
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
};

const getBatches = async (req, res) => {
  try {
    const rows = await batchModel.getAllBatches();
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getMyBatches = async (req, res) => {
  try {
    const created_by = Number(req.user.user_id);
    const rows = await batchModel.getBatchesByWholesaler(created_by);
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createBatch,
  getBatches,
  getMyBatches,
};
