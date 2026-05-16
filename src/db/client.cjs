require("dotenv").config();
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing");
}

const pool = new Pool({ connectionString });

module.exports = { pool };
