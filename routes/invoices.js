const express = require("express");
const router = express.Router();
const db = require("../database/db");
const generateInvoicePdf = require("../utils/invoicePdf");

const APP_NAME = process.env.APP_NAME || "SVG Accounts";

function nextInvoiceNumber() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM invoices").get();
  const next = row.count + 1;
  return `INV-${String(next).padStart(5, "0")}`;
}

function getInvoiceWithCustomer(id) {
  return db.prepare(`
    SELECT invoices.*,
           customers.name AS customer_name,
           customers.email AS customer_email,
           customers.address AS customer_address
    FROM invoices
    LEFT JOIN customers ON customers.id = invoices.customer_id
    WHERE invoices.id = ?
  `).get(id);
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

function createInvoiceJournal(invoiceId, invoiceNumber, issueDate, subtotal, vatTotal, total) {
  const accounts = {
    accountsReceivable: db.prepare("SELECT id FROM accounts WHERE code = '1200'").get(),
    sales: db.prepare("SELECT id FROM accounts WHERE code = '4000'").get(),
    vatPayable: db.prepare("SELECT id FROM accounts WHERE code = '2200'").get()
  };

  const journal = db.prepare(`
    INSERT INTO journal_entries (entry_date, source_type, source_id, description)
    VALUES (?, ?, ?, ?)
  `).run(issueDate, "invoice", invoiceId, `Invoice created/updated: ${invoiceNumber}`);

  const journalId = journal.lastInsertRowid;

  db.prepare(`
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (?, ?, ?, ?)
  `).run(journalId, accounts.accountsReceivable.id, total, 0);

  db.prepare(`
    INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (?, ?, ?, ?)
  `).run(journalId, accounts.sales.id, 0, subtotal);

  if (vatTotal > 0) {
    db.prepare(`
      INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit)
      VALUES (?, ?, ?, ?)
    `).run(journalId, accounts.vatPayable.id, 0, vatTotal);
  }
}

function calculateLine(quantity, unitPrice, vatRate) {
  const qty = Number(quantity || 1);
  const price = Number(unitPrice || 0);
  const rate = Number(vatRate || 0);

  const subtotal = qty * price;
  const vat = subtotal * (rate / 100);
  const total = subtotal + vat;

  return {
    qty,
    price,
    rate,
    subtotal,
    vat,
    total
  };
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

  const line = calculateLine(quantity, unit_price, vat_rate);

  const result = db.prepare(`
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
  `).run(
    invoice_number,
    customer_id || null,
    issue_date,
    due_date,
    "sent",
    line.subtotal,
    line.vat,
    line.total,
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
    line.qty,
    line.price,
    line.rate,
    line.subtotal,
    line.vat,
    line.total
  );

  createInvoiceJournal(invoiceId, invoice_number, issue_date, line.subtotal, line.vat, line.total);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "invoice_created",
    `Invoice created: ${invoice_number}`
  );

  res.redirect("/invoices");
});

router.get("/:id", (req, res) => {
  const invoice = getInvoiceWithCustomer(req.params.id);

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

router.get("/:id/edit", (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);

  if (!invoice) {
    return res.status(404).send("Invoice not found");
  }

  if (invoice.status === "paid") {
    return res.status(400).send("Paid invoices cannot be edited. Unpaid/editing controls will be improved later.");
  }

  const item = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ? LIMIT 1").get(req.params.id);
  const customers = db.prepare("SELECT * FROM customers ORDER BY name ASC").all();

  res.render("invoices/edit", {
    title: `Edit ${invoice.invoice_number} | ${APP_NAME}`,
    appName: APP_NAME,
    invoice,
    item,
    customers
  });
});

router.post("/:id/edit", (req, res) => {
  const existing = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);

  if (!existing) {
    return res.status(404).send("Invoice not found");
  }

  if (existing.status === "paid") {
    return res.status(400).send("Paid invoices cannot be edited.");
  }

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

  const line = calculateLine(quantity, unit_price, vat_rate);

  db.prepare(`
    UPDATE invoices
    SET invoice_number = ?,
        customer_id = ?,
        issue_date = ?,
        due_date = ?,
        subtotal = ?,
        vat_total = ?,
        total = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    invoice_number,
    customer_id || null,
    issue_date,
    due_date,
    line.subtotal,
    line.vat,
    line.total,
    notes,
    req.params.id
  );

  db.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").run(req.params.id);

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
    req.params.id,
    description,
    line.qty,
    line.price,
    line.rate,
    line.subtotal,
    line.vat,
    line.total
  );

  removeJournalForSource("invoice", req.params.id);
  createInvoiceJournal(req.params.id, invoice_number, issue_date, line.subtotal, line.vat, line.total);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "invoice_updated",
    `Invoice updated: ${invoice_number}`
  );

  res.redirect(`/invoices/${req.params.id}`);
});

router.post("/:id/delete", (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);

  if (!invoice) {
    return res.status(404).send("Invoice not found");
  }

  if (invoice.status === "paid") {
    return res.status(400).send("Paid invoices cannot be deleted yet. We will add credit notes/refunds later.");
  }

  removeJournalForSource("invoice", req.params.id);

  db.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").run(req.params.id);
  db.prepare("DELETE FROM invoices WHERE id = ?").run(req.params.id);

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "invoice_deleted",
    `Invoice deleted: ${invoice.invoice_number}`
  );

  res.redirect("/invoices");
});

router.get("/:id/pdf", (req, res) => {
  const invoice = getInvoiceWithCustomer(req.params.id);

  if (!invoice) {
    return res.status(404).send("Invoice not found");
  }

  const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(req.params.id);
  const company = db.prepare("SELECT * FROM companies ORDER BY id LIMIT 1").get();

  const doc = generateInvoicePdf({ invoice, items, company });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${invoice.invoice_number}.pdf"`
  );

  doc.pipe(res);
  doc.end();
});

router.post("/:id/mark-paid", (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);

  if (!invoice) {
    return res.status(404).send("Invoice not found");
  }

  if (invoice.status === "paid") {
    return res.redirect(`/invoices/${req.params.id}`);
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
