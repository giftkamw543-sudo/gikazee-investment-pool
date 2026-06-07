require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

const nodemailer = require('nodemailer');

// Initialize Secure Mail Transporter Configuration lazily
let mailTransporter = null;

function getMailTransporter() {
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER, // Your designated system email
        pass: process.env.EMAIL_PASS         // Your Gmail App Password from Railway
      }
    });
  }
  return mailTransporter;
}

// Reusable Core Mail Trigger Engine
async function sendGikazeeEmail(toEmail, subject, htmlContent) {
  try {
    const transporter = getMailTransporter(); // Fetch instance at runtime
    const mailOptions = {
      from: '"GIKAZEE" <gikazeeinvestment@gmail.com>',
      to: toEmail,
      subject: subject,
      html: htmlContent
    };
    await transporter.sendMail(mailOptions);
    console.log(`Email successfully dispatched to: ${toEmail}`);
  } catch (error) {
    console.error("Mail engine execution dropped:", error);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended:true }));
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// ================= MULTER =================
const storage = multer.diskStorage({
  destination: function(req, file, cb){
    cb(null, "uploads/");
  },
  filename: function(req, file, cb){
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// ================= DATABASE CONNECTION (STABILIZED POOL) =================
// Using a callback pool to support legacy queries without breaking execution strings
const db = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST,
  user: process.env.MYSQLUSER || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME,
  port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 15, 
  queueLimit: 0,
  enableKeepAlive: true, 
  keepAliveInitialDelay: 10000
});

// Test the connection pool link on application initialization
db.getConnection((err, connection) => {
  if (err) {
    console.error("Database connection pool failed initialization:", err);
    return;
  }
  console.log("MySQL Database Pool Connected Successfully!");
  connection.release();
});

module.exports = db;

// ================= JWT MIDDLEWARE =================
function verifyToken(req, res, next){
  const token = req.headers.authorization;
  if(!token){
    return res.status(401).json({ success:false, message:"Access denied" });
  }
  try{
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  }catch(err){
    return res.status(401).json({ success:false, message:"Invalid token" });
  }
}

// ================= ADMIN MIDDLEWARE =================
function verifyAdmin(req, res, next){
  verifyToken(req, res, () => {
    if(!req.user.isAdmin){
      return res.status(403).json({ success:false, message:"Admin only" });
    }
    next();
  });
}

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("GIKAZEE SERVER RUNNING");
});

