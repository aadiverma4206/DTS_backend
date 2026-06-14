const db = require("../config/db");

const createManufacturer = async (data) => {
  let {
    company_name,
    gstin,
    drug_license_no,
    pan_no,
    cin_no,
    address,
    created_by,
    phone,
    email,
    website,
    product_info,
  } = data;

  company_name = company_name?.trim();
  gstin = gstin?.trim();
  drug_license_no = drug_license_no?.trim();
  address = address?.trim();
  created_by = Number(created_by);

  if (!company_name || !gstin || !drug_license_no || !address || !created_by) {
    throw new Error("Required fields missing");
  }

  const [duplicate] = await db.query(
    `SELECT manufacturer_id FROM mas_manufacturers WHERE gstin = ? LIMIT 1`,
    [gstin],
  );

  if (duplicate.length > 0) {
    throw new Error("Manufacturer already exists");
  }

  const sql = `
    INSERT INTO mas_manufacturers
    (company_name, gstin, drug_license_no, pan_no, cin_no, address, created_by, phone, email, website, product_info)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
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
  ];

  try {
    const [result] = await db.query(sql, values);
    return result;
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw new Error("GSTIN already registered");
    }
    throw error;
  }
};

const getManufacturersByWholesaler = async (created_by) => {
  created_by = Number(created_by);

  if (!created_by) {
    throw new Error("Invalid user");
  }

  const sql = `
    SELECT
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
    ORDER BY manufacturer_id DESC
  `;

  const [rows] = await db.query(sql, [created_by]);
  return rows;
};

module.exports = {
  createManufacturer,
  getManufacturersByWholesaler,
};
