const db = require("../config/db");

const createManufacturer = async (req, res) => {
  try {
    const created_by = req.user?.user_id;
    const role = req.user?.role;

    if (!created_by) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (role !== "wholesaler") {
      return res.status(403).json({
        success: false,
        message: "Only wholesaler can add manufacturer",
      });
    }

    let {
      company_name,
      gstin,
      drug_license_no,
      pan_no,
      cin_no,
      address,
      phone,
      email,
      website,
      product_info,
    } = req.body;

    company_name = company_name?.trim();
    gstin = gstin?.trim();
    drug_license_no = drug_license_no?.trim();
    address = address?.trim();

    if (!company_name || !gstin || !drug_license_no || !address) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing",
      });
    }

    const [duplicate] = await db.query(
      `SELECT manufacturer_id FROM mas_manufacturers WHERE gstin = ? LIMIT 1`,
      [gstin],
    );

    if (duplicate.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Manufacturer already exists",
      });
    }

    const [result] = await db.query(
      `INSERT INTO mas_manufacturers
      (company_name, gstin, drug_license_no, pan_no, cin_no, address, created_by, phone, email, website, product_info)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_name,
        gstin,
        drug_license_no,
        pan_no ? pan_no.trim() : null,
        cin_no ? cin_no.trim() : null,
        address,
        created_by,
        phone || null,
        email || null,
        website || null,
        product_info || null,
      ],
    );

    return res.status(201).json({
      success: true,
      message: "Manufacturer created successfully",
      manufacturer_id: result.insertId,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "GSTIN already registered",
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

const getManufacturers = async (req, res) => {
  try {
    const created_by = req.user?.user_id;

    if (!created_by) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const [rows] = await db.query(
      `SELECT
        manufacturer_id,
        company_name,
        gstin,
        drug_license_no,
        pan_no,
        cin_no,
        address,
        phone,
        email,
        website,
        product_info,
        created_at
       FROM mas_manufacturers
       WHERE created_by = ?
       ORDER BY manufacturer_id DESC`,
      [created_by],
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

module.exports = {
  createManufacturer,
  getManufacturers,
};
