const db = require("../config/db");

const createUser = async (data) => {
  const { name, email, password, role_id, mobile } = data;

  const roleIdNum = Number(role_id);

  let status = "active";
  if (roleIdNum === 5) {
    status = "active";
  }

  const sql = `
    INSERT INTO mas_users
    (name, email, password, role_id, mobile, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const values = [name, email, password, roleIdNum, mobile, status];

  const [result] = await db.query(sql, values);
  return result;
};

const findUserByEmail = async (email) => {
  const sql = `SELECT * FROM mas_users WHERE email = ? LIMIT 1`;
  const [rows] = await db.query(sql, [email]);
  return rows[0] || null;
};

const approveUser = async (userId) => {
  const sql = `
    UPDATE mas_users
    SET status = 'active'
    WHERE user_id = ? AND status != 'active'
  `;

  const [result] = await db.query(sql, [Number(userId)]);

  if (result.affectedRows === 0) {
    throw new Error("User already active or not found");
  }

  return result;
};

const rejectUser = async (userId) => {
  const sql = `
    UPDATE mas_users
    SET status = 'blocked'
    WHERE user_id = ? AND status != 'blocked'
  `;

  const [result] = await db.query(sql, [Number(userId)]);

  if (result.affectedRows === 0) {
    throw new Error("User already blocked or not found");
  }

  return result;
};

const getAllUsers = async () => {
  const sql = `
    SELECT user_id, name, email, mobile, role_id, status, created_at
    FROM mas_users
    ORDER BY user_id DESC
  `;
  const [rows] = await db.query(sql);
  return rows;
};

module.exports = {
  createUser,
  findUserByEmail,
  approveUser,
  rejectUser,
  getAllUsers,
};
