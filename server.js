const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

const app = express();
app.use(cors({
  origin: "*"
}));
app.use(bodyParser.json());

// PostgreSQL connection
const pool =new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Create Tables
(async () => {
  try {
    //create Orders Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        clientName TEXT,
        clientPhone TEXT,
        clientAddress TEXT,
        gstNumber TEXT,
        transport TEXT,
        transportAddress TEXT,
        packingCharges REAL,
        otherCharges REAL,
        gstAmount REAL,
        items JSONB,
        total REAL,
        createdAt TEXT,
        status TEXT
      );
    `);

    //Create Products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT,
        quantity INTEGER,
        minStock INTEGER,
        purchasePrice REAL,
        sellingPrice REAL,
        category TEXT,
        requiredQuantity INTEGER
      );
    `);

    console.log("✅ Tables ready");
  } catch (err) {
    console.error("❌ Table creation error:", err);
  }
})();

// ✅ Sync order from Android
app.post("/api/orders", async (req, res) => {
  try {
    const order = req.body;

    await pool.query(
      `INSERT INTO orders (
        id, clientName, clientPhone, clientAddress, gstNumber,
        transport, transportAddress, packingCharges, otherCharges,
        gstAmount, items, total, createdAt, status
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      )
      ON CONFLICT (id) DO UPDATE SET
        clientName = EXCLUDED.clientName,
        clientPhone = EXCLUDED.clientPhone,
        clientAddress = EXCLUDED.clientAddress,
        gstNumber = EXCLUDED.gstNumber,
        transport = EXCLUDED.transport,
        transportAddress = EXCLUDED.transportAddress,
        packingCharges = EXCLUDED.packingCharges,
        otherCharges = EXCLUDED.otherCharges,
        gstAmount = EXCLUDED.gstAmount,
        items = EXCLUDED.items,
        total = EXCLUDED.total,
        status = EXCLUDED.status`,
      [
        order.id,
        order.clientName,
        order.clientPhone,
        order.clientAddress,
        order.gstNumber,
        order.transport,
        order.transportAddress,
        order.packingCharges,
        order.otherCharges,
        order.gstAmount,
        order.items, // JSON directly
        order.total,
        order.createdAt,
        order.status
      ]
    );

    res.send("✅ Order synced");
  } catch (err) {
    console.error(err);
    res.status(500).send("DB error");
  }
});


// ✅ Sync product from Android (bulk)
app.post("/api/products/upload", async (req, res) => {
  try {
    const products = req.body;
    if (!Array.isArray(products)) {
      return res.status(400).send("Invalid payload");
    }

    for (const p of products) {
      await pool.query(
        `INSERT INTO products (
          id, name, quantity, minStock,
          purchasePrice, sellingPrice, category, requiredQuantity
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          quantity = EXCLUDED.quantity,
          minStock = EXCLUDED.minStock,
          purchasePrice = EXCLUDED.purchasePrice,
          sellingPrice = EXCLUDED.sellingPrice,
          category = EXCLUDED.category,
          requiredQuantity = EXCLUDED.requiredQuantity`,
        [
          p.id,
          p.name,
          p.quantity,
          p.minStock,
          p.purchasePrice,
          p.sellingPrice || 0,
          p.category || "Others",
          p.requiredQuantity || 0
        ]
      );
    }

    res.send("✅ Bulk products synced");
  } catch (err) {
    console.error(err);
    res.status(500).send("DB error");
  }
});


// ✅ Fetch all products
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products");
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Fetch error");
  }
});

// ✅ Fetch all orders
app.get("/api/orders", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders ORDER BY createdAt DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Fetch error");
  }
});

// ✅ DELETE order
app.delete("/api/orders/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM orders WHERE id = $1",
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).send("Order not found");
    }

    res.send("✅ Order deleted");
  } catch (err) {
    res.status(500).send("Delete error");
  }
});

// ✅ Get single order
app.get("/api/orders/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Order not found");
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Fetch error");
  }
});

// ✅ Update order
app.put("/api/orders/:id", async (req, res) => {
  try {
    const order = req.body;

    await pool.query(
      `UPDATE orders SET 
        clientName=$1, clientPhone=$2, clientAddress=$3, gstNumber=$4,
        transport=$5, transportAddress=$6, packingCharges=$7,
        otherCharges=$8, gstAmount=$9, total=$10, items=$11
       WHERE id=$12`,
      [
        order.clientName,
        order.clientPhone,
        order.clientAddress,
        order.gstNumber,
        order.transport,
        order.transportAddress,
        order.packingCharges,
        order.otherCharges,
        order.gstAmount,
        order.total,
        order.items,
        req.params.id
      ]
    );

    res.send("✅ Order updated");
  } catch (err) {
    res.status(500).send("Update error");
  }
});


// ✅ Root test route
app.get("/", (req, res) => {
  res.send("✅ Chinu Sync Server is LIVE 🚀");
});


// ✅ Start server (Railway compatible)
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("📡 Server running on port", PORT);
});