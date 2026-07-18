require("dotenv").config();

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,

  connectTimeout: 60000,

  ssl: {
    rejectUnauthorized: false,
  },
});

(async () => {
  try {
    const conn = await pool.getConnection();
    console.log("✅ MySQL Connected");
    conn.release();
  } catch (err) {
    console.error(err);
  }
})();

module.exports = pool;