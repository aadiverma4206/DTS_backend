const db = require("../config/db");

const createMovement = async (data, conn) => {
  if (!conn) throw new Error("DB connection required");

  const user_id = Number(data?.user_id);
  const batch_id = Number(data?.batch_id);
  let change_qty = Number(data?.change_qty);
  const movement_type = data?.movement_type;
  const reference_id =
    data?.reference_id != null ? Number(data.reference_id) : null;
  const reference_type = data?.reference_type;

  if (
    !user_id ||
    !batch_id ||
    !Number.isFinite(change_qty) ||
    change_qty === 0
  ) {
    throw new Error("Invalid movement data");
  }

  if (movement_type !== "IN" && movement_type !== "OUT") {
    throw new Error("Invalid movement type");
  }

  if (
    !["batch", "invoice", "sale", "manual", "transfer"].includes(reference_type)
  ) {
    throw new Error("Invalid reference type");
  }

  if (reference_id !== null && !Number.isFinite(reference_id)) {
    throw new Error("Invalid reference id");
  }

  if (movement_type === "OUT") {
    change_qty = -Math.abs(change_qty);
  }

  if (movement_type === "IN") {
    change_qty = Math.abs(change_qty);
  }

  const [res] = await conn.query(
    `INSERT INTO trx_stock_movement
     (user_id, batch_id, change_qty, movement_type, reference_id, reference_type)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      user_id,
      batch_id,
      change_qty,
      movement_type,
      reference_id,
      reference_type,
    ],
  );

  return res;
};

module.exports = { createMovement };
