require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");

const app = express();

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

    cb(
      null,
      Date.now() +
      path.extname(file.originalname)
    );

  }

});

const upload = multer({
  storage: storage
});

// ================= DATABASE =================

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

// ================= CONNECT =================

db.connect((err) => {
  if (err) {
    console.log("DB ERROR:", err);
  } else {
    console.log("MySQL Connected");
  }
});

// ================= JWT MIDDLEWARE =================

function verifyToken(req, res, next){

  const token = req.headers.authorization;

  if(!token){

    return res.status(401).json({
      success:false,
      message:"Access denied"
    });

  }

  try{

    const verified = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.user = verified;

    next();

  }catch(err){

    return res.status(401).json({
      success:false,
      message:"Invalid token"
    });

  }

}

// ================= ADMIN MIDDLEWARE =================

function verifyAdmin(req, res, next){

  verifyToken(req, res, () => {

    if(!req.user.isAdmin){

      return res.status(403).json({
        success:false,
        message:"Admin only"
      });

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

  const {
  name,
  email,
  password,
  referral_code
} = req.body;


  try {

    const hashedPassword = await bcrypt.hash(password, 10);
     const myReferralCode =
  "GIKA" + Math.floor(1000 + Math.random() * 9000);
    db.query(

  `INSERT INTO users
(
  name,
  email,
  password,
  balance,
  roi_total,
  referral_code,
  referred_by,
  status
)
VALUES(?,?,?,?,?,?,?,?)`,

  [
    name,
    email,
    hashedPassword,
    0,
    0,
    myReferralCode,
    referral_code || null,
    "active"
  ],
      (err) => {

        if (err) {
          return res.json({
            success: false,
            message: "Registration failed"
          });
        }

        res.json({
          success: true,
          message: "Registration successful"
        });

      }
    );

  } catch (error) {

    res.json({
      success: false,
      message: "Server error"
    });

  }

});

// ================= LOGIN =================

app.post("/api/login", (req, res) => {

  const { email, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE email=?",
    [email],
    async (err, results) => {

      if (err || results.length === 0) {
        return res.json({
          success: false,
          message: "User not found"
        });
      }

      const user = results[0];
       
      if(user.status === "suspended"){

  return res.json({
    success:false,
    message:"Account suspended"
  });

}
      const match = await bcrypt.compare(
        password,
        user.password
      );

      if (!match) {
        return res.json({
          success: false,
          message: "Invalid password"
        });
      }

      let isAdmin = false;

      if (user.email === "admin@gikazee.com") {
        isAdmin = true;
      }

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          isAdmin
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "1d"
        }
      );

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          isAdmin
        }
      });

    }
  );

});

// ================= DASHBOARD =================

app.get(
  "/api/dashboard/:user_id",
  verifyToken,
  (req, res) => {

  const user_id = req.user.id;

  db.query(
    "SELECT * FROM users WHERE id=?",
    [user_id],
    (err, users) => {

      if (err || users.length === 0) {

        return res.json({
          success: false
        });

      }

      db.query(
        `SELECT investments.*,
        plans.name AS plan_name,
        plans.daily_roi_percent
        FROM investments
        LEFT JOIN plans
        ON investments.plan_id = plans.id
        WHERE investments.user_id=?`,
        [user_id],
        (err, investments) => {

          db.query(
            "SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC",
            [user_id],
            (err, notifications) => {

              res.json({
                success: true,
                user: users[0],
                investments,
                notifications
              });

            }
          );

        }
      );

    }
  );

});

// ================= DEPOSIT =================
 
app.post(

  "/api/deposit",

  verifyToken,

  upload.single("proof"),

  (req, res) => {

    const user_id = req.body.user_id;

    const amount = req.body.amount;

    const payment_method =
      req.body.payment_method;

      const payment_details =
       req.body.payment_details;

    const proof_image =
      req.file
      ? req.file.filename
      : null;

    db.query(

      `
      INSERT INTO transactions
      (
        user_id,
        type,
        amount,
        status,
        payment_method,
        payment_details,
        proof_image
      )
      VALUES(?,?,?,?,?,?,?)
      `,

      [
        user_id,
        "deposit",
        amount,
        "pending",
        payment_method,
        payment_details,
        proof_image
      ],

      (err) => {

        if(err){

          console.log(err);

          return res.json({
            success:false,
            message:"Deposit failed"
          });

        }

        res.json({
          success:true,
          message:"Deposit submitted successfully"
        });

      }

    );

  }

);

