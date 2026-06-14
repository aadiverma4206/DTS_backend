const db = require("../config/db");
const bcrypt = require("bcrypt");

const approveUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const approvedBy = req.user.user_id;
    const role = req.user.role;

    if (!["admin", "inspector"].includes(role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    await db.query(`UPDATE mas_users SET status = 'active' WHERE user_id = ?`, [
      userId,
    ]);

    return res.status(200).json({
      message: "User approved successfully",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const rejectUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const role = req.user.role;

    if (!["admin", "inspector"].includes(role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    await db.query(
      `UPDATE mas_users SET status = 'blocked' WHERE user_id = ?`,
      [userId],
    );

    return res.status(200).json({
      message: "User rejected successfully",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getProfileInfo = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const role = req.user.role;

    const tableMap = {
      wholesaler: "mas_wholesalers",
      retailer: "mas_retailers",
      inspector: "mas_inspectors",
    };

    const table = tableMap[role];

    if (!table) {
      return res.status(200).json({
        user_id,
        role,
        profile: null,
      });
    }

    const [result] = await db.query(
      `SELECT * FROM ${table} WHERE user_id = ?`,
      [user_id],
    );

    return res.status(200).json({
      user_id,
      role,
      profile: result[0] || null,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const [result] = await db.query(
      `SELECT user_id, name, email, mobile, status, role_id
       FROM mas_users
       ORDER BY user_id DESC`,
    );

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getProfileById = async (req, res) => {
  try {
    const userId = req.params.id;
    const role = req.user.role;

    if (!["admin", "inspector"].includes(role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const roleNameMap = {
      1: "admin",
      3: "wholesaler",
      4: "retailer",
      5: "inspector",
    };

    const tableMap = {
      wholesaler: "mas_wholesalers",
      retailer: "mas_retailers",
      inspector: "mas_inspectors",
    };

    const [user] = await db.query(
      `SELECT role_id FROM mas_users WHERE user_id = ?`,
      [userId],
    );

    if (user.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const roleName = roleNameMap[user[0].role_id];
    const table = tableMap[roleName];

    if (!table) {
      return res.json({ profile: null });
    }

    const [profile] = await db.query(
      `SELECT * FROM ${table} WHERE user_id = ?`,
      [userId],
    );

    return res.json({
      profile: profile[0] || null,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
const createInspector = async (req, res) => {
  let conn;
  try {
    const { name, email, password, mobile } = req.body;
    const role = req.user?.role;

    if (role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    if (!name?.trim() || !email?.trim() || !password || !mobile?.trim()) {
      return res.status(400).json({
        success: false,
        message: "All fields required",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [existingEmail] = await conn.query(
      `SELECT user_id FROM mas_users WHERE email = ?`,
      [email],
    );

    if (existingEmail.length > 0) {
      throw new Error("Email already exists");
    }

    const [existingMobile] = await conn.query(
      `SELECT user_id FROM mas_users WHERE mobile = ?`,
      [mobile],
    );

    if (existingMobile.length > 0) {
      throw new Error("Mobile already exists");
    }

    // 🔥 role_id dynamic (safe)
    const [[roleRow]] = await conn.query(
      `SELECT role_id FROM mas_roles WHERE role_name = 'inspector' LIMIT 1`,
    );

    if (!roleRow) {
      throw new Error("Inspector role not found");
    }

    const role_id = roleRow.role_id;

    const hashedPassword = await bcrypt.hash(password, 10);

    const [userRes] = await conn.query(
      `INSERT INTO mas_users
       (name, email, password, role_id, mobile, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [name.trim(), email.trim(), hashedPassword, role_id, mobile.trim()],
    );

    const user_id = userRes.insertId;

    await conn.query(
      `INSERT INTO mas_inspectors (user_id)
       VALUES (?)`,
      [user_id],
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Inspector created successfully",
      user_id,
    });
  } catch (error) {
    if (conn) await conn.rollback();

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (conn) conn.release();
  }
};
const getWholesalers = async (req, res) => {
  try {
    const [result] = await db.query(
      `SELECT user_id, name
       FROM mas_users
       WHERE role_id = 3 AND status = 'active'
       ORDER BY name ASC`,
    );

    return res.status(200).json(result || []);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getRetailers = async (req, res) => {
  try {
    const [result] = await db.query(
      `
      SELECT
        u.user_id,
        u.name,
        r.shop_name,
        r.drug_license_no AS dl_number
      FROM mas_users u
      INNER JOIN mas_retailers r
        ON u.user_id = r.user_id
      WHERE u.role_id = 4
        AND u.status = 'active'
      ORDER BY u.name ASC
      `,
    );

    return res.status(200).json(result || []);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getUserDetail = async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (!id) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const [userRows] = await db.query(
      `SELECT user_id, name, email, mobile, role_id, status
       FROM mas_users
       WHERE user_id = ?`,
      [id],
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userRows[0];

    let roleData = {};

    if (user.role_id === 3) {
      const [rows] = await db.query(
        `SELECT company_name, gstin, drug_license_no, address
         FROM mas_wholesalers
         WHERE user_id = ?`,
        [id],
      );
      roleData = rows && rows.length > 0 ? rows[0] : {};
    } else if (user.role_id === 4) {
      const [rows] = await db.query(
        `SELECT shop_name, gstin, drug_license_no, address
         FROM mas_retailers
         WHERE user_id = ?`,
        [id],
      );
      roleData = rows && rows.length > 0 ? rows[0] : {};
    } else if (user.role_id === 5) {
      const [rows] = await db.query(
        `SELECT department
         FROM mas_inspectors
         WHERE user_id = ?`,
        [id],
      );
      roleData = rows && rows.length > 0 ? rows[0] : {};
    }

    return res.status(200).json({
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role_id: user.role_id,
      status: user.status,
      roleData: roleData,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
module.exports = {
  approveUser,
  rejectUser,
  getProfileInfo,
  getProfileById,
  getAllUsers,
  createInspector,
  getWholesalers,
  getRetailers,
  getUserDetail,
};
