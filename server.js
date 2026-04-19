const express = require("express");
const app = express();
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const server = require("http").createServer(app);
const io = require("socket.io")(server, {
  cors: { origin: "*" }
});

app.use(cors({
  origin: "*"
}));
app.use(bodyParser.json());

io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("joinShop", (shopId) => {
   if (!shopId) return;
    socket.join(`shop_${shopId}`);
  });
});


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
        shopId Integer Not NULL,
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
        orderDate TEXT,
        updatedAt BIGINT DEFAULT 0,
        status TEXT,
        PRIMARY KEY (id, shopId)
      );
    `);

    //Create Products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        shopId INTEGER NOT NULL,
        name TEXT,
        quantity INTEGER,
        minStock INTEGER,
        purchasePrice REAL,
        sellingPrice REAL,
        category TEXT,
        requiredQuantity INTEGER,
        updatedAt BIGINT DEFAULT 0,
        PRIMARY KEY (id, shopId)
      );
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_shopId ON orders(shopId);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_shopId ON products(shopId);`);

    
    console.log("✅ Tables ready");
  } catch (err) {
    console.error("❌ Table creation error:", err);
  }
})();

const requireShopId = (req, res) => {
  let shopId =
    req.query?.shopId ||
    req.body?.shopId;

  // 🔥 HANDLE ARRAY BODY
  if (!shopId && Array.isArray(req.body) && req.body.length > 0) {
    shopId = req.body[0]?.shopId;
  }

  if (!shopId) {
    console.log("❌ Missing shopId", req.body);
    res.status(400).send("shopId required");
    return null;
  }

  return shopId;
};

// ✅ Sync order from Android
app.post("/api/orders", async (req, res) => {
  try {
    const order = req.body; // ✅ FIRST define

    const shopId = order.shopId;
    if (!shopId) return res.status(400).send("shopId required");

    const updatedAt = Date.now();
    const orderDate = order.orderDate;

    await pool.query(
      `INSERT INTO orders (
        id, shopID, clientName, clientPhone, clientAddress, gstNumber,
        transport, transportAddress, packingCharges, otherCharges,
        gstAmount, items, total, orderDate, updatedAt, status
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
      )
      ON CONFLICT (id, shopId) DO UPDATE SET
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
        orderDate = EXCLUDED.orderDate,
        status = EXCLUDED.status,
        updatedAt = EXCLUDED.updatedAt`,
      [
        order.id,
        shopId,
        order.clientName,
        order.clientPhone,
        order.clientAddress,
        order.gstNumber,
        order.transport,
        order.transportAddress,
        order.packingCharges,
        order.otherCharges,
        order.gstAmount,
        JSON.stringify(order.items),
        order.total,
        orderDate,
        updatedAt,
        order.status
      ]
    );

    // ✅ EMIT AFTER DB SAVE
    io.to(`shop_${order.shopId}`).emit("orderUpdated", {
  id: order.id,
  clientName: order.clientName,
  clientPhone: order.clientPhone,
  clientAddress: order.clientAddress,
  gstNumber: order.gstNumber,
  transport: order.transport,
  transportAddress: order.transportAddress,
  packingCharges: order.packingCharges,
  otherCharges: order.otherCharges,
  gstAmount: order.gstAmount,
  items: order.items,
  total: order.total,
  orderDate: order.orderDate, // ✅ IMPORTANT
  status: order.status,
  updatedAt: updatedAt
});

    res.send("✅ Order synced");

    console.log("🔥 API HIT");
console.log("📦 Incoming:", req.body);

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

    await Promise.all(products.map(p => {
      return pool.query(
        `INSERT INTO products (
          id, shopId, name, quantity, minStock,
          purchasePrice, sellingPrice, category,
          requiredQuantity, updatedAt
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id, shopId) DO UPDATE SET
          name = EXCLUDED.name,
          quantity = EXCLUDED.quantity,
          minStock = EXCLUDED.minStock,
          purchasePrice = EXCLUDED.purchasePrice,
          sellingPrice = EXCLUDED.sellingPrice,
          category = EXCLUDED.category,
          requiredQuantity = EXCLUDED.requiredQuantity,
          updatedAt = EXCLUDED.updatedAt
        WHERE products.updatedAt < EXCLUDED.updatedAt`,
        [
          p.id,
          p.shopId,
          p.name,
          p.quantity,
          p.minStock,
          p.purchasePrice,
          p.sellingPrice || 0,
          p.category || "Others",
          p.requiredQuantity || 0,
          p.updatedAt || Date.now()
        ]
      );
    }));

    const shopId = products[0]?.shopId;
    if (shopId) {
      io.to(`shop_${shopId}`).emit("productUpdated", products);
    }

    res.send("✅ Products synced");
  } catch (err) {
    console.error(err);
    res.status(500).send("DB error");
  }
});


// ✅ Fetch all products
app.get("/api/products", async (req, res) => {
  const shopId = requireShopId(req, res);
  if (!shopId) return;

  try {
    const result = await pool.query(
      `SELECT * FROM products WHERE shopId = $1`,
      [shopId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Fetch error");
  }
});

// ✅ Fetch all orders
app.get("/api/orders", async (req, res) => {
  const shopId = requireShopId(req, res);
  if (!shopId) return;

  try {
     const result = await pool.query(
      `SELECT * FROM orders WHERE shopId = $1 ORDER BY updatedAt DESC`,
      [shopId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err); // 👈 ADD THIS
    res.status(500).send("Fetch error");
  }
});

// ✅ DELETE order
app.delete("/api/orders/:id", async (req, res) => {

  const shopId = requireShopId(req, res);
  if (!shopId) return;

  try {
    const result = await pool.query(
      "DELETE FROM orders WHERE id = $1 AND shopId = $2",
      [req.params.id, shopId]
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
    const result = await pool.query(`
      SELECT 
        id,
        clientname AS "clientName",
        clientphone AS "clientPhone",
        clientaddress AS "clientAddress",
        gstnumber AS "gstNumber",
        transport,
        transportaddress AS "transportAddress",
        packingcharges AS "packingCharges",
        othercharges AS "otherCharges",
        gstamount AS "gstAmount",
        items,
        total,
        orderdate AS "orderDate",
        updatedat AS "updatedAt",
        status
      FROM orders
      WHERE id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).send("Order not found");
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Fetch error");
  }
});

// ✅ Update order
app.put("/api/orders/:id", async (req, res) => {
  try {
   const order = req.body;
   const updated = Date.now();

    await pool.query(
      `UPDATE orders SET 
        clientName=$1, clientPhone=$2, clientAddress=$3, gstNumber=$4,
        transport=$5, transportAddress=$6, packingCharges=$7,
        otherCharges=$8, gstAmount=$9, total=$10, items=$11, updatedAt=$12
       WHERE id=$13`,
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
        JSON.stringify(order.items),
        updatedAt,
        req.params.id
      ]
    );

    io.to(`shop_${order.shopId}`).emit("orderUpdated", {
      ...order,
      id: req.params.id,
      updatedAt
    });

    res.send("✅ Order updated");
  } catch (err) {
     console.error(err);
    res.status(500).send("Update error");
  }
});


// ✅ Root test route
app.get("/", (req, res) => {
  res.send("✅ Chinu Sync Server is LIVE 🚀");
});


// ✅ Start server (Railway compatible)
const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("📡 Server running on port", PORT);
});