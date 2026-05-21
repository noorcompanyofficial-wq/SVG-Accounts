const express = require("express");
const router = express.Router();
const db = require("../database/db");

const APP_NAME = process.env.APP_NAME || "SVG Accounts";

router.get("/", (req, res) => {
  const sales = db.prepare(`
    SELECT COALESCE(SUM(subtotal), 0) AS subtotal,
           COALESCE(SUM(vat_total), 0) AS vat,
           COALESCE(SUM(total), 0) AS total
    FROM invoices
    WHERE status != 'draft'
  `).get();

  const expenses = db.prepare(`
    SELECT COALESCE(SUM(subtotal), 0) AS subtotal,
           COALESCE(SUM(vat_total), 0) AS vat,
           COALESCE(SUM(total), 0) AS total
    FROM expenses
  `).get();

  const unpaidInvoices = db.prepare(`
    SELECT invoices.*, customers.name AS customer_name
    FROM invoices
    LEFT JOIN customers ON customers.id = invoices.customer_id
    WHERE invoices.status != 'paid'
    ORDER BY invoices.due_date ASC
  `).all();

  const expenseBreakdown = db.prepare(`
    SELECT accounts.name AS category_name,
           COALESCE(SUM(expenses.total), 0) AS total
    FROM expenses
    LEFT JOIN accounts ON accounts.id = expenses.category_account_id
    GROUP BY accounts.name
    ORDER BY total DESC
  `).all();

  const netProfit = sales.subtotal - expenses.subtotal;
  const vatDue = sales.vat - expenses.vat;

  res.render("reports/index", {
    title: `Reports | ${APP_NAME}`,
    appName: APP_NAME,
    sales,
    expenses,
    unpaidInvoices,
    expenseBreakdown,
    netProfit,
    vatDue
  });
});

router.get("/journal", (req, res) => {
  const entries = db.prepare(`
    SELECT *
    FROM journal_entries
    ORDER BY entry_date DESC, id DESC
  `).all();

  const lines = db.prepare(`
    SELECT journal_lines.*,
           accounts.code AS account_code,
           accounts.name AS account_name
    FROM journal_lines
    LEFT JOIN accounts ON accounts.id = journal_lines.account_id
    ORDER BY journal_lines.id ASC
  `).all();

  const groupedLines = {};

  for (const line of lines) {
    if (!groupedLines[line.journal_entry_id]) {
      groupedLines[line.journal_entry_id] = [];
    }

    groupedLines[line.journal_entry_id].push(line);
  }

  res.render("reports/journal", {
    title: `Accounting Entries | ${APP_NAME}`,
    appName: APP_NAME,
    entries,
    groupedLines
  });
});

module.exports = router;
