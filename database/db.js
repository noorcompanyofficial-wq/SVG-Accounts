const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "svg_accounts.sqlite");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'My Company',
  company_number TEXT,
  vat_number TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  postcode TEXT,
  country TEXT DEFAULT 'United Kingdom',
  currency TEXT DEFAULT 'GBP',
  vat_registered INTEGER DEFAULT 0,
  default_vat_rate REAL DEFAULT 20,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  is_system INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT DEFAULT 'draft',
  subtotal REAL DEFAULT 0,
  vat_total REAL DEFAULT 0,
  total REAL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  vat_rate REAL DEFAULT 20,
  line_subtotal REAL DEFAULT 0,
  line_vat REAL DEFAULT 0,
  line_total REAL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER,
  expense_date TEXT NOT NULL,
  category_account_id INTEGER,
  description TEXT NOT NULL,
  subtotal REAL DEFAULT 0,
  vat_total REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paid_from TEXT DEFAULT 'cash',
  receipt_path TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (category_account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  description TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const companyCount = db.prepare("SELECT COUNT(*) AS count FROM companies").get().count;

if (companyCount === 0) {
  db.prepare(`
    INSERT INTO companies (name, currency, country, vat_registered, default_vat_rate)
    VALUES (?, ?, ?, ?, ?)
  `).run("SVG Accounts Demo Company", "GBP", "United Kingdom", 0, 20);
}

const defaultAccounts = [
  ["1000", "Bank", "asset", 1],
  ["1100", "Cash", "asset", 1],
  ["1200", "Accounts Receivable", "asset", 1],
  ["2000", "Accounts Payable", "liability", 1],
  ["2200", "VAT Payable", "liability", 1],
  ["2210", "VAT Reclaimable", "asset", 1],
  ["4000", "Sales", "income", 1],
  ["5000", "Purchases", "expense", 1],
  ["5100", "Rent", "expense", 1],
  ["5200", "Utilities", "expense", 1],
  ["5300", "Postage and Delivery", "expense", 1],
  ["5400", "Payment Processing Fees", "expense", 1],
  ["5500", "Marketing", "expense", 1],
  ["5600", "Software and Subscriptions", "expense", 1],
  ["5700", "General Expenses", "expense", 1]
];

const insertAccount = db.prepare(`
  INSERT OR IGNORE INTO accounts (code, name, type, is_system)
  VALUES (?, ?, ?, ?)
`);

for (const account of defaultAccounts) {
  insertAccount.run(...account);
}

module.exports = db;
