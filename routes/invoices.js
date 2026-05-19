const express = require("express");
const router = express.Router();
const db = require("../database/db");

const APP_NAME = process.env.APP_NAME || "SVG Accounts";

function nextInvoiceNumber() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM invoices").get();
  const next = row.count + 1;
  return `INV-${String(next).padStart(5, "0")}`;
}

router.get("/", (req, res) => {
  const invoices = db.prepare(`
    SELECT invoices.*, customers.name AS customer_name
    FROM invoices
    LEFT JOIN customers ON customers.id = invoices.customer_id
    ORDER BY invoices.created_at DESC
  `).all();

  res.render("invoices/index", {
    title: `Invoices | ${APP_NAME}`,
    appName: APP_NAME,
    invoices
  });
});

router.get("/new", (req, res) => {
  const customers = db.prepare("SELECT * FROM customers ORDER BY name ASC").all();

  res.render("invoices/new", {
    title: `New Invoice | ${APP_NAME}`,
    appName: APP_NAME,
    customers,
    invoiceNumber: nextInvoiceNumber()
  });
});

router.post("/new", (req, res) => {
  const {
    customer_id,
    invoice_number,
    issue_date,
    due_date,
    description,
    quantity,
    unit_price,
    vat_rate,
    notes
  } = req.body;

  const qty = Number(quantity || 1);
  const price = Number(unit_price || 0);
  const vatRate = Number(vat_rate || 0);

  const lineSubtotal = qty * price;
  const lineVat = lineSubtotal * (vatRate / 100);
  const lineTotal = lineSubtotal + lineVat;

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (
      invoice_number,
      customer_id,
      issue_date,
      due_date,
      status,
      subtotal,
      vat_total,
      total,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insertInvoice.run(
    invoice_number,
    customer_id || null,
    issue_date,
    due_date,
    "sent",
    lineSubtotal,
    lineVat,
    lineTotal,
    notes
  );

  const invoiceId = result.lastInsertRowid;

  db.prepare(`
    INSERT INTO invoice_items (
      invoice_id,
      description,
      quantity,
      unit_price,
      vat_rate,
      line_subtotal,
      line_vat,
      line_total
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    invoiceId,
    description,
    qty,
    price,
    vatRate,
    lineSubtotal,
    lineVat,
    lineTotal
  );

  const accounts = {
    accountsReceivable: db.prepare("SELECT id FROM accounts WHERE code = '1200'").get(),
    sales: db.prepare("SELECT id FROM accounts WHERE code = '4000'").get(),
    vatPayable: db.prepare("SELECT id FROM accounts WHERE code = '2200'").get()
  };

  const journal = db.prepare(`
    INSERT INTO journal_entries (entry_date, source_type, source_id, description)
    VALUES (?, ?, ?, ?)
  `).run(issue_date, "invoice", invoiceId, `Invoice created: ${invoice_number}`);

  const journalId = journal.lastInsertRowid;

  db.prepare(`
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (?, ?, ?, ?)
  `).run(journalId, accounts.accountsReceivable.id, lineTotal, 0);

  db.prepare(`
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (?, ?, ?, ?)
  `).run(journalId, accounts.sales.id, 0, lineSubtotal);

  if (lineVat > 0) {
    db.prepare(`
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (?, ?, ?, ?)
    `).run(journalId, accounts.vatPayable.id, 0, lineVat);
  }

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "invoice_created",
    `Invoice created: ${invoice_number}`
  );

  res.redirect("/invoices");
});

router.get("/:id", (req, res) => {
  const invoice = db.prepare(`
    SELECT invoices.*, customers.name AS customer_name, customers.email AS customer_email, customers.address AS customer_address
    FROM invoices
    LEFT JOIN customers ON customers.id = invoices.customer_id
    WHERE invoices.id = ?
  `).get(req.params.id);

  if (!invoice) {
    return res.status(404).send("Invoice not found");
  }

  const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(req.params.id);

  res.render("invoices/show", {
    title: `${invoice.invoice_number} | ${APP_NAME}`,
    appName: APP_NAME,
    invoice,
    items
  });
});

router.post("/:id/mark-paid", (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);

  if (!invoice) {
    return res.status(404).send("Invoice not found");
  }

  db.prepare(`
    UPDATE invoices
    SET status = 'paid',
        amount_paid = total,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  const accounts = {
    bank: db.prepare("SELECT id FROM accounts WHERE code = '1000'").get(),
    accountsReceivable: db.prepare("SELECT id FROM accounts WHERE code = '1200'").get()
  };

  const journal = db.prepare(`
    INSERT INTO journal_entries (entry_date, source_type, source_id, description)
    VALUES (date('now'), ?, ?, ?)
  `).run("invoice_payment", invoice.id, `Invoice paid: ${invoice.invoice_number}`);

  const journalId = journal.lastInsertRowid;

  db.prepare(`
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (?, ?, ?, ?)
  `).run(journalId, accounts.bank.id, invoice.total, 0);

  db.prepare(`
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (?, ?, ?, ?)
  `).run(journalId, accounts.accountsReceivable.id, 0, invoice.total);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "invoice_marked_paid",
    `Invoice marked as paid: ${invoice.invoice_number}`
  );

  res.redirect(`/invoices/${req.params.id}`);
});

module.exports = router;
