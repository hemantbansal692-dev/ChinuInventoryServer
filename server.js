const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const db = new sqlite3.Database("chinu_shop.db");

// ✅ Create orders table
db.run(`CREATE TABLE IF NOT EXISTS orders (
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
  items TEXT,
  total REAL,
  createdAt TEXT,
  status TEXT
)`);

// ✅ Create products table
db.run(`CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT,
  quantity INTEGER,
  minStock INTEGER,
  purchasePrice REAL,
  sellingPrice REAL,
  category TEXT,
  requiredQuantity INTEGER
)`);

// ✅ Sync order from Android
app.post("/api/orders", (req, res) => {
  const {
    id,
    clientName,
    clientAddress,
    clientPhone,
    gstNumber,
    transport,
    transportAddress,
    packingCharges,
    otherCharges,
    gstAmount,
    items,
    total,
    createdAt,
    status
  } = req.body;

  db.run(

    
    `INSERT OR REPLACE INTO orders (
      id, clientName, clientAddress, clientPhone, gstNumber,
      transport, transportAddress, packingCharges, otherCharges,
      gstAmount, items, total, createdAt, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      clientName,
      clientAddress,
      clientPhone,
      gstNumber,
      transport,
      transportAddress,
      packingCharges,
      otherCharges,
      gstAmount,
      JSON.stringify(items),
      total,
      createdAt,
      status
    ],
    (err) => {
      if (err) return res.status(500).send("DB error: " + err.message);
      res.send("✅ Order synced");
    }
  );
});

// ✅ Sync product from Android
app.post("/api/products/upload", (req, res) => {
  const products = req.body;
  if (!Array.isArray(products)) return res.status(400).send("Invalid payload");

  const placeholders = products.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const values = products.flatMap(p => [
  p.id,
  p.name,
  p.quantity,
  p.minStock,
  p.purchasePrice,
  p.sellingPrice || 0,
  p.category || "Others",   // ✅ ADD THIS
  p.requiredQuantity || 0,
]);

  db.run(
    `INSERT OR REPLACE INTO products (id, name, quantity, minStock, purchasePrice, sellingPrice, category, requiredQuantity)
     VALUES ${placeholders}`,
    values,
    (err) => {
      if (err) return res.status(500).send("DB error: " + err.message);
      res.send("✅ Bulk products synced");
    }
  );
});


// ✅ Fetch all products
app.get("/api/products", (req, res) => {
  db.all("SELECT * FROM products", [], (err, rows) => {
    if (err) return res.status(500).send("Fetch error");
    res.json(rows);
  });
});

// ✅ Fetch all orders with date fix
app.get("/api/orders", (req, res) => {
  db.all("SELECT * FROM orders", [], (err, rows) => {
    if (err) return res.status(500).send("Fetch error");

    const parsed = rows.map(row => {
      // Convert dd-MM-yyyy to yyyy-MM-dd if needed
      let isoDate = "";

const rawDate = (row.createdAt || "").trim();

if (/^\d{2}-\d{2}-\d{4}$/.test(rawDate)) {
  const [dd, mm, yyyy] = rawDate.split("-");
  isoDate = `${yyyy}-${mm}-${dd}`;
} else {
  isoDate = rawDate; // already correct or empty
}

      return {
  ...row,
  createdAt: isoDate,
  items: (() => {
    try {
      if(!row.items) return[];
      return JSON.parse(row.items);
    } catch (e) {
      console.error("JSON parse error:", e);
      return [];
    }
  })()
  };
    });

    res.json(parsed);
  });
});

// ✅ DELETE order
app.delete("/api/orders/:id", (req, res) => {
  const orderId = req.params.id;

  db.run(
    "DELETE FROM orders WHERE id = ?",
    [orderId],
    function (err) {
      if (err) {
        return res.status(500).send("Delete error: " + err.message);
      }

      if (this.changes === 0) {
        return res.status(404).send("Order not found");
      }

      res.send("✅ Order deleted");
    }
  );
});

app.get("/api/orders/:id", (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM orders WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).send("Fetch error");
    if (!row) return res.status(404).send("Order not found");

    // ✅ Fix date same as list API
    let isoDate = "";
    const rawDate = (row.createdAt || "").trim();

    if (/^\d{2}-\d{2}-\d{4}$/.test(rawDate)) {
      const [dd, mm, yyyy] = rawDate.split("-");
      isoDate = `${yyyy}-${mm}-${dd}`;
    } else {
      isoDate = rawDate;
    }

    // ✅ Parse items safely
    let items = [];
    try {
      items = JSON.parse(row.items || "[]");
    } catch (e) {
      console.error("JSON parse error:", e);
    }

    res.json({
      ...row,
      createdAt: isoDate,
      items
    });
  });
});

app.put("/api/orders/:id", (req, res) => {
  const id = req.params.id;
  const order = req.body;

  db.run(
    `UPDATE orders SET 
      clientName=?, clientPhone=?, clientAddress=?, gstNumber=?, transport=?,
       transportAddress=?, packingCharges=?, otherCharges=?, gstAmount=?, total=?, items=?
     WHERE id=?`,
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
      id
    ],
    function (err) {
      if (err) return res.status(500).send(err.message);
      res.send("✅ Order updated");
    }
  );
});


// ✅ Root test route
app.get("/", (req, res) => {
  res.send("✅ Chinu Sync Server is running locally!");
});

// ✅ Start server
app.listen(8080, () => {
  console.log("📡 Server running at http://<your-pc-ip>:8080");
});
