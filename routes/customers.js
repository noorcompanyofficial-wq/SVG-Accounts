const express = require("express");
const router = express.Router();
const db = require("../database/db");

const APP_NAME = process.env.APP_NAME || "SVG Accounts";

router.get("/", (req, res) => {
  const customers = db.prepare(`
    SELECT *
    FROM customers
    ORDER BY created_at DESC
  `).all();

  res.render("customers/index", {
    title: `Customers | ${APP_NAME}`,
    appName: APP_NAME,
    customers
  });
});

router.get("/new", (req, res) => {
  res.render("customers/new", {
    title: `New Customer | ${APP_NAME}`,
    appName: APP_NAME
  });
});

router.post("/new", (req, res) => {
  const { name, email, phone, address } = req.body;

  db.prepare(`
    INSERT INTO customers (name, email, phone, address)
    VALUES (?, ?, ?, ?)
  `).run(name, email, phone, address);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "customer_created",
    `Customer created: ${name}`
  );

  res.redirect("/customers");
});

router.get("/:id/edit", (req, res) => {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);

  if (!customer) {
    return res.status(404).send("Customer not found");
  }

  res.render("customers/edit", {
    title: `Edit Customer | ${APP_NAME}`,
    appName: APP_NAME,
    customer
  });
});

router.post("/:id/edit", (req, res) => {
  const { name, email, phone, address } = req.body;

  db.prepare(`
    UPDATE customers
    SET name = ?,
        email = ?,
        phone = ?,
        address = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, email, phone, address, req.params.id);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "customer_updated",
    `Customer updated: ${name}`
  );

  res.redirect("/customers");
});

router.post("/:id/delete", (req, res) => {
  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id);

  if (!customer) {
    return res.status(404).send("Customer not found");
  }

  db.prepare("DELETE FROM customers WHERE id = ?").run(req.params.id);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "customer_deleted",
    `Customer deleted: ${customer.name}`
  );

  res.redirect("/customers");
});

module.exports = router;
