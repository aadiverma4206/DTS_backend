require("dotenv").config();

const express = require("express");
const cors = require("cors");

const db = require("./config/db");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.status(200).send("API is running...");
});

app.get("/test-db", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.status(200).send("DB Connected ✅");
  } catch (err) {
    res.status(500).send("DB Error ❌");
  }
});

module.exports = app;