// ================= REGISTER =================
app.post("/api/register", async (req, res) => {
  const { name, email, password, referral_code } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const myReferralCode = "GIKA" + Math.floor(1000 + Math.random() * 9000);
    db.query(
      `INSERT INTO users (name, email, password, balance, roi_total, referral_code, referred_by, status) VALUES(?,?,?,?,?,?,?,?)`,
      [name, email, hashedPassword, 0, 0, myReferralCode, referral_code || null, "active"],
      (err) => {
        if (err) {
          console.log("REGISTER ERROR:", err);
          return res.json({ success: false, message: err.sqlMessage || err.message });
        }

        res.json({ success: true, message: "Registration successful" });

        // --- AUTO-EMAIL TRACER FOR NEW REGISTRATIONS ---
        const welcomeSubject = "Welcome to GIKAZEE INVESTMENT – Let's Make Your Money Work! 🚀";
        const welcomeHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; color: #334155; line-height: 1.6; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background: #0f172a; padding: 30px; text-align: center;">
              <h1 style="color: #38bdf8; margin: 0; font-size: 26px; letter-spacing: 1px;">GIKAZEE INVESTMENT</h1>
              <p style="color: #94a3b8; margin: 5px 0 0 0; font-size: 14px;">Asset Management & Growth Pool</p>
            </div>
            <div style="padding: 30px; background: #ffffff;">
              <h2 style="color: #0f172a; margin-top: 0;">Welcome to the Community, ${name || 'Investor'}! 🎉</h2>
              <p style="font-size: 15px; color: #475569;">
                Your registration was completely successful. You have officially taken the first critical step toward securing long-term financial consistency. 
                It is now time to **make your money work for you**, instead of you working tirelessly for it!
              </p>
              <p style="font-size: 15px; color: #475569; font-weight: bold; margin-top: 25px;">
                Follow these 3 simple steps to activate your daily profit streams:
              </p>
              <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 15px; margin-bottom: 15px; border-radius: 0 8px 8px 0;">
                <strong style="color: #2563eb; font-size: 15px;">Step 1: Make a Deposit 🏦</strong>
                <p style="margin: 5px 0 0 0; font-size: 13.5px; color: #64748b;">
                  Log into your profile dashboard, scroll down to the <b>Deposit</b> segment, choose your preferred local channel (Airtel, MTN, or USDT), and request an account balance top-up.
                </p>
              </div>
              <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 15px; margin-bottom: 15px; border-radius: 0 8px 8px 0;">
                <strong style="color: #2563eb; font-size: 15px;">Step 2: Allocate and Invest 📈</strong>
                <p style="margin: 5px 0 0 0; font-size: 13.5px; color: #64748b;">
                  Select a premier VIP compound interest contract plan that completely suits your capital capabilities, input your target amount, and lock it in.
                </p>
              </div>
              <div style="background: #f8fafc; border-left: 4px solid #22c55e; padding: 15px; margin-bottom: 25px; border-radius: 0 8px 8px 0;">
                <strong style="color: #22c55e; font-size: 15px;">Step 3: Watch Your Wealth Grow 💰</strong>
                <p style="margin: 5px 0 0 0; font-size: 13.5px; color: #64748b;">
                  Our professional Forex trade management desk assumes total command. Sit back, relax, track your dynamic timers, and collect your structured daily ROI settlements like clockwork.
                </p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.APP_FRONTEND_URL || 'https://gikazee.netlify.app'}" target="_blank" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 30px; font-weight: bold; border-radius: 8px; font-size: 15px; display: inline-block; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);">
                  Access Your Portal Dashboard
                </a>
              </div>
              <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 25px 0;">
              <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">
                Need instant assistance setting up? Our dedicated chat support agents are always here to help guide your onboarding steps. Reply directly to this email or reach us instantly via our verified platform links.
              </p>
            </div>
            <div style="background: #f1f5f9; padding: 20px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
              This is an automated operational notification dispatched securely by the GIKAZEE backend accounting architecture.<br>
              &copy; 2026 GIKAZEE Investment Group. All rights reserved.
            </div>
          </div>
        `;
        sendGikazeeEmail(email, welcomeSubject, welcomeHtml);
      }
    );
  } catch (error) {
    res.json({ success: false, message: "Server error" });
  }
});

// ================= LOGIN =================
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.query("SELECT * FROM users WHERE email=?", [email], async (err, results) => {
    if (err || results.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }
    const user = results[0];
    if(user.status === "suspended"){
      return res.json({ success:false, message:"Account suspended" });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.json({ success: false, message: "Invalid password" });
    }
    let isAdmin = user.email === "admin@gikazee.com";
    const token = jwt.sign({ id: user.id, email: user.email, isAdmin }, process.env.JWT_SECRET, { expiresIn: "1d" });
    res.json({ success: true, token, user: { id: user.id, email: user.email, isAdmin } });
  });
});

// ================= DASHBOARD =================
app.get("/api/dashboard/:user_id", verifyToken, (req, res) => {
  const user_id = req.user.id;
  db.query("SELECT * FROM users WHERE id=?", [user_id], (err, users) => {
    if (err || users.length === 0) return res.json({ success: false });
    db.query(
      `SELECT investments.*, plans.name AS plan_name, plans.daily_roi_percent FROM investments LEFT JOIN plans ON investments.plan_id = plans.id WHERE investments.user_id=?`,
      [user_id],
      (err, investments) => {
        db.query("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC", [user_id], (err, notifications) => {
          res.json({ success: true, user: users[0], investments, notifications });
        });
      }
    );
  });
});

// ================= DEPOSIT =================
app.post("/api/deposit", verifyToken, upload.single("proof"), (req, res) => {
  const { user_id, amount, payment_method, payment_details } = req.body;
  const proof_image = req.file ? req.file.filename : null;
  db.query(
    `INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_details, proof_image) VALUES(?,?,?,?,?,?,?)`,
    [user_id, "deposit", amount, "pending", payment_method, payment_details, proof_image],
    (err) => {
      if(err){
        console.log(err);
        return res.json({ success:false, message:"Deposit failed" });
      }
      res.json({ success:true, message:"Deposit submitted successfully" });
    }
  );
});

// ================= WITHDRAW (VALIDATED) =================
app.post("/api/withdraw", verifyToken, (req, res) => {
  const user_id = req.user.id; 
  const amount = parseFloat(req.body.amount);
  const { payment_method, payment_details } = req.body;

  if (isNaN(amount) || amount <= 0) {
    return res.json({ success: false, message: "Please enter a valid withdrawal amount greater than $0.00" });
  }

  db.query("SELECT balance FROM users WHERE id = ?", [user_id], (err, results) => {
    if (err || results.length === 0) {
      return res.json({ success: false, message: "Account verification failed" });
    }

    const currentBalance = parseFloat(results[0].balance);
    if (amount > currentBalance) {
      return res.json({ success: false, message: `Insufficient balance. You have $${currentBalance.toFixed(2)}` });
    }

    db.query(
      `INSERT INTO transactions (user_id, type, amount, status, payment_method, payment_details) VALUES(?,?,?,?,?,?)`,
      [user_id, "withdrawal", amount, "pending", payment_method, payment_details],
      (err) => {
        if (err) {
          console.log("WITHDRAWAL INSERT ERROR:", err);
          return res.json({ success: false, message: "Withdrawal submission failed" });
        }
        res.json({ success: true, message: "Withdrawal request submitted successfully" });
      }
    );
  });
});

// ================= INVEST =================
app.post("/api/invest", verifyToken, (req, res) => {
  const user_id = parseInt(req.body.user_id);
  const plan_id = parseInt(req.body.plan_id);
  const amount = parseFloat(req.body.amount);

  db.query("SELECT * FROM plans WHERE id=?", [plan_id], (err, plans) => {
    if (err || plans.length === 0) return res.json({ success: false, message: "Plan not found" });
    const plan = plans[0];
    if (amount < parseFloat(plan.min_amount) || amount > parseFloat(plan.max_amount)) {
      return res.json({ success: false, message: `Amount must be between $${plan.min_amount} and $${plan.max_amount}` });
    }

    db.query("SELECT balance FROM users WHERE id=?", [user_id], (err, users) => {
      if (parseFloat(users[0].balance) < amount) return res.json({ success: false, message: "Insufficient balance" });

      db.query("UPDATE users SET balance = balance - ? WHERE id=?", [amount, user_id]);
      db.query(
        `INSERT INTO investments (user_id,plan_id,amount,status,start_date,end_date) VALUES(?,?,?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
        [user_id, plan_id, amount, "active", plan.duration_days],
        (err) => {
          if (err) {
            console.log(err);
            return res.json({ success: false, message: "Investment failed" });
          }
          db.query("INSERT INTO notifications(user_id,message) VALUES(?,?)", [user_id, "Investment started successfully"]);

          // ================= REFERRAL COMMISSION =================
          db.query("SELECT * FROM users WHERE id=?", [user_id], (err, currentUsers) => {
            if (err || currentUsers.length === 0) return;
            const currentUser = currentUsers[0];
            if (!currentUser.referred_by) return;

            db.query("SELECT * FROM users WHERE referral_code=?", [currentUser.referred_by], (err, refUsers) => {
              if (err || refUsers.length === 0) return;
              const referrer = refUsers[0];
              if (referrer.id === currentUser.id) return;

              const commission = amount * 0.05;
              db.query(`UPDATE users SET balance = balance + ?, referral_earnings = referral_earnings + ? WHERE id=?`, [commission, commission, referrer.id]);
              db.query(`INSERT INTO referral_commissions (referrer_user_id, referred_user_id, investment_id, amount) VALUES(?,?,?,?)`, [referrer.id, currentUser.id, 0, commission]);
              db.query(`INSERT INTO notifications (user_id,message) VALUES(?,?)`, [referrer.id, `Referral commission earned: $${commission.toFixed(2)}`]);
            });
          });             
          res.json({ success: true, message: "Investment started" });
        }
      );
    });
  });
});

// ================= APPROVE TRANSACTION =================
app.post("/api/admin/approve", verifyAdmin, (req, res) => {
  const { transaction_id } = req.body;

  db.query(
    "SELECT t.*, u.email FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.id=?", 
    [transaction_id], 
    (err, results) => {
      if(err || results.length === 0) return res.json({ success:false, message:"Transaction not found" });
      const tx = results[0];
      const userEmail = tx.email;

      if(tx.type === "deposit"){
        db.query("UPDATE transactions SET status='approved' WHERE id=?", [transaction_id]);
        db.query("UPDATE users SET balance = balance + ? WHERE id=?", [tx.amount, tx.user_id]);
        db.query("INSERT INTO notifications(user_id,message) VALUES(?,?)", [tx.user_id, "Your deposit has been approved"]);

        sendGikazeeEmail(userEmail, "Deposit Approved Successfully! 📈", `
          <div style="font-family: Arial, sans-serif; max-width: 600px; color: #334155;">
            <h2 style="color: #2563eb;">GIKAZEE INVESTMENT</h2>
            <p>Hello,</p>
            <p>Great news! Your deposit request for <strong>$${tx.amount}</strong> has been verified and approved by the treasury audit team.</p>
            <p>Your capital has been successfully credited to your running portfolio and is actively accumulating yield cycles.</p>
            <hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;">
            <small style="color: #94a3b8;">Thank you for choosing GIKAZEE Asset Management Group.</small>
          </div>
        `);
        return res.json({ success:true, message:"Deposit approved" });
      }

      if(tx.type === "withdrawal"){
        db.query("SELECT balance FROM users WHERE id=?", [tx.user_id], (err, users) => {
          if(err || users.length === 0) return res.json({ success:false, message:"User not found" });
          if(parseFloat(users[0].balance) < parseFloat(tx.amount)) return res.json({ success:false, message:"Insufficient user balance" });

          db.query("UPDATE transactions SET status='approved' WHERE id=?", [transaction_id]);
          db.query("UPDATE users SET balance = balance - ? WHERE id=?", [tx.amount, tx.user_id]);
          db.query("INSERT INTO notifications(user_id,message) VALUES(?,?)", [tx.user_id, "Your withdrawal has been approved"]);

          sendGikazeeEmail(userEmail, "Withdrawal Dispatched! 🏦", `
            <div style="font-family: Arial, sans-serif; max-width: 600px; color: #334155;">
              <h2 style="color: #2563eb;">GIKAZEE INVESTMENT</h2>
              <p>Hello,</p>
              <p>Your withdrawal request for <strong>$${tx.amount}</strong> has been fully processed and approved by the admin team.</p>
              <p>Funds have been dispatched directly to your specified gateway details: <strong>${tx.payment_method || 'Saved Settings'}</strong>.</p>
              <hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;">
              <small style="color: #94a3b8;">Thank you for your continued trust in our community systems.</small>
            </div>
          `);
          return res.json({ success:true, message:"Withdrawal approved" });
        });
      }
    }
  );
});

// ================= REJECT TRANSACTION =================
app.post("/api/admin/reject", verifyAdmin, (req, res) => {
  const { transaction_id } = req.body;
  db.query(`UPDATE transactions SET status='rejected' WHERE id=?`, [transaction_id], (err) => {
    if(err) return res.json({ success:false, message:"Reject failed" });
    res.json({ success:true, message:"Transaction rejected" });
  });
});

// ================= TRANSACTION HISTORY =================
app.get("/api/transactions/:user_id", (req, res) => {
  db.query(`SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC`, [req.params.user_id], (err, results) => {
    if (err) return res.json({ success:false, message:"Failed to load transactions" });
    res.json({ success:true, transactions:results });
  });
});

// ================= ADMIN USERS =================
app.get("/api/admin/users", verifyAdmin, (req, res) => {
  db.query(`SELECT id, name, email, balance, roi_total, referral_earnings, referral_code, status, created_at FROM users ORDER BY id DESC`, (err, results) => {
    if (err) return res.json({ success:false });
    res.json({ success:true, users:results });
  });
});

// ================= SUSPEND USER ================
app.post("/api/admin/suspend-user", verifyAdmin, (req, res) => {
  db.query(`UPDATE users SET status='suspended' WHERE id=?`, [req.body.user_id], (err) => {
    if (err) return res.json({ success:false });
    res.json({ success:true, message:"User suspended" });
  });
});

