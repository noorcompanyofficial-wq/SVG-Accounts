const express = require("express");
const router = express.Router();
const db = require("../database/db");

const APP_NAME = process.env.APP_NAME || "SVG Accounts";

function calculateExpense(total, vatRate) {
  const grossTotal = Number(total || 0);
  const rate = Number(vatRate || 0);

  const subtotal = rate > 0 ? grossTotal / (1 + rate / 100) : grossTotal;
  const vatTotal = grossTotal - subtotal;

  return {
    grossTotal,
    rate,
    subtotal,
    vatTotal
  };
}

function removeJournalForSource(sourceType, sourceId) {
  const entries = db.prepare(`
    SELECT id FROM journal_entries
    WHERE source_type = ? AND source_id = ?
  `).all(sourceType, sourceId);

  for (const entry of entries) {
    db.prepare("DELETE FROM journal_lines WHERE journal_entry_id = ?").run(entry.id);
    db.prepare("DELETE FROM journal_entries WHERE id = ?").run(entry.id);
  }
}

function createExpenseJournal(expenseId, expenseDate, description, categoryAccountId, subtotal, vatTotal, grossTotal, paidFrom) {
  const accounts = {
    category: db.prepare("SELECT id FROM accounts WHERE id = ?").get(categoryAccountId),
    vatReclaimable: db.prepare("SELECT id FROM accounts WHERE code = '2210'").get(),
    bank: db.prepare("SELECT id FROM accounts WHERE code = '1000'").get(),
    cash: db.prepare("SELECT id FROM accounts WHERE code = '1100'").get()
  };

  const paidAccount = paidFrom === "bank" ? accounts.bank : accounts.cash;

  const journal = db.prepare(`
    INSERT INTO journal_entries (entry_date, source_type, source_id, description)
    VALUES (?, ?, ?, ?)
  `).run(expenseDate, "expense", expenseId, `Expense recorded/updated: ${description}`);

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
}

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

  const calculated = calculateExpense(total, vat_rate);

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
    calculated.subtotal,
    calculated.vatTotal,
    calculated.grossTotal,
    paid_from || "cash"
  );

  const expenseId = result.lastInsertRowid;

  createExpenseJournal(
    expenseId,
    expense_date,
    description,
    category_account_id,
    calculated.subtotal,
    calculated.vatTotal,
    calculated.grossTotal,
    paid_from || "cash"
  );

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

router.get("/:id/edit", (req, res) => {
  const expense = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id);

  if (!expense) {
    return res.status(404).send("Expense not found");
  }

  const suppliers = db.prepare("SELECT * FROM suppliers ORDER BY name ASC").all();

  const categories = db.prepare(`
    SELECT *
    FROM accounts
    WHERE type = 'expense'
    ORDER BY code ASC
  `).all();

  res.render("expenses/edit", {
    title: `Edit Expense | ${APP_NAME}`,
    appName: APP_NAME,
    expense,
    suppliers,
    categories
  });
});

router.post("/:id/edit", (req, res) => {
  const existing = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id);

  if (!existing) {
    return res.status(404).send("Expense not found");
  }

  const {
    supplier_id,
    expense_date,
    category_account_id,
    description,
    total,
    vat_rate,
    paid_from
  } = req.body;

  const calculated = calculateExpense(total, vat_rate);

  db.prepare(`
    UPDATE expenses
    SET supplier_id = ?,
        expense_date = ?,
        category_account_id = ?,
        description = ?,
        subtotal = ?,
        vat_total = ?,
        total = ?,
        paid_from = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    supplier_id || null,
    expense_date,
    category_account_id,
    description,
    calculated.subtotal,
    calculated.vatTotal,
    calculated.grossTotal,
    paid_from || "cash",
    req.params.id
  );

  removeJournalForSource("expense", req.params.id);

  createExpenseJournal(
    req.params.id,
    expense_date,
    description,
    category_account_id,
    calculated.subtotal,
    calculated.vatTotal,
    calculated.grossTotal,
    paid_from || "cash"
  );

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "expense_updated",
    `Expense updated: ${description}`
  );

  res.redirect(`/expenses/${req.params.id}`);
});

router.post("/:id/delete", (req, res) => {
  const expense = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id);

  if (!expense) {
    return res.status(404).send("Expense not found");
  }

  removeJournalForSource("expense", req.params.id);

  db.prepare("DELETE FROM expenses WHERE id = ?").run(req.params.id);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "expense_deleted",
    `Expense deleted: ${expense.description}`
  );

  res.redirect("/expenses");
});

module.exports = router;
