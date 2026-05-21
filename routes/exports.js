const express = require("express");
const router = express.Router();
const db = require("../database/db");

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function sendCsv(res, filename, headers, rows) {
  const csvRows = [];

  csvRows.push(headers.map(csvEscape).join(","));

  for (const row of rows) {
    csvRows.push(headers.map((header) => csvEscape(row[header])).join(","));
  }

  const csv = csvRows.join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

router.get("/", (req, res) => {
  res.render("exports/index", {
    title: "Exports | SVG Accounts",
    appName: process.env.APP_NAME || "SVG Accounts",
  });
});

router.get("/invoices.csv", (req, res) => {
  const rows = db.prepare(`
    SELECT
      invoices.invoice_number AS invoice_number,
      customers.name AS customer,
      invoices.issue_date AS issue_date,
      invoices.due_date AS due_date,
      invoices.status AS status,
      invoices.subtotal AS subtotal,
      invoices.vat_total AS vat_total,
      invoices.total AS total,
      invoices.amount_paid AS amount_paid,
      invoices.notes AS notes
    FROM invoices
    LEFT JOIN customers ON customers.id = invoices.customer_id
    ORDER BY invoices.issue_date DESC
  `).all();

  sendCsv(
    res,
    "svg-accounts-invoices.csv",
    [
      "invoice_number",
      "customer",
      "issue_date",
      "due_date",
      "status",
      "subtotal",
      "vat_total",
      "total",
      "amount_paid",
      "notes",
    ],
    rows
  );
});

router.get("/expenses.csv", (req, res) => {
  const rows = db.prepare(`
    SELECT
      expenses.expense_date AS expense_date,
      expenses.description AS description,
      suppliers.name AS supplier,
      accounts.name AS category,
      expenses.subtotal AS subtotal,
      expenses.vat_total AS vat_total,
      expenses.total AS total,
      expenses.paid_from AS paid_from
    FROM expenses
    LEFT JOIN suppliers ON suppliers.id = expenses.supplier_id
    LEFT JOIN accounts ON accounts.id = expenses.category_account_id
    ORDER BY expenses.expense_date DESC
  `).all();

  sendCsv(
    res,
    "svg-accounts-expenses.csv",
    [
      "expense_date",
      "description",
      "supplier",
      "category",
      "subtotal",
      "vat_total",
      "total",
      "paid_from",
    ],
    rows
  );
});

router.get("/customers.csv", (req, res) => {
  const rows = db.prepare(`
    SELECT
      name,
      email,
      phone,
      address,
      created_at
    FROM customers
    ORDER BY name ASC
  `).all();

  sendCsv(
    res,
    "svg-accounts-customers.csv",
    ["name", "email", "phone", "address", "created_at"],
    rows
  );
});

router.get("/suppliers.csv", (req, res) => {
  const rows = db.prepare(`
    SELECT
      name,
      email,
      phone,
      address,
      created_at
    FROM suppliers
    ORDER BY name ASC
  `).all();

  sendCsv(
    res,
    "svg-accounts-suppliers.csv",
    ["name", "email", "phone", "address", "created_at"],
    rows
  );
});

router.get("/journal.csv", (req, res) => {
  const rows = db.prepare(`
    SELECT
      journal_entries.entry_date AS entry_date,
      journal_entries.source_type AS source_type,
      journal_entries.source_id AS source_id,
      journal_entries.description AS description,
      accounts.code AS account_code,
      accounts.name AS account_name,
      journal_lines.debit AS debit,
      journal_lines.credit AS credit
    FROM journal_lines
    LEFT JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id
    LEFT JOIN accounts ON accounts.id = journal_lines.account_id
    ORDER BY journal_entries.entry_date DESC, journal_entries.id DESC
  `).all();

  sendCsv(
    res,
    "svg-accounts-journal.csv",
    [
      "entry_date",
      "source_type",
      "source_id",
      "description",
      "account_code",
      "account_name",
      "debit",
      "credit",
    ],
    rows
  );
});

module.exports = router;
