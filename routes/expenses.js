const express = require("express");
const router = express.Router();
const db = require("../database/db");

const APP_NAME = process.env.APP_NAME || "SVG Accounts";

router.get("/", (req, res) => {
  const expenses = db.prepare(`
    SELECT expenses.*, suppliers.name AS supplier_name, accounts.name AS category_name
    FROM expenses
    LEFT JOIN suppliers ON suppliers.id = expenses.supplier_id
    LEFT JOIN accounts ON accounts.id = expenses.category_account_id
    ORDER BY expenses.created_at DESC
  `).all();

  res.render("expenses/index", {
    title: `Expenses | ${APP_NAME}`,
    appName: APP_NAME,
    expenses
  });
});

router.get("/new", (req, res) => {
  const suppliers = db.prepare("SELECT * FROM suppliers ORDER BY name ASC").all();

  const categories = db.prepare(`
    SELECT *
    FROM accounts
    WHERE type = 'expense'
    ORDER BY code ASC
  `).all();

  res.render("expenses/new", {
    title: `New Expense | ${APP_NAME}`,
    appName: APP_NAME,
    suppliers,
    categories
  });
});

router.post("/new", (req, res) => {
  const {
    supplier_id,
    expense_date,
    category_account_id,
    description,
    total,
    vat_rate,
    paid_from
  } = req.body;

  const grossTotal = Number(total || 0);
  const vatRate = Number(vat_rate || 0);

  const subtotal = vatRate > 0 ? grossTotal / (1 + vatRate / 100) : grossTotal;
  const vatTotal = grossTotal - subtotal;

  const result = db.prepare(`
    INSERT INTO expenses (
      supplier_id,
      expense_date,
      category_account_id,
      description,
      subtotal,
      vat_total,
      total,
      paid_from
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    supplier_id || null,
    expense_date,
    category_account_id,
    description,
    subtotal,
    vatTotal,
    grossTotal,
    paid_from || "cash"
  );

  const expenseId = result.lastInsertRowid;

  const accounts = {
    category: db.prepare("SELECT id FROM accounts WHERE id = ?").get(category_account_id),
    vatReclaimable: db.prepare("SELECT id FROM accounts WHERE code = '2210'").get(),
    bank: db.prepare("SELECT id FROM accounts WHERE code = '1000'").get(),
    cash: db.prepare("SELECT id FROM accounts WHERE code = '1100'").get()
  };

  const paidAccount = paid_from === "bank" ? accounts.bank : accounts.cash;

  const journal = db.prepare(`
    INSERT INTO journal_entries (entry_date, source_type, source_id, description)
    VALUES (?, ?, ?, ?)
  `).run(expense_date, "expense", expenseId, `Expense recorded: ${description}`);

  const journalId = journal.lastInsertRowid;

  db.prepare(`
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (?, ?, ?, ?)
  `).run(journalId, accounts.category.id, subtotal, 0);

  if (vatTotal > 0) {
    db.prepare(`
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (?, ?, ?, ?)
    `).run(journalId, accounts.vatReclaimable.id, vatTotal, 0);
  }

  db.prepare(`
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (?, ?, ?, ?)
  `).run(journalId, paidAccount.id, 0, grossTotal);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "expense_created",
    `Expense created: ${description}`
  );

  res.redirect("/expenses");
});

router.get("/:id", (req, res) => {
  const expense = db.prepare(`
    SELECT expenses.*, suppliers.name AS supplier_name, accounts.name AS category_name
    FROM expenses
    LEFT JOIN suppliers ON suppliers.id = expenses.supplier_id
    LEFT JOIN accounts ON accounts.id = expenses.category_account_id
    WHERE expenses.id = ?
  `).get(req.params.id);

  if (!expense) {
    return res.status(404).send("Expense not found");
  }

  res.render("expenses/show", {
    title: `Expense | ${APP_NAME}`,
    appName: APP_NAME,
    expense
  });
});

module.exports = router;
