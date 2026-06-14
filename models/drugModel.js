const db = require("../config/db");

const getAllDrugs = async () => {
  const sql = `
    SELECT
      d.drug_id,
      d.manufacturer_id,
      d.drug_name,
      COALESCE(d.composition, '') AS composition,
      COALESCE(d.category, '') AS category,
      d.dosage_form,
      d.strength,
      d.is_narcotic,
      d.created_at,
      m.company_name AS manufacturer_name
    FROM mas_drugs d
    JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
    ORDER BY d.drug_id DESC
  `;
  const [rows] = await db.query(sql);
  return rows;
};

const getMyDrugs = async (created_by) => {
  const sql = `
    SELECT
      d.drug_id,
      d.manufacturer_id,
      d.drug_name,
      COALESCE(d.composition, '') AS composition,
      COALESCE(d.category, '') AS category,
      d.dosage_form,
      d.strength,
      d.is_narcotic,
      d.created_at,
      m.company_name AS manufacturer_name
    FROM mas_drugs d
    JOIN mas_manufacturers m ON d.manufacturer_id = m.manufacturer_id
    WHERE m.created_by = ?
    ORDER BY d.drug_id DESC
  `;
  const [rows] = await db.query(sql, [Number(created_by)]);
  return rows;
};

module.exports = {
  getAllDrugs,
  getMyDrugs,
};
