const db = require("../config/db");

const getInspections = async (user) => {
  const user_id = user?.user_id;
  const role = user?.role;

  if (!user_id) {
    throw new Error("Invalid user");
  }

  let query = `
    SELECT
      i.inspection_id,
      i.inspection_type,
      i.inspection_date,
      i.status,
      i.total_system_qty,
      i.total_physical_qty,
      u1.name AS inspector_name,
      u2.name AS target_name
    FROM trx_inspections i
    JOIN mas_users u1 ON i.inspector_id = u1.user_id
    JOIN mas_users u2 ON i.target_user_id = u2.user_id
  `;

  const params = [];

  if (role === "inspector") {
    query += ` WHERE i.inspector_id = ?`;
    params.push(user_id);
  }

  query += ` ORDER BY i.inspection_id DESC`;

  const [rows] = await db.query(query, params);

  return Array.isArray(rows) ? rows : [];
};

const getInspectionById = async (inspection_id, user) => {
  const id = Number(inspection_id);
  const user_id = user?.user_id;
  const role = user?.role;

  if (!id || id <= 0) {
    throw new Error("Invalid inspection id");
  }

  const [[inspection]] = await db.query(
    `SELECT
      i.inspection_id,
      i.inspector_id,
      i.inspection_type,
      i.inspection_date,
      i.status,
      i.remarks,
      i.completed_at,
      i.total_system_qty,
      i.total_physical_qty,
      u1.name AS inspector_name,
      u2.name AS target_name
     FROM trx_inspections i
     JOIN mas_users u1 ON i.inspector_id = u1.user_id
     JOIN mas_users u2 ON i.target_user_id = u2.user_id
     WHERE i.inspection_id = ?
     LIMIT 1`,
    [id],
  );

  if (!inspection) {
    throw new Error("Inspection not found");
  }

  if (role === "inspector" && inspection.inspector_id !== user_id) {
    throw new Error("Access denied");
  }

  const [items] = await db.query(
    `SELECT
      it.batch_id,
      it.system_qty,
      it.physical_qty,
      it.difference_qty,
      it.status,
      b.batch_no,
      b.expiry_date,
      d.drug_name
     FROM trx_inspection_items it
     JOIN trx_batches b ON it.batch_id = b.batch_id
     JOIN mas_drugs d ON it.drug_id = d.drug_id
     WHERE it.inspection_id = ?
     ORDER BY d.drug_name`,
    [id],
  );

  const [checks] = await db.query(
    `SELECT
      check_name,
      check_value,
      remarks
     FROM trx_inspection_checks
     WHERE inspection_id = ?`,
    [id],
  );

  return {
    inspection,
    items: Array.isArray(items) ? items : [],
    checks: Array.isArray(checks) ? checks : [],
  };
};

module.exports = {
  getInspections,
  getInspectionById,
};