// ================= ACTIVATE USER =================
app.post("/api/admin/activate-user", verifyAdmin, (req, res) => {
  db.query(`UPDATE users SET status='active' WHERE id=?`, [req.body.user_id], (err) => {
    if (err) return res.json({ success:false });
    res.json({ success:true, message:"User activated" });
  });
});

// ================= DELETE USER =================
app.post("/api/admin/delete-user", verifyAdmin, (req, res) => {
  db.query("DELETE FROM users WHERE id=?", [req.body.user_id], (err) => {
    if (err) return res.json({ success:false });
    res.json({ success:true, message:"User deleted" });
  });
});

// ================= UPDATE PROFILE =================
app.post("/api/update-profile", verifyToken, async (req, res) => {
  const { user_id, name, phone, password } = req.body;
  try{
    if(password && password.trim() !== ""){
      const hashed = await bcrypt.hash(password, 10);
      db.query(`UPDATE users SET name=?, phone=?, password=? WHERE id=?`, [name, phone, hashed, user_id], (err) => {
        if(err) return res.json({ success:false, message:"Update failed" });
        res.json({ success:true, message:"Profile updated" });
      });
    }else{
      db.query(`UPDATE users SET name=?, phone=? WHERE id=?`, [name, phone, user_id], (err) => {
        if(err) return res.json({ success:false, message:"Update failed" });
        res.json({ success:true, message:"Profile updated" });
      });
    }
  }catch(err){
    res.json({ success:false, message:"Server error" });
  }
});

// ================= ADMIN UPDATE BALANCE =================
app.post("/api/admin/update-balance", verifyAdmin, (req, res) => {
  const { user_id, amount, action } = req.body;
  let sql = action === "add" ? `UPDATE users SET balance = balance + ? WHERE id=?` : `UPDATE users SET balance = balance - ? WHERE id=?`;

  db.query(sql, [amount, user_id], (err) => {
    if(err) return res.json({ success:false, message:"Balance update failed" });
    db.query(`INSERT INTO notifications (user_id,message) VALUES(?,?)`, [user_id, action === "add" ? `$${amount} added to your balance` : `$${amount} deducted from your balance`]);
    res.json({ success:true, message:"Balance updated" });
  });
});

// ================= ADMIN STATS =================
app.get("/api/admin/stats", verifyAdmin, (req, res) => {
  const stats = {};
  db.query("SELECT COUNT(*) AS totalUsers FROM users", (err, users) => {
    stats.totalUsers = users[0].totalUsers;
    db.query("SELECT SUM(amount) AS totalDeposits FROM transactions WHERE type='deposit' AND status='approved'", (err, deposits) => {
      stats.totalDeposits = deposits[0].totalDeposits || 0;
      db.query("SELECT SUM(amount) AS totalWithdrawals FROM transactions WHERE type='withdrawal' AND status='approved'", (err, withdrawals) => {
        stats.totalWithdrawals = withdrawals[0].totalWithdrawals || 0;
        db.query("SELECT SUM(balance) AS totalBalance FROM users", (err, balances) => {
          stats.totalBalance = balances[0].totalBalance || 0;
          db.query("SELECT COUNT(*) AS activeInvestments FROM investments WHERE status='active'", (err, activeInv) => {
            stats.activeInvestments = activeInv[0].activeInvestments;
            res.json({ success: true, stats });
          });
        });
      });
    });
  });
});

// ================= PENDING TRANSACTIONS =================
app.get("/api/admin/pending", verifyAdmin, (req, res) => {
  db.query("SELECT * FROM transactions WHERE type='deposit' AND status='pending'", (err, results) => {
    res.json({ success: true, transactions: results });
  });
});

app.get("/api/admin/pending-withdrawals", verifyAdmin, (req, res) => {
  db.query("SELECT * FROM transactions WHERE type='withdrawal' AND status='pending'", (err, results) => {
    res.json({ success: true, transactions: results });
  });
});

