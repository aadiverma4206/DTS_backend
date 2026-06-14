const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const register = async (req, res) => {
  try {
    const name = req.body.name?.trim();
    const email = req.body.email?.trim();
    const password = req.body.password?.trim();
    const mobile = req.body.mobile?.trim();

    const roleIdNum = Number(req.body.role_id);

    if (!name || !email || !password || !roleIdNum || !mobile) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (email !== email.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: "Email must be in lowercase only",
      });
    }

    const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    const mobileRegex = /^[6-9]\d{9}$/;

    if (!mobileRegex.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Invalid mobile number",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    if (name.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Name must be at least 3 characters",
      });
    }

    const nameRegex = /^[a-zA-Z\s]+$/;

    if (!nameRegex.test(name)) {
      return res.status(400).json({
        success: false,
        message: "Name should contain only letters",
      });
    }

    if (roleIdNum === 1 || roleIdNum === 5) {
      return res.status(403).json({
        success: false,
        message: "Not allowed to register this role",
      });
    }

    const allowedRoles = [2, 3, 4];

    if (!allowedRoles.includes(roleIdNum)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role selected",
      });
    }

    const [existingEmail] = await db.query(
      `
        SELECT user_id
        FROM mas_users
        WHERE email = ?
        LIMIT 1
        `,
      [email],
    );

    if (existingEmail.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
      });
    }

    const [existingMobile] = await db.query(
      `
        SELECT user_id
        FROM mas_users
        WHERE mobile = ?
        LIMIT 1
        `,
      [mobile],
    );

    if (existingMobile.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Mobile number already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `
      INSERT INTO mas_users
      (
        name,
        email,
        password,
        role_id,
        mobile,
        status
      )
      VALUES
      (
        ?,
        ?,
        ?,
        ?,
        ?,
        'active'
      )
      `,
      [name, email, hashedPassword, roleIdNum, mobile],
    );

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user_id: result.insertId,
    });
  } catch (error) {
    console.error("Register Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
const login = async (req, res) => {
  try {
    const email = req.body.email?.trim();
    const password = req.body.password?.trim();

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    if (email !== email.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: "Email must be in lowercase only",
      });
    }

    const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    } // validation :special character..

    const [result] = await db.query(
      `
      SELECT
        user_id,
        name,
        email,
        mobile,
        password,
        role_id,
        status
      FROM mas_users
      WHERE email = ?
      LIMIT 1
      `,
      [email],
    );

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result[0];

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "User account is not active",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "JWT secret not configured",
      });
    }

    const role = getRoleName(user.role_id);

    if (!role) {
      return res.status(500).json({
        success: false,
        message: "Invalid user role",
      });
    }

    let profile_completed = true;

    if (role === "wholesaler") {
      const [wholesaler] = await db.query(
        `
        SELECT wholesaler_id
        FROM mas_wholesalers
        WHERE user_id = ?
        LIMIT 1
        `,
        [user.user_id],
      );

      profile_completed = wholesaler.length > 0;
    }

    if (role === "retailer") {
      const [retailer] = await db.query(
        `
        SELECT retailer_id
        FROM mas_retailers
        WHERE user_id = ?
        LIMIT 1
        `,
        [user.user_id],
      );

      profile_completed = retailer.length > 0;
    }

    await db.query(
      `
      UPDATE mas_users
      SET last_login = CURRENT_TIMESTAMP
      WHERE user_id = ?
      `,
      [user.user_id],
    );

    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      },
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      profile_completed,
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        role: role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
function getRoleName(role_id) {
  switch (Number(role_id)) {
    case 1:
      return "admin";
    case 3:
      return "wholesaler";
    case 4:
      return "retailer";
    case 5:
      return "inspector";
    default:
      return "user";
  }
}

const forgetPassword = async (req, res) => {
  try {
    const email = req.body.email?.trim();
    const mobile = req.body.mobile?.trim();
    const password = req.body.password?.trim();
    const confirmPassword = req.body.confirm_password?.trim();

    if (!email || !mobile || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (email !== email.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: "Email must be in lowercase only",
      });
    }

    const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    const mobileRegex = /^[6-9]\d{9}$/;
    if (!mobileRegex.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Invalid mobile number",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    const [result] = await db.query(
      `
       SELECT user_id, email, mobile, status
       FROM mas_users
       WHERE email = ? AND mobile = ?
       LIMIT 1
       `,
      [email, mobile],
    );

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email and mobile combination",
      });
    }

    const user = result[0];

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "User account is not active",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      `
       UPDATE mas_users
       SET password = ?
       WHERE user_id = ?
       `,
      [hashedPassword, user.user_id],
    );

    return res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("ForgetPassword Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = { register, login, forgetPassword };
