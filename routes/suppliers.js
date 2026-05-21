const express = require("express");
const router = express.Router();
const db = require("../database/db");

const APP_NAME = process.env.APP_NAME || "SVG Accounts";

router.get("/", (req, res) => {
  const suppliers = db.prepare(`
    SELECT *
    FROM suppliers
    ORDER BY created_at DESC
  `).all();

  res.render("suppliers/index", {
    title: `Suppliers | ${APP_NAME}`,
    appName: APP_NAME,
    suppliers
  });
});

router.get("/new", (req, res) => {
  res.render("suppliers/new", {
    title: `New Supplier | ${APP_NAME}`,
    appName: APP_NAME
  });
});

router.post("/new", (req, res) => {
  const { name, email, phone, address } = req.body;

  db.prepare(`
    INSERT INTO suppliers (name, email, phone, address)
    VALUES (?, ?, ?, ?)
  `).run(name, email, phone, address);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "supplier_created",
    `Supplier created: ${name}`
  );

  res.redirect("/suppliers");
});

router.get("/:id/edit", (req, res) => {
  const supplier = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(req.params.id);

  if (!supplier) {
    return res.status(404).send("Supplier not found");
  }

  res.render("suppliers/edit", {
    title: `Edit Supplier | ${APP_NAME}`,
    appName: APP_NAME,
    supplier
  });
});

router.post("/:id/edit", (req, res) => {
  const { name, email, phone, address } = req.body;

  db.prepare(`
    UPDATE suppliers
    SET name = ?,
        email = ?,
        phone = ?,
        address = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, email, phone, address, req.params.id);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "supplier_updated",
    `Supplier updated: ${name}`
  );

  res.redirect("/suppliers");
});

router.post("/:id/delete", (req, res) => {
  const supplier = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(req.params.id);

  if (!supplier) {
    return res.status(404).send("Supplier not found");
  }

  db.prepare("DELETE FROM suppliers WHERE id = ?").run(req.params.id);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "supplier_deleted",
    `Supplier deleted: ${supplier.name}`
  );

  res.redirect("/suppliers");
});

module.exports = router;
