const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const APP_NAME = process.env.APP_NAME || "SVG Accounts";

const dbPath = path.join(__dirname, "..", "database", "svg_accounts.sqlite");
const backupDir = path.join(__dirname, "..", "backups");

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const upload = multer({
  dest: backupDir,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

router.get("/", (req, res) => {
  res.render("backup/index", {
    title: `Backup | ${APP_NAME}`,
    appName: APP_NAME
  });
});

router.get("/download", (req, res) => {
  if (!fs.existsSync(dbPath)) {
    return res.status(404).send("Database file not found.");
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `svg-accounts-backup-${date}.sqlite`;

  res.download(dbPath, filename);
});

router.post("/restore", upload.single("backup_file"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No backup file uploaded.");
  }

  const uploadedPath = req.file.path;
  const originalName = req.file.originalname || "";

  if (!originalName.endsWith(".sqlite") && !originalName.endsWith(".db")) {
    fs.unlinkSync(uploadedPath);
    return res.status(400).send("Invalid backup file. Please upload a .sqlite or .db file.");
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safetyCopyPath = path.join(backupDir, `before-restore-${timestamp}.sqlite`);

  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, safetyCopyPath);
  }

  fs.copyFileSync(uploadedPath, dbPath);
  fs.unlinkSync(uploadedPath);

  res.send(`
    <html>
      <head>
        <title>Restore Complete</title>
        <link rel="stylesheet" href="/css/style.css">
      </head>
      <body>
        <main class="landing">
          <div class="landing-card">
            <p class="badge">Restore Complete</p>
            <h1>Backup Restored</h1>
            <p class="subtitle">
              Your database backup has been restored. Please stop and restart the app in Terminal before using it again.
            </p>
            <p class="privacy-note">
              A safety copy of the previous database was saved in the backups folder.
            </p>
            <a href="/backup" class="btn primary">Back to Backup</a>
          </div>
        </main>
      </body>
    </html>
  `);
});

module.exports = router;