// ================= ROUTINE DAILY ROI & EXPIRATION WARNING ENGINE =================
function runDailyROIEngine() {
  db.query(
    `SELECT investments.id, investments.user_id, investments.amount, investments.end_date, investments.last_roi_date, investments.principal_returned, plans.name AS plan_name, plans.daily_roi_percent FROM investments LEFT JOIN plans ON investments.plan_id = plans.id WHERE investments.status='active'`,
    (err, investments) => {
      if (err || !investments) return;

      investments.forEach((inv) => {
        const now = new Date();
        const endDate = new Date(inv.end_date);

        if (now >= endDate) {
          if (inv.principal_returned === 1) return;
          db.query(`UPDATE investments SET status='completed', principal_returned=1 WHERE id=?`, [inv.id], (err) => {
            if (err) return;
            db.query(`UPDATE users SET balance = balance + ? WHERE id=?`, [inv.amount, inv.user_id]);
            db.query(`INSERT INTO notifications(user_id,message) VALUES(?,?)`, [inv.user_id, `Investment completed. Principal of $${inv.amount} returned to balance`]);
          });
          return;
        }

        const today = now.toISOString().split("T")[0];
        let lastDate = inv.last_roi_date ? new Date(inv.last_roi_date).toISOString().split("T")[0] : null;
        if (today === lastDate) return;

        const roi = (parseFloat(inv.amount) * parseFloat(inv.daily_roi_percent)) / 100;
        db.query(`UPDATE users SET balance = balance + ?, roi_total = roi_total + ? WHERE id=?`, [roi, roi, inv.user_id], (err) => {
          if (err) return;
          db.query("UPDATE investments SET last_roi_date=NOW() WHERE id=?", [inv.id]);
          db.query("INSERT INTO notifications(user_id,message) VALUES(?,?)", [inv.user_id, `Daily ROI added: $${roi.toFixed(2)}`]);
        });
      });
    }
  );

  // --- AUTOMATED EXPIRATION CRON LOOP ---
  db.query(
    `SELECT i.*, u.email, u.name FROM investments i 
     JOIN users u ON i.user_id = u.id 
     WHERE i.status = 'active' 
       AND i.end_date <= DATE_ADD(NOW(), INTERVAL 1 DAY) 
       AND i.end_date > NOW() 
       AND i.warning_sent IS NOT TRUE`,
    (err, expiringSoon) => {
      if (err || !expiringSoon || expiringSoon.length === 0) return;

      expiringSoon.forEach((inv) => {
        sendGikazeeEmail(inv.email, "Action Required: Your Investment Package Completes Tomorrow! 🚨", `
          <div style="font-family: Arial, sans-serif; max-width: 600px; color: #334155; line-height: 1.6;">
            <h2 style="color: #dc2626;">GIKAZEE PROTECTION SYSTEM</h2>
            <p>Hello ${inv.name || 'Investor'},</p>
            <p>This is an automated operational notification regarding your active contract: <strong>${inv.plan_name || 'VIP Package'} ($${inv.amount})</strong>.</p>
            <p>Your asset cycle is scheduled to reach official maturity tomorrow. To prevent your financial capital from laying idle without yield generation, we highly recommend planning your next step:</p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h4 style="margin:0 0 10px 0; color:#2563eb;">⚡ Maximize Your Return Strategies:</h4>
              <ul style="margin:0; padding-left:20px;">
                <li><strong>Top-Up Option:</strong> Add capital to automatically step up your tier to unlock better premium daily interest rates.</li>
                <li><strong>Compounding Rollover:</strong> Re-invest your processed balance immediately tomorrow to keep the compound interest machine ticking seamlessly.</li>
              </ul>
            </div>
            <p>Head over to your GIKAZEE user dashboard and execute a fresh plan allocation to ensure your daily profit stream remains active without interruptions!</p>
            <hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;">
            <small style="color: #94a3b8;">&copy; 2026 GIKAZEE Liquidity Portfolios.</small>
          </div>
        `);
        db.query("UPDATE investments SET warning_sent = 1 WHERE id = ?", [inv.id]);
      });
    }
  );
}

// Sweeps both cycles perfectly every 5 minutes
setInterval(runDailyROIEngine, 300000);

// ================= VERIFY ADMIN & ANNOUNCEMENTS =================
app.get("/api/admin/verify", verifyAdmin, (req, res) => {
  res.json({ success:true });
});

let latestAnnouncement = "Welcome to GIKAZEE Investment Pool!";

app.post("/api/admin/announcement", verifyAdmin, (req, res) => {
  latestAnnouncement = req.body.message;
  res.json({ success:true, message:"Announcement posted" });
});

app.get("/api/announcement", (req, res) => {
  res.json({ success:true, message: latestAnnouncement });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});