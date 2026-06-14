const db = require("../config/db");
const addDrug = async (req, res) => {
  try {
    const created_by = Number(req.user.user_id);
    const role = req.user.role;

    if (role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admin can add drug",
      });
    }

    let {
      drug_name,
      composition,
      category,
      dosage_form,
      strength,
      is_narcotic,
      item_brand_id,
      schedule_type,
      abuse_risk,
    } = req.body;

    drug_name = drug_name?.trim();
    dosage_form = dosage_form?.trim();
    strength = strength?.trim();
    composition = composition?.trim() || "";
    category = category?.trim() || "";
    item_brand_id = item_brand_id?.trim();
    schedule_type = schedule_type?.trim() || null;
    is_narcotic = Number(is_narcotic) === 1 ? 1 : 0;
    abuse_risk = Number(abuse_risk) === 1 ? 1 : 0;

    if (!drug_name || !dosage_form || !strength || !item_brand_id) {
      return res.status(400).json({
        success: false,
        message:
          "Drug name, dosage form, strength and item brand id are required",
      });
    }

    const [existingBrand] = await db.query(
      `SELECT drug_id FROM mas_drugs_master
       WHERE item_brand_id = ?
       LIMIT 1`,
      [item_brand_id],
    );

    if (existingBrand.length) {
      return res.status(400).json({
        success: false,
        message: "Drug with this item brand id already exists",
      });
    }

    const [existingDrug] = await db.query(
      `SELECT drug_id FROM mas_drugs_master
       WHERE drug_name = ? AND strength = ? AND dosage_form = ?
       LIMIT 1`,
      [drug_name, strength, dosage_form],
    );

    if (existingDrug.length) {
      return res.status(400).json({
        success: false,
        message: "Drug with same name, strength and dosage form already exists",
      });
    }

    const [result] = await db.query(
      `INSERT INTO mas_drugs_master
       (drug_name, composition, category, is_narcotic, dosage_form, strength,
        status, created_by, item_brand_id, schedule_type, abuse_risk)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        drug_name,
        composition,
        category,
        is_narcotic,
        dosage_form,
        strength,
        created_by,
        item_brand_id,
        schedule_type,
        abuse_risk,
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Drug added successfully",
      drug_id: result.insertId,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getDrugs = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, m.company_name AS manufacturer_name
       FROM mas_drugs d
       JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
       ORDER BY d.drug_id DESC`,
    );
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getMyDrugs = async (req, res) => {
  try {
    const created_by = Number(req.user.user_id);
    const [rows] = await db.query(
      `SELECT d.*, m.company_name AS manufacturer_name
       FROM mas_drugs d
       JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
       WHERE m.created_by = ?
       ORDER BY d.drug_id DESC`,
      [created_by],
    );
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getDrugsByWholesaler = async (req, res) => {
  try {
    const created_by = Number(req.user.user_id);
    const [rows] = await db.query(
      `SELECT d.*, m.company_name AS manufacturer_name
       FROM mas_drugs d
       JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
       WHERE m.created_by = ?
       ORDER BY d.drug_id DESC`,
      [created_by],
    );
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getDrugsByManufacturer = async (req, res) => {
  try {
    const manufacturer_id = Number(req.params.id);
    const created_by = Number(req.user.user_id);

    if (!manufacturer_id) {
      return res.status(400).json({
        success: false,
        message: "Invalid manufacturer id",
      });
    }

    const [manufacturerCheck] = await db.query(
      `SELECT manufacturer_id FROM mas_manufacturers
       WHERE manufacturer_id = ? AND created_by = ? LIMIT 1`,
      [manufacturer_id, created_by],
    );

    if (!manufacturerCheck.length) {
      return res.status(403).json({
        success: false,
        message: "Invalid manufacturer",
      });
    }

    // Hamesha mas_drugs_master se hi data do
    // master_drug_id = drug_id of mas_drugs_master
    // createBatch backend isko use karke mas_drugs me dhundhega ya insert karega
    const [rows] = await db.query(
      `SELECT
        mdm.drug_id        AS drug_id,
        mdm.drug_id        AS master_drug_id,
        mdm.drug_name,
        mdm.composition,
        mdm.category,
        mdm.is_narcotic,
        mdm.dosage_form,
        mdm.strength,
        mdm.status
       FROM mas_drugs_master mdm
       WHERE mdm.status = 'active'
       ORDER BY mdm.drug_name ASC`,
    );

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  addDrug,
  getDrugs,
  getMyDrugs,
  getDrugsByWholesaler,
  getDrugsByManufacturer,
};
