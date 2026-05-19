require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const db = require("./database/db");
const customerRoutes = require("./routes/customers");

const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || "SVG Accounts";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "local-private-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    },
  })
);

// Private offline mode: only allow access from this computer
app.use((req, res, next) => {
  const host = req.hostname;
  const allowedHosts = ["localhost", "127.0.0.1", "::1"];

  if (!allowedHosts.includes(host)) {
    return res
      .status(403)
      .send("SVG Accounts is private and only accessible locally.");
  }

  next();
});

app.get("/", (req, res) => {
  res.render("home", {
    title: APP_NAME,
    appName: APP_NAME,
  });
});

app.get("/dashboard", (req, res) => {
  const company = db.prepare("SELECT * FROM companies ORDER BY id LIMIT 1").get();

  const totals = {
    sales: db.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM invoices WHERE status != 'draft'").get().total,
    expenses: db.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM expenses").get().total,
    vatOnSales: db.prepare("SELECT COALESCE(SUM(vat_total), 0) AS total FROM invoices WHERE status != 'draft'").get().total,
    vatOnExpenses: db.prepare("SELECT COALESCE(SUM(vat_total), 0) AS total FROM expenses").get().total
  };

  totals.estimatedVat = totals.vatOnSales - totals.vatOnExpenses;
  totals.profit = totals.sales - totals.expenses;

  res.render("dashboard", {
    title: `Dashboard | ${APP_NAME}`,
    appName: APP_NAME,
    company,
    totals
  });
});

app.get("/settings", (req, res) => {
  const company = db.prepare("SELECT * FROM companies ORDER BY id LIMIT 1").get();

  res.render("settings", {
    title: `Settings | ${APP_NAME}`,
    appName: APP_NAME,
    company
  });
});

app.post("/settings", (req, res) => {
  const {
    name,
    company_number,
    vat_number,
    address_line_1,
    address_line_2,
    city,
    postcode,
    country,
    vat_registered,
    default_vat_rate
  } = req.body;

  const company = db.prepare("SELECT * FROM companies ORDER BY id LIMIT 1").get();

  db.prepare(`
    UPDATE companies
    SET name = ?,
        company_number = ?,
        vat_number = ?,
        address_line_1 = ?,
        address_line_2 = ?,
        city = ?,
        postcode = ?,
        country = ?,
        vat_registered = ?,
        default_vat_rate = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name,
    company_number,
    vat_number,
    address_line_1,
    address_line_2,
    city,
    postcode,
    country || "United Kingdom",
    vat_registered === "1" ? 1 : 0,
    Number(default_vat_rate || 20),
    company.id
  );

  db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(
    "company_settings_updated",
    `Company settings updated for ${name}`
  );

  res.redirect("/settings");
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`${APP_NAME} private offline app running at http://localhost:${PORT}`);
});