// ================= WITHDRAW =================

app.post("/api/withdraw", verifyToken, (req, res) => {

  const {
    user_id,
    amount,
    payment_method,
    payment_details
  } = req.body;

  db.query(

    `INSERT INTO transactions
    (
      user_id,
      type,
      amount,
      status,
      payment_method,
      payment_details
    )
    VALUES(?,?,?,?,?,?)`,

    [
      user_id,
      "withdrawal",
      amount,
      "pending",
      payment_method,
      payment_details
    ],

    (err) => {

      if(err){

        console.log(err);

        return res.json({
          success:false,
          message:"Withdrawal failed"
        });

      }

      res.json({

        success:true,
        message:"Withdrawal request submitted"

      });

    }

  );

});

// ================= INVEST =================

app.post(
  "/api/invest",
  verifyToken,
  (req, res) => {

  const user_id = parseInt(req.body.user_id);
  const plan_id = parseInt(req.body.plan_id);
  const amount = parseFloat(req.body.amount);

  db.query(
    "SELECT * FROM plans WHERE id=?",
    [plan_id],
    (err, plans) => {

      if (err || plans.length === 0) {
        return res.json({
          success: false,
          message: "Plan not found"
        });
      }

      const plan = plans[0];

      if (
        amount < parseFloat(plan.min_amount) ||
        amount > parseFloat(plan.max_amount)
      ) {
        return res.json({
          success: false,
          message:
            "Amount must be between $" +
            plan.min_amount +
            " and $" +
            plan.max_amount
        });
      }

      db.query(
        "SELECT balance FROM users WHERE id=?",
        [user_id],
        (err, users) => {

          if (parseFloat(users[0].balance) < amount) {
            return res.json({
              success: false,
              message: "Insufficient balance"
            });
          }

          db.query(
            "UPDATE users SET balance = balance - ? WHERE id=?",
            [amount, user_id]
          );

          db.query(
            `INSERT INTO investments
            (user_id,plan_id,amount,status,start_date,end_date)
            VALUES(?,?,?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
            [
              user_id,
              plan_id,
              amount,
              "active",
              plan.duration_days
            ],
            (err) => {

              if (err) {
                console.log(err);

                return res.json({
                  success: false,
                  message: "Investment failed"
                });
              }

              db.query(
                "INSERT INTO notifications(user_id,message) VALUES(?,?)",
                [
                  user_id,
                  "Investment started successfully"
                ]
              );

 // ================= REFERRAL COMMISSION =================

db.query(
  "SELECT * FROM users WHERE id=?",
  [user_id],
  (err, currentUsers) => {

    if (
      err ||
      currentUsers.length === 0
    ) {
      return;
    }

    const currentUser = currentUsers[0];

    if (
      !currentUser.referred_by
    ) {
      return;
    }

    db.query(
      "SELECT * FROM users WHERE referral_code=?",
      [currentUser.referred_by],
      (err, refUsers) => {

        if (
          err ||
          refUsers.length === 0
        ) {
          return;
        }

        const referrer = refUsers[0];

        // anti self referral
        if (
          referrer.id === currentUser.id
        ) {
          return;
        }

        // 5% commission
        const commission =
          amount * 0.05;

        db.query(
          `UPDATE users
           SET
           balance = balance + ?,
           referral_earnings =
           referral_earnings + ?
           WHERE id=?`,
          [
            commission,
            commission,
            referrer.id
          ]
        );

        db.query(
          `INSERT INTO referral_commissions
          (
            referrer_user_id,
            referred_user_id,
            investment_id,
            amount
          )
          VALUES(?,?,?,?)`,
          [
            referrer.id,
            currentUser.id,
            0,
            commission
          ]
        );

        db.query(
          `INSERT INTO notifications
          (user_id,message)
          VALUES(?,?)`,
          [
            referrer.id,
            `Referral commission earned: $${commission.toFixed(2)}`
          ]
        );

        console.log(
          "Referral commission paid"
        );

      }
    );

  }
);             
              res.json({
                success: true,
                message: "Investment started"
              });

            }
          );

        }
      );

    }
  );

});

// ================= APPROVE =================

app.post(
  "/api/admin/approve",
  verifyAdmin,
  (req, res) => {

    const { transaction_id } = req.body;

    db.query(

      "SELECT * FROM transactions WHERE id=?",

      [transaction_id],

      (err, results) => {

        if(err || results.length === 0){

          return res.json({
            success:false,
            message:"Transaction not found"
          });

        }

        const tx = results[0];

        // ================= DEPOSIT APPROVAL =================

        if(tx.type === "deposit"){

          db.query(

            "UPDATE transactions SET status='approved' WHERE id=?",

            [transaction_id]

          );

          db.query(

            "UPDATE users SET balance = balance + ? WHERE id=?",

            [tx.amount, tx.user_id]

          );

          db.query(

            "INSERT INTO notifications(user_id,message) VALUES(?,?)",

            [
              tx.user_id,
              "Your deposit has been approved"
            ]

          );

          return res.json({

            success:true,
            message:"Deposit approved"

          });

        }

        // ================= WITHDRAWAL APPROVAL =================

        if(tx.type === "withdrawal"){

          db.query(

            "SELECT balance FROM users WHERE id=?",

            [tx.user_id],

            (err, users) => {

              if(err || users.length === 0){

                return res.json({

                  success:false,
                  message:"User not found"

                });

              }

              const currentBalance =
                parseFloat(users[0].balance);

              if(currentBalance < parseFloat(tx.amount)){

                return res.json({

                  success:false,
                  message:"Insufficient user balance"

                });

              }

              db.query(

                "UPDATE transactions SET status='approved' WHERE id=?",

                [transaction_id]

              );

              db.query(

                "UPDATE users SET balance = balance - ? WHERE id=?",

                [tx.amount, tx.user_id]

              );

              db.query(

                "INSERT INTO notifications(user_id,message) VALUES(?,?)",

                [
                  tx.user_id,
                  "Your withdrawal has been approved"
                ]

              );

              return res.json({

                success:true,
                message:"Withdrawal approved"

              });

            }

          );

        }

      }

    );

  }

);

// ================= REJECT TRANSACTION =================

app.post(
  "/api/admin/reject",
  verifyAdmin,
  (req, res) => {

    const { transaction_id } = req.body;

    db.query(

      `
      UPDATE transactions
      SET status='rejected'
      WHERE id=?
      `,

      [transaction_id],

      (err) => {

        if(err){

          console.log(err);

          return res.json({
            success:false,
            message:"Reject failed"
          });

        }

        res.json({
          success:true,
          message:"Transaction rejected"
        });

      }

    );

  }

);

// ================= TRANSACTION HISTORY =================

app.get("/api/transactions/:user_id", (req, res) => {

  const user_id = req.params.user_id;

  db.query(

    `SELECT *
     FROM transactions
     WHERE user_id=?
     ORDER BY id DESC`,

    [user_id],

    (err, results) => {

      if (err) {

        console.log(err);

        return res.json({
          success:false,
          message:"Failed to load transactions"
        });

      }

      res.json({
        success:true,
        transactions:results
      });

    }

  );

});

// ================= ADMIN USERS =================

app.get(
  "/api/admin/users",
  verifyAdmin,
  (req, res) => {

  db.query(

    `SELECT
      id,
      name,
      email,
      balance,
      roi_total,
      referral_earnings,
      referral_code,
      status,
      created_at
     FROM users
     ORDER BY id DESC`,

    (err, results) => {

      if (err) {

        console.log(err);

        return res.json({
          success:false
        });

      }

      res.json({
        success:true,
        users:results
      });

    }

  );

});

// ================= SUSPEND USER =================

app.post(
  "/api/admin/suspend-user",
  verifyAdmin,
  (req, res) => {

  const { user_id } = req.body;

  db.query(

    `UPDATE users
     SET status='suspended'
     WHERE id=?`,

    [user_id],

    (err) => {

      if (err) {

        return res.json({
          success:false
        });

      }

      res.json({
        success:true,
        message:"User suspended"
      });

    }

  );

});

// ================= ACTIVATE USER =================

app.post(
  "/api/admin/activate-user",
  verifyAdmin,
  (req, res) => {

  const { user_id } = req.body;

  db.query(

    `UPDATE users
     SET status='active'
     WHERE id=?`,

    [user_id],

    (err) => {

      if (err) {

        return res.json({
          success:false
        });

      }

      res.json({
        success:true,
        message:"User activated"
      });

    }

  );

});

// ================= DELETE USER =================

app.post(
  "/api/admin/delete-user",
  verifyAdmin,
  (req, res) => {

  const { user_id } = req.body;

  db.query(

    "DELETE FROM users WHERE id=?",

    [user_id],

    (err) => {

      if (err) {

        return res.json({
          success:false
        });

      }

      res.json({
        success:true,
        message:"User deleted"
      });

    }

  );

});

// ================= UPDATE PROFILE =================

app.post(
  "/api/update-profile",
  verifyToken,
  async (req, res) => {

    const {
      user_id,
      name,
      phone,
      password
    } = req.body;

    try{

      if(password && password.trim() !== ""){

        const hashed =
          await bcrypt.hash(password, 10);

        db.query(

          `
          UPDATE users
          SET
          name=?,
          phone=?,
          password=?
          WHERE id=?
          `,

          [
            name,
            phone,
            hashed,
            user_id
          ],

          (err) => {

            if(err){

              console.log(err);

              return res.json({
                success:false,
                message:"Profile update failed"
              });

            }

            res.json({
              success:true,
              message:"Profile updated"
            });

          }

        );

      }else{

        db.query(

          `
          UPDATE users
          SET
          name=?,
          phone=?
          WHERE id=?
          `,

          [
            name,
            phone,
            user_id
          ],

          (err) => {

            if(err){

              console.log(err);

              return res.json({
                success:false,
                message:"Profile update failed"
              });

            }

            res.json({
              success:true,
              message:"Profile updated"
            });

          }

        );

      }

    }catch(err){

      console.log(err);

      res.json({
        success:false,
        message:"Server error"
      });

    }

  }

);

// ================= ADMIN UPDATE BALANCE =================

app.post(
  "/api/admin/update-balance",
  verifyAdmin,
  (req, res) => {

    const {
      user_id,
      amount,
      action
    } = req.body;

    let sql = "";

    if(action === "add"){

      sql =
      `
      UPDATE users
      SET balance = balance + ?
      WHERE id=?
      `;

    }else{

      sql =
      `
      UPDATE users
      SET balance = balance - ?
      WHERE id=?
      `;

    }

    db.query(

      sql,

      [amount, user_id],

      (err) => {

        if(err){

          console.log(err);

          return res.json({
            success:false,
            message:"Balance update failed"
          });

        }

        db.query(

          `
          INSERT INTO notifications
          (user_id,message)
          VALUES(?,?)
          `,

          [
            user_id,

            action === "add"

            ?

            `$${amount} added to your balance`

            :

            `$${amount} deducted from your balance`
          ]

        );

        res.json({
          success:true,
          message:"Balance updated"
        });

      }

    );

  }

);

// ================= ADMIN STATS =================

app.get(
  "/api/admin/stats",
  verifyAdmin,
  (req, res) => {

  const stats = {};

  db.query(
    "SELECT COUNT(*) AS totalUsers FROM users",
    (err, users) => {

      stats.totalUsers = users[0].totalUsers;

      db.query(
        "SELECT SUM(amount) AS totalDeposits FROM transactions WHERE type='deposit' AND status='approved'",
        (err, deposits) => {

          stats.totalDeposits = deposits[0].totalDeposits || 0;

          db.query(
            "SELECT SUM(amount) AS totalWithdrawals FROM transactions WHERE type='withdrawal' AND status='approved'",
            (err, withdrawals) => {

              stats.totalWithdrawals = withdrawals[0].totalWithdrawals || 0;

              db.query(
                "SELECT SUM(balance) AS totalBalance FROM users",
                (err, balances) => {

                  stats.totalBalance = balances[0].totalBalance || 0;

                  db.query(
                    "SELECT COUNT(*) AS activeInvestments FROM investments WHERE status='active'",
                    (err, activeInv) => {

                      stats.activeInvestments = activeInv[0].activeInvestments;

                      res.json({
                        success: true,
                        stats
                      });

                    }
                  );

                }
              );

            }
          );

        }
      );

    }
  );

});

// ================= PENDING =================

app.get(
  "/api/admin/pending",
  verifyAdmin,
  (req, res) => {

  db.query(
    "SELECT * FROM transactions WHERE type='deposit' AND status='pending'",
    (err, results) => {

      res.json({
        success: true,
        transactions: results
      });

    }
  );

});

app.get(
  "/api/admin/pending-withdrawals",
  verifyAdmin,
  (req, res) => {

  db.query(
    "SELECT * FROM transactions WHERE type='withdrawal' AND status='pending'",
    (err, results) => {

      res.json({
        success: true,
        transactions: results
      });

    }
  );

});

// ================= DAILY ROI ENGINE =================

function runDailyROI() {

  db.query(
    `
    SELECT
      investments.id,
      investments.user_id,
      investments.amount,
      investments.end_date,
      investments.last_roi_date,
      investments.principal_returned,
      plans.daily_roi_percent
    FROM investments
    LEFT JOIN plans
    ON investments.plan_id = plans.id
    WHERE investments.status='active'
    `,
    (err, investments) => {

      if (err) {
        console.log(err);
        return;
      }

      investments.forEach((inv) => {

        const now = new Date();

        const endDate = new Date(inv.end_date);


          if (now >= endDate) {

  if (inv.principal_returned === 1) {
    return;
  }

  db.query(
    `UPDATE investments
     SET status='completed',
     principal_returned=1
     WHERE id=?`,
    [inv.id],
    (err) => {

      if (err) {
        console.log(err);
        return;
      }

      db.query(
        `UPDATE users
         SET balance = balance + ?
         WHERE id=?`,
        [inv.amount, inv.user_id]
      );

      db.query(
        `INSERT INTO notifications(user_id,message)
         VALUES(?,?)`,
        [
          inv.user_id,
          `Investment completed. Principal of $${inv.amount} returned to your balance`
        ]
      );

      console.log(
        `Investment ${inv.id} completed successfully`
      );

    }
  );

  return;
}

        const today = now.toISOString().split("T")[0];

        let lastDate = null;

        if (inv.last_roi_date) {
          lastDate = new Date(inv.last_roi_date)
          .toISOString()
          .split("T")[0];
        }

        if (today === lastDate) {
          return;
        }

        const roi =
          (parseFloat(inv.amount) *
          parseFloat(inv.daily_roi_percent)) / 100;

        db.query(
          `UPDATE users
          SET
          balance = balance + ?,
          roi_total = roi_total + ?
          WHERE id=?`,
          [roi, roi, inv.user_id],
          (err) => {

            if (err) {
              console.log(err);
              return;
            }

            db.query(
              "UPDATE investments SET last_roi_date=NOW() WHERE id=?",
              [inv.id]
            );

            db.query(
              "INSERT INTO notifications(user_id,message) VALUES(?,?)",
              [
                inv.user_id,
                `Daily ROI added: $${roi.toFixed(2)}`
              ]
            );

            console.log("ROI Added:", roi);

          }
        );

      });

    }
  );

}

//-------test ervery 24 hou---------//
setInterval(runDailyROI,86400000)

// ================= VERIFY ADMIN =================

app.get(
  "/api/admin/verify",
  verifyAdmin,
  (req, res) => {

    res.json({
      success:true
    });

  }
);

// ================= CREATE ANNOUNCEMENT =================

app.post(
  "/api/admin/announcement",
  verifyAdmin,
  (req, res) => {

    const { message } = req.body;

    db.query(

      `
      INSERT INTO announcements
      (message,status)
      VALUES(?,?)
      `,

      [
        message,
        "active"
      ],

      (err) => {

        if(err){

          console.log(err);

          return res.json({
            success:false,
            message:"Failed"
          });

        }

        res.json({
          success:true,
          message:"Announcement posted"
        });

      }

    );

  }

);

// ================= GET ACTIVE ANNOUNCEMENT =================

app.get(
  "/api/announcement",
  (req, res) => {

    db.query(

      `
      SELECT *
      FROM announcements
      WHERE status='active'
      ORDER BY id DESC
      LIMIT 1
      `,

      (err, results) => {

        if(err){

          console.log(err);

          return res.json({
            success:false
          });

        }

        res.json({
          success:true,
          announcement:
            results[0] || null
        });

      }

    );

  }

);

// ================= SAVE ANNOUNCEMENT =================

let latestAnnouncement = "";

// admin post
app.post(
  "/api/admin/announcement",
  verifyAdmin,
  (req,res)=>{

    latestAnnouncement =
      req.body.message;

    res.json({
      success:true,
      message:"Announcement posted"
    });

  }
);

// user fetch
app.get(
  "/api/announcement",
  (req,res)=>{

    res.json({
      success:true,
      message:latestAnnouncement
    });

  }
);

// ================= SERVER =================
app.get("/create-tables", async (req, res) => {

  const queries = [

`CREATE TABLE IF NOT EXISTS users (
id INT AUTO_INCREMENT PRIMARY KEY,
name VARCHAR(255) NOT NULL,
email VARCHAR(255) UNIQUE NOT NULL,
password VARCHAR(255) NOT NULL,
phone VARCHAR(50),
balance DECIMAL(15,2) DEFAULT 0,
roi_total DECIMAL(15,2) DEFAULT 0,
referral_earnings DECIMAL(15,2) DEFAULT 0,
referral_code VARCHAR(100),
referred_by VARCHAR(100),
status VARCHAR(50) DEFAULT 'active',
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,

`CREATE TABLE IF NOT EXISTS plans (
id INT AUTO_INCREMENT PRIMARY KEY,
name VARCHAR(100) NOT NULL,
min_amount DECIMAL(15,2) NOT NULL,
max_amount DECIMAL(15,2) NOT NULL,
daily_roi_percent DECIMAL(10,2) NOT NULL,
duration_days INT NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,

`CREATE TABLE IF NOT EXISTS investments (
id INT AUTO_INCREMENT PRIMARY KEY,
user_id INT NOT NULL,
plan_id INT NOT NULL,
amount DECIMAL(15,2) NOT NULL,
status VARCHAR(50) DEFAULT 'active',
start_date DATETIME,
end_date DATETIME,
last_roi_date DATETIME NULL,
principal_returned TINYINT(1) DEFAULT 0,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,

`CREATE TABLE IF NOT EXISTS transactions (
id INT AUTO_INCREMENT PRIMARY KEY,
user_id INT NOT NULL,
type VARCHAR(50) NOT NULL,
amount DECIMAL(15,2) NOT NULL,
status VARCHAR(50) DEFAULT 'pending',
payment_method VARCHAR(255),
payment_details TEXT,
proof_image VARCHAR(255),
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,

`CREATE TABLE IF NOT EXISTS notifications (
id INT AUTO_INCREMENT PRIMARY KEY,
user_id INT NOT NULL,
message TEXT NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,

`CREATE TABLE IF NOT EXISTS announcements (
id INT AUTO_INCREMENT PRIMARY KEY,
message TEXT NOT NULL,
status VARCHAR(50) DEFAULT 'active',
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,

`CREATE TABLE IF NOT EXISTS referral_commissions (
id INT AUTO_INCREMENT PRIMARY KEY,
referrer_user_id INT NOT NULL,
referred_user_id INT NOT NULL,
investment_id INT,
amount DECIMAL(15,2) NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`

  ];

  for (const sql of queries) {
    await new Promise((resolve, reject) => {
      db.query(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  db.query(
    `INSERT INTO plans
    (name,min_amount,max_amount,daily_roi_percent,duration_days)
    VALUES
    ('Starter',50,499,2,30),
    ('Silver',500,1999,3,30),
    ('Gold',2000,9999,4,30),
    ('VIP',10000,1000000,5,30)`,
    () => {}
  );

  res.send("All tables created successfully");

});
app.listen(process.env.PORT || 3001, () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`);
});