/* ============================================================
   Enrollment System — app logic
   ------------------------------------------------------------
   This is a self-contained front-end demo: it uses localStorage
   as a stand-in "database" so the whole thing runs from
   index.html with no server. Swap `loadDB` / `saveDB` for real
   API calls when you wire this up to an actual back end
   (PHP/Node/etc.) + database (MySQL/MariaDB/etc.).

   NOTE ON SECURITY: passwords are stored in localStorage in
   plain text for demo purposes only. In a real deployment,
   passwords must be hashed (e.g. bcrypt) and checked server-side
   — never trust or store real passwords client-side like this.
   ============================================================ */

"use strict";

const DB_KEY = "ems_db_v1";
const SESSION_KEY = "ems_session_v1";
const PASSING_GRADE = 75;
const AY = "2025-2026";
const SEMESTERS = ["1st Semester", "2nd Semester"];

/* ---------------------------- helpers ---------------------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const uid = (prefix) => prefix + "-" + Math.random().toString(36).slice(2, 8);
const todayISO = () => new Date().toISOString().slice(0, 10);
const money = (n) => "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso) => {
  if (!iso) return "—";
  // Accepts either a plain "YYYY-MM-DD" date or a full ISO datetime string.
  const d = iso.includes("T") ? new Date(iso) : new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const initials = (name) => name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

/* ---------------------------- seed data ---------------------------- */
function seedDB() {
  const students = [
    { studentId: "2024-000087", name: "Jose Miguel Cruz", course: "BS Computer Science", year: "1st Year", email: "jmcruz@example.com", contact: "", address: "", document: null },
    { studentId: "2024-000091", name: "Patricia Mae Villanueva", course: "BS Computer Science", year: "1st Year", email: "pmvillanueva@example.com", contact: "", address: "", document: null },
    { studentId: "2025-000123", name: "Cherry-An Dorado", course: "BS Computer Science", year: "2nd Year", email: "cherryan@gmail.com", contact: "09123456789", address: "San Pedro, Laguna", document: null },
    { studentId: "2025-000124", name: "Mark Anthony Reyes", course: "BS Information Technology", year: "1st Year", email: "mareyes@example.com", contact: "", address: "", document: null },
    { studentId: "2025-000125", name: "Angelica Santos", course: "BS Computer Science", year: "2nd Year", email: "asantos@example.com", contact: "", address: "", document: null },
    { studentId: "2025-000131", name: "Rafael Lim", course: "BS Computer Science", year: "1st Year", email: "rlim@example.com", contact: "", address: "", document: null },
  ];

  const users = [
    { id: "u-admin", username: "admin", password: "admin123", role: "admin", name: "Admin" },
    { id: "u-registrar", username: "registrar", password: "registrar123", role: "registrar", name: "Cherry-An Dorado" },
    { id: "u-2025-000123", username: "2025-000123", password: "student123", role: "student", studentId: "2025-000123", name: "Cherry-An Dorado" },
  ];

  const subjects = [
    { code: "CS101", title: "Introduction to Computing", units: 3, schedule: "MW 8:00 - 10:00 AM" },
    { code: "CS102", title: "Web Development", units: 3, schedule: "TTh 10:00 AM - 12:00 PM" },
    { code: "CS103", title: "Database Systems", units: 3, schedule: "MW 1:00 - 3:00 PM" },
    { code: "CS104", title: "Object-Oriented Programming", units: 3, schedule: "TTh 1:00 - 3:00 PM" },
    { code: "CS105", title: "Systems Analysis and Design", units: 3, schedule: "F 8:00 - 11:00 AM" },
  ];

  // grades[studentId][semester][subjectCode] = { prelim, midterm, finals }
  const grades = {
    "2024-000087": { "1st Semester": { CS101: { prelim: "78", midterm: "80", finals: "82" } } },
    "2024-000091": { "1st Semester": {} },
    "2025-000123": { "1st Semester": {
      CS101: { prelim: "88", midterm: "90", finals: "91" },
      CS102: { prelim: "85", midterm: "82", finals: "" },
      CS103: { prelim: "80", midterm: "78", finals: "84" },
    } },
    "2025-000124": { "1st Semester": {
      CS101: { prelim: "86", midterm: "88", finals: "90" },
      CS102: { prelim: "79", midterm: "81", finals: "80" },
      CS103: { prelim: "72", midterm: "70", finals: "" },
      CS104: { prelim: "84", midterm: "101", finals: "" },
    } },
    "2025-000125": { "1st Semester": { CS101: { prelim: "92", midterm: "94", finals: "95" } } },
    "2025-000131": { "1st Semester": { CS101: { prelim: "85", midterm: "", finals: "" } } },
  };

  function paymentSet(paidFlags, dates, ors) {
    const items = ["Tuition", "Prelims", "Midterms", "Finals"];
    const amounts = [15000, 1500, 1500, 1500];
    const out = {};
    items.forEach((item, i) => {
      out[item] = {
        amount: amounts[i],
        paid: paidFlags[i],
        datePaid: paidFlags[i] ? dates[i] : "",
        orNo: paidFlags[i] ? ors[i] : "",
      };
    });
    return out;
  }

  // payments[studentId][semester] = { Tuition:{...}, Prelims:{...}, ... }
  const payments = {
    "2024-000087": {
      "1st Semester": paymentSet([true, true, false, false], ["2025-08-10", "2025-09-20", "", ""], ["OR-10005", "OR-10360", "", ""]),
      "2nd Semester": paymentSet([false, false, false, false], [], []),
    },
    "2024-000091": {
      "1st Semester": paymentSet([false, false, false, false], [], []),
      "2nd Semester": paymentSet([false, false, false, false], [], []),
    },
    "2025-000123": {
      "1st Semester": paymentSet([true, true, false, false], ["2025-08-11", "2025-09-22", "", ""], ["OR-10021", "OR-10388", "", ""]),
      "2nd Semester": paymentSet([false, false, false, false], [], []),
    },
    "2025-000124": {
      "1st Semester": paymentSet([true, true, true, true], ["2025-08-12", "2025-09-23", "2025-10-27", "2025-12-01"], ["OR-10030", "OR-10391", "OR-10502", "OR-10688"]),
      "2nd Semester": paymentSet([true, false, false, false], ["2026-01-12", "", "", ""], ["OR-11010", "", "", ""]),
    },
    "2025-000125": {
      "1st Semester": paymentSet([true, false, false, false], ["2025-08-13", "", "", ""], ["OR-10041", "", "", ""]),
      "2nd Semester": paymentSet([false, false, false, false], [], []),
    },
    "2025-000131": {
      "1st Semester": paymentSet([false, false, false, false], [], []),
      "2nd Semester": paymentSet([false, false, false, false], [], []),
    },
  };

  return { students, users, subjects, grades, payments, enrollments: [], notifications: [], orCounter: 11100 };
}

function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through to reseed */ }
  }
  const db = seedDB();
  saveDB(db);
  return db;
}
function saveDB(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

let DB = loadDB();

/* ---------------------------- session ---------------------------- */
function getSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
function setSession(userId) { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId })); }
function clearSession() { sessionStorage.removeItem(SESSION_KEY); }
function currentUser() {
  const s = getSession();
  if (!s) return null;
  return DB.users.find(u => u.id === s.userId) || null;
}
function currentStudent() {
  const u = currentUser();
  if (!u || u.role !== "student") return null;
  return DB.students.find(s => s.studentId === u.studentId) || null;
}

/* ---------------------------- grade logic ---------------------------- */
function isFieldInvalid(v) {
  if (v === "" || v === null || v === undefined) return false;
  const n = Number(v);
  return isNaN(n) || n < 0 || n > 100;
}
function getGrade(studentId, semester, code) {
  return (DB.grades[studentId] && DB.grades[studentId][semester] && DB.grades[studentId][semester][code]) || { prelim: "", midterm: "", finals: "" };
}
function setGrade(studentId, semester, code, field, value) {
  DB.grades[studentId] = DB.grades[studentId] || {};
  DB.grades[studentId][semester] = DB.grades[studentId][semester] || {};
  DB.grades[studentId][semester][code] = DB.grades[studentId][semester][code] || { prelim: "", midterm: "", finals: "" };
  DB.grades[studentId][semester][code][field] = value;
}
function computeSubject(g) {
  const vals = [g.prelim, g.midterm, g.finals];
  const filled = vals.filter(v => v !== "" && v !== null && v !== undefined);
  const anyInvalid = filled.some(isFieldInvalid);
  if (anyInvalid) return { final: null, remarks: "Invalid" };
  if (filled.length === 3) {
    const avg = (Number(vals[0]) + Number(vals[1]) + Number(vals[2])) / 3;
    const final = Math.round(avg * 100) / 100;
    return { final, remarks: final >= PASSING_GRADE ? "Passed" : "Failed" };
  }
  if (filled.length > 0) return { final: null, remarks: "In progress" };
  return { final: null, remarks: "—" };
}
function weightedAverage(studentId, semester) {
  let sumFU = 0, sumU = 0;
  DB.subjects.forEach(sub => {
    const comp = computeSubject(getGrade(studentId, semester, sub.code));
    if (comp.final !== null) { sumFU += comp.final * sub.units; sumU += sub.units; }
  });
  return sumU ? { avg: Math.round((sumFU / sumU) * 100) / 100, units: sumU } : null;
}
function remarkBadge(remarks) {
  if (remarks === "Passed") return `<span class="badge badge-green">Passed</span>`;
  if (remarks === "Failed") return `<span class="badge badge-red">Failed</span>`;
  if (remarks === "Invalid") return `<span class="badge badge-red">Invalid</span>`;
  if (remarks === "In progress") return `<span class="badge badge-blue">In progress</span>`;
  return `—`;
}

/* ---------------------------- payments ---------------------------- */
function nextOR() { DB.orCounter += 1; return "OR-" + DB.orCounter; }
function getPayments(studentId, semester) {
  DB.payments[studentId] = DB.payments[studentId] || {};
  if (!DB.payments[studentId][semester]) {
    DB.payments[studentId][semester] = {
      Tuition: { amount: 15000, paid: false, datePaid: "", orNo: "" },
      Prelims: { amount: 1500, paid: false, datePaid: "", orNo: "" },
      Midterms: { amount: 1500, paid: false, datePaid: "", orNo: "" },
      Finals: { amount: 1500, paid: false, datePaid: "", orNo: "" },
    };
  }
  return DB.payments[studentId][semester];
}
function paidCount(items) { return Object.values(items).filter(i => i.paid).length; }
function totalPaid(items) { return Object.values(items).reduce((s, i) => s + (i.paid ? Number(i.amount) : 0), 0); }

/* ---------------------------- notifications ---------------------------- */
function notify(userId, message) {
  DB.notifications.unshift({ id: uid("n"), userId, message, date: new Date().toISOString(), read: false });
}
function unreadCount(userId) { return DB.notifications.filter(n => n.userId === userId && !n.read).length; }

/* ============================================================
   AUTH — login / register
   ============================================================ */
$("#login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  const user = DB.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
  const err = $("#login-error");
  if (!user) {
    err.textContent = "Invalid username or password.";
    err.classList.remove("hidden");
    return;
  }
  err.classList.add("hidden");
  setSession(user.id);
  enterApp();
});

$("#show-register").addEventListener("click", (e) => {
  e.preventDefault();
  $("#login-pane").classList.add("hidden");
  $("#register-pane").classList.remove("hidden");
});
$("#show-login").addEventListener("click", (e) => {
  e.preventDefault();
  $("#register-pane").classList.add("hidden");
  $("#login-pane").classList.remove("hidden");
});

$("#register-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#reg-id").value.trim();
  const name = $("#reg-name").value.trim();
  const course = $("#reg-course").value;
  const year = $("#reg-year").value;
  const email = $("#reg-email").value.trim();
  const password = $("#reg-password").value;
  const err = $("#register-error");

  if (!id || !name || !email || !password) {
    err.textContent = "Please fill in all fields.";
    err.classList.remove("hidden");
    return;
  }
  if (password.length < 6) {
    err.textContent = "Password must be at least 6 characters.";
    err.classList.remove("hidden");
    return;
  }
  if (DB.students.some(s => s.studentId === id) || DB.users.some(u => u.username === id)) {
    err.textContent = "That Student ID is already registered.";
    err.classList.remove("hidden");
    return;
  }
  err.classList.add("hidden");

  DB.students.push({ studentId: id, name, course, year, email, contact: "", address: "", document: null });
  const newUser = { id: uid("u"), username: id, password, role: "student", studentId: id, name };
  DB.users.push(newUser);
  saveDB(DB);

  setSession(newUser.id);
  toast("Account created. Welcome, " + name.split(" ")[0] + "!");
  enterApp();
});

function logout() {
  clearSession();
  location.reload();
}

/* ============================================================
   APP BOOTSTRAP
   ============================================================ */
const NAV = {
  registrar: [
    ["dashboard", "dashboard.png.png", "Dashboard"],
    ["requests", "enrollment_request.png.png", "Enrollment Requests"],
    ["students", "profile.png.png", "Students"],
    ["sections", "section.png.png", "Sections"],
    ["classlists", "class_list.png.png", "Class Lists"],
    ["grades", "grades.png.png", "Grades"],
    ["payments", "payment.png.png", "Payments"],
  ],
  admin: [
    ["dashboard", "dashboard.png.png", "Dashboard"],
    ["requests", "enrollment_request.png.png", "Enrollment Requests"],
    ["students", "profile.png.png", "Students"],
    ["sections", "section.png.png", "Sections"],
    ["classlists", "class_list.png.png", "Class Lists"],
    ["grades", "grades.png.png", "Grades"],
    ["payments", "payment.png.png", "Payments"],
  ],
  student: [
    ["dashboard", "dashboard.png.png", "Dashboard"],
    ["profile", "profile.png.png", "Profile"],
    ["courses", "section.png.png", "Course Selection"],
    ["myenrollments", "enrollment_request.png.png", "My Enrollments"],
    ["mygrades", "grades.png.png", "My Grades"],
    ["mypayments", "payment.png.png", "My Payments"],
  ],
};

function buildNav(role) {
  const wrap = $("#nav-links");
  wrap.innerHTML = "";
  NAV[role].forEach(([route, iconSrc, label]) => {
    const a = document.createElement("div");
    a.className = "nav-link";
    a.dataset.route = route;
    a.innerHTML = `<img src="${iconSrc}" class="nav-icon" alt="${label}" /><span>${label}</span>`;
    a.addEventListener("click", () => { state.route = route; state.params = {}; render(); });
    wrap.appendChild(a);
  });

  const logoutEl = document.createElement("div");
  logoutEl.className = "nav-link logout";
  logoutEl.innerHTML = `<img src="logout.png.png" class="nav-icon" alt="Log Out" /><span>Log Out</span>`;
  logoutEl.addEventListener("click", logout);
  wrap.appendChild(logoutEl);
}

const state = { route: "dashboard", params: {}, gradeMode: "student", gradeStudentQuery: "", studentsFilterQuery: "", gradeSubjectCode: null, paymentOpenStudent: null };

function enterApp() {
  $("#login-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  const user = currentUser();
  state.route = "dashboard";
  buildNav(user.role);
  $("#user-avatar").textContent = initials(user.name);
  $("#user-name").textContent = user.name;
  $("#user-role").textContent = user.role[0].toUpperCase() + user.role.slice(1);
  $("#global-search").closest(".search-wrap").style.visibility = (user.role === "student") ? "hidden" : "visible";
  renderNotifDropdown();
  render();
}

function setActiveNav() {
  $all(".nav-link").forEach(el => el.classList.toggle("active", el.dataset.route === state.route));
}

function render() {
  setActiveNav();
  const user = currentUser();
  const root = $("#view-root");
  saveDB(DB);
  renderNotifDropdown();

  const registrarViews = {
    dashboard: renderRegistrarDashboard,
    requests: renderEnrollmentRequests,
    students: renderStudentsList,
    studentrecord: renderStudentRecord,
    sections: renderSections,
    classlists: renderClassLists,
    grades: renderGrades,
    payments: renderPaymentsList,
    paymentmanage: renderPaymentManage,
  };
  const studentViews = {
    dashboard: renderStudentDashboard,
    profile: renderProfile,
    courses: renderCourseSelection,
    myenrollments: renderMyEnrollments,
    mygrades: renderMyGrades,
    mypayments: renderMyPayments,
  };

  const table = (user.role === "student") ? studentViews : registrarViews;
  const fn = table[state.route] || table.dashboard;
  root.innerHTML = fn(user);
}

/* ============================================================
   REGISTRAR / ADMIN VIEWS
   ============================================================ */
function renderRegistrarDashboard(user) {
  const totalStudents = DB.students.length;
  const pending = DB.enrollments.filter(e => e.status === "pending").length;
  const approved = DB.enrollments.filter(e => e.status === "approved").length;
  const sections = DB.subjects.length;
  const recent = DB.enrollments.slice().sort((a, b) => new Date(b.dateSubmitted) - new Date(a.dateSubmitted)).slice(0, 5);

  const rows = recent.length ? recent.map(e => {
    const s = DB.students.find(st => st.studentId === e.studentId) || {};
    const badge = e.status === "approved" ? `<span class="badge badge-green">Approved</span>`
      : e.status === "rejected" ? `<span class="badge badge-red">Rejected</span>`
      : `<span class="badge badge-amber">Pending</span>`;
    return `<tr><td>${s.name || "—"}</td><td>${e.studentId}</td><td>${s.course || "—"}</td><td>${badge}</td></tr>`;
  }).join("") : `<tr><td colspan="4" class="empty-state">No enrollment applications submitted yet.</td></tr>`;

  return `
    <h1 class="page-title">Good day, ${user.role === "admin" ? "Admin" : "Registrar"}!</h1>
    <p class="page-sub">Here's a quick overview of the enrollment system.</p>

    <div class="stat-grid">
      ${statCard("👥", totalStudents, "Total Students")}
      ${statCard("⏳", pending, "Pending Enrollments")}
      ${statCard("✅", approved, "Approved Enrollments")}
      ${statCard("🏷️", sections, "Available Sections")}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Quick Actions</h3>
      <div class="quick-actions">
        <button class="btn btn-primary" data-go="students">🔍 Find Student</button>
        <button class="btn" data-go="grades">📝 Enter Grades</button>
        <button class="btn" data-go="payments">💳 Payments</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Recent Enrollments</h3>
      <table>
        <thead><tr><th>Student Name</th><th>Student ID</th><th>Course</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
function statCard(icon, value, label) {
  return `<div class="stat-card"><div class="stat-icon">${icon}</div><div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div></div>`;
}

function renderEnrollmentRequests() {
  const rows = DB.enrollments.slice().sort((a, b) => new Date(b.dateSubmitted) - new Date(a.dateSubmitted)).map(e => {
    const s = DB.students.find(st => st.studentId === e.studentId) || {};
    const subs = e.subjectCodes.join(", ");
    const badge = e.status === "approved" ? `<span class="badge badge-green">Approved</span>`
      : e.status === "rejected" ? `<span class="badge badge-red">Rejected</span>`
      : `<span class="badge badge-amber">Pending</span>`;
    const actions = e.status === "pending"
      ? `<button class="btn btn-sm btn-primary" data-action="approve" data-id="${e.id}">Approve</button>
         <button class="btn btn-sm btn-danger" data-action="reject" data-id="${e.id}">Reject</button>`
      : `<span class="muted small">No action needed</span>`;
    return `<tr><td>${s.name || "—"}<div class="muted small">${e.studentId}</div></td><td>${s.course || "—"}</td><td>${subs}</td><td>${fmtDate(e.dateSubmitted)}</td><td>${badge}</td><td>${actions}</td></tr>`;
  }).join("");

  return `
    <h1 class="page-title">Enrollment Requests</h1>
    <p class="page-sub">Review and approve subject enrollment submitted by students.</p>
    <div class="card">
      <table>
        <thead><tr><th>Student</th><th>Course</th><th>Subjects Requested</th><th>Date Submitted</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty-state">No enrollment applications submitted yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderStudentsList() {
  const q = (state.studentsFilterQuery || "").toLowerCase();
  const list = DB.students.filter(s => !q || s.studentId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  const rows = list.map(s => `
    <tr>
      <td><strong>${s.studentId}</strong></td>
      <td>${s.name}</td>
      <td>${s.course}</td>
      <td>${s.year}</td>
      <td style="text-align:right">
        <button class="btn btn-sm" data-action="open-record" data-sid="${s.studentId}">Record</button>
        <button class="btn btn-sm" data-action="open-grades" data-sid="${s.studentId}">Grades</button>
        <button class="btn btn-sm" data-action="open-payments" data-sid="${s.studentId}">Payments</button>
      </td>
    </tr>`).join("");

  return `
    <h1 class="page-title">Students</h1>
    <p class="page-sub">Type a student ID or name to find a record.</p>
    <div class="card">
      <input id="student-filter" type="text" placeholder="Filter by ID or name..." value="${state.studentsFilterQuery || ""}"
        style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:14px;" />
      <table>
        <thead><tr><th>Student ID</th><th>Name</th><th>Course</th><th>Year Level</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="empty-state">No matching students.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderStudentRecord() {
  const sid = state.params.sid;
  const s = DB.students.find(st => st.studentId === sid);
  if (!s) return `<p class="empty-state">Student not found.</p>`;

  const gradeRows = DB.subjects.map(sub => {
    const g = getGrade(sid, "1st Semester", sub.code);
    const comp = computeSubject(g);
    if (comp.remarks === "—" && !g.prelim && !g.midterm && !g.finals) return "";
    return `<tr><td>${sub.code}</td><td>${sub.title}</td><td>${sub.units}</td>
      <td>${g.prelim || "—"}</td><td>${g.midterm || "—"}</td><td>${g.finals || "—"}</td>
      <td><strong>${comp.final !== null ? comp.final.toFixed(2) : "—"}</strong></td><td>${remarkBadge(comp.remarks)}</td></tr>`;
  }).join("");
  const wa = weightedAverage(sid, "1st Semester");

  const pay = getPayments(sid, "1st Semester");
  const payRows = Object.entries(pay).map(([item, v]) => `
    <tr><td>${item}</td><td>${v.paid ? `<span class="badge badge-green">Paid</span>` : `<span class="badge badge-red">Unpaid</span>`}</td>
    <td>${v.paid ? money(v.amount) : "—"}</td><td>${v.paid ? fmtDate(v.datePaid) : "—"}</td><td>${v.paid ? v.orNo : "—"}</td></tr>`).join("");

  return `
    <button class="btn btn-sm" data-go="students" style="margin-bottom:14px">← All Students</button>
    <h1 class="page-title">${s.name}</h1>
    <p class="page-sub">Student ID ${s.studentId} · ${s.course} · ${s.year}</p>

    <div class="card">
      <div class="quick-actions" style="margin-bottom:16px">
        <button class="btn btn-primary" data-action="open-grades" data-sid="${s.studentId}">📝 Enter Grades</button>
        <button class="btn" data-action="open-payments" data-sid="${s.studentId}">💳 Update Payments</button>
        <button class="btn" data-action="print-grades" data-sid="${s.studentId}">🖨️ Print Grade Report</button>
        <button class="btn" data-action="print-statement" data-sid="${s.studentId}">🖨️ Print Payment Statement</button>
      </div>
      <div class="info-grid">
        <div><div class="info-label">Full Name</div>${s.name}</div>
        <div><div class="info-label">Course</div>${s.course}</div>
        <div><div class="info-label">Year Level</div>${s.year}</div>
        <div><div class="info-label">Email</div>${s.email || "—"}</div>
        <div><div class="info-label">Contact</div>${s.contact || "—"}</div>
        <div><div class="info-label">Address</div>${s.address || "—"}</div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Payments · AY ${AY} · 1st Semester</h3>
      <table><thead><tr><th>Item</th><th>Status</th><th>Amount</th><th>Date Paid</th><th>OR No.</th></tr></thead><tbody>${payRows}</tbody></table>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Grades · AY ${AY} · 1st Semester</h3>
      <table><thead><tr><th>Code</th><th>Subject</th><th>Units</th><th>Prelim</th><th>Midterm</th><th>Finals</th><th>Final Grade</th><th>Remarks</th></tr></thead>
      <tbody>${gradeRows || `<tr><td colspan="8" class="empty-state">No grades recorded yet.</td></tr>`}</tbody></table>
      ${wa ? `<p class="muted small" style="margin-top:10px">Weighted average: <strong>${wa.avg.toFixed(2)}</strong> (${wa.units} units with final grades)</p>` : ""}
    </div>
  `;
}

function renderSections() {
  const rows = DB.subjects.map(sub => {
    const enrolledCount = DB.enrollments.filter(e => e.status === "approved" && e.subjectCodes.includes(sub.code)).length;
    return `<tr><td>${sub.code}</td><td>${sub.title}</td><td>${sub.units}</td><td>${sub.schedule}</td><td>${enrolledCount}</td>
      <td><button class="btn btn-sm" data-action="open-classlist" data-code="${sub.code}">View Class List</button></td></tr>`;
  }).join("");
  return `
    <h1 class="page-title">Sections</h1>
    <p class="page-sub">Each subject below is offered as a single section for AY ${AY}.</p>
    <div class="card">
      <table><thead><tr><th>Code</th><th>Subject</th><th>Units</th><th>Schedule</th><th>Enrolled</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
  `;
}

function renderClassLists() {
  const code = state.params.code || (DB.subjects[0] && DB.subjects[0].code);
  const sub = DB.subjects.find(s => s.code === code);
  const options = DB.subjects.map(s => `<option value="${s.code}" ${s.code === code ? "selected" : ""}>${s.code} — ${s.title}</option>`).join("");

  const rows = DB.students.map(s => {
    const g = getGrade(s.studentId, "1st Semester", code);
    const comp = computeSubject(g);
    return `<tr><td>${s.studentId}</td><td>${s.name}</td><td>${s.course}</td><td>${comp.final !== null ? comp.final.toFixed(2) : "—"}</td><td>${remarkBadge(comp.remarks)}</td></tr>`;
  }).join("");

  return `
    <h1 class="page-title">Class Lists</h1>
    <p class="page-sub">${sub ? `${sub.code} —${sub.title} · ${sub.units} units · ${sub.schedule}` : ""}</p>
    <div class="card">
      <label class="field" style="max-width:320px;margin-bottom:14px">
        <span>Subject</span>
        <select id="classlist-subject">${options}</select>
      </label>
      <table><thead><tr><th>Student ID</th><th>Name</th><th>Course</th><th>Final Grade</th><th>Remarks</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
  `;
}

function renderGrades() {
  const mode = state.gradeMode; // 'student' | 'subject'
  return `
    <h1 class="page-title">Grades</h1>
    <p class="page-sub">Enter grades one student at a time, or one subject for the whole class.</p>

    <div class="card">
      <div class="pill-toggle" style="margin-bottom:16px">
        <button class="${mode === "student" ? "active" : ""}" data-action="grade-mode" data-mode="student">By Student</button>
        <button class="${mode === "subject" ? "active" : ""}" data-action="grade-mode" data-mode="subject">By Subject</button>
      </div>
      ${mode === "student" ? gradesByStudentForm() : gradesBySubjectForm()}
    </div>
  `;
}

function gradesByStudentForm() {
  const query = state.gradeStudentQuery || "";
  const match = DB.students.find(s => s.studentId === query) ||
    DB.students.find(s => query && (s.studentId.includes(query) || s.name.toLowerCase().includes(query.toLowerCase())));

  let body = "";
  if (match) {
    const rows = DB.subjects.map(sub => {
      const g = getGrade(match.studentId, "1st Semester", sub.code);
      const comp = computeSubject(g);
      const cellInput = (field, val) => `<input type="text" inputmode="numeric" maxlength="3"
          class="${isFieldInvalid(val) ? "invalid" : ""}"
          data-action="grade-input" data-sid="${match.studentId}" data-code="${sub.code}" data-field="${field}"
          value="${val}" />`;
      return `<tr><td>${sub.code}</td><td>${sub.title}</td><td>${sub.units}</td>
        <td>${cellInput("prelim", g.prelim)}</td><td>${cellInput("midterm", g.midterm)}</td><td>${cellInput("finals", g.finals)}</td>
        <td><strong>${comp.final !== null ? comp.final.toFixed(2) : "—"}</strong></td><td>${remarkBadge(comp.remarks)}</td></tr>`;
    }).join("");
    const wa = weightedAverage(match.studentId, "1st Semester");
    body = `
      <div class="card-row" style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="avatar">${initials(match.name)}</span>
          <div><strong>${match.name}</strong><div class="muted small">${match.studentId} · ${match.course} · ${match.year}</div></div>
        </div>
        <button class="btn btn-sm" data-action="open-record" data-sid="${match.studentId}">View record</button>
      </div>
      <table><thead><tr><th>Code</th><th>Subject</th><th>Units</th><th>Prelim</th><th>Midterm</th><th>Finals</th><th>Final Grade</th><th>Remarks</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="card-row" style="margin-top:14px">
        <p class="muted small">${wa ? `Weighted average: <strong>${wa.avg.toFixed(2)}</strong> (${wa.units} units with final grades)` : "No final grades yet."}<br/>
        Grades are 0–100. Leave a box empty if not graded yet. Passing grade: ${PASSING_GRADE}.</p>
        <button class="btn" data-action="print-grades" data-sid="${match.studentId}">🖨️ Print</button>
      </div>
    `;
  } else {
    body = `<p class="empty-state">${query ? "No matching student." : "Type a student ID or name above to begin."}</p>`;
  }

  return `
    <div class="form-grid">
      <div class="field"><label>Academic year</label><select disabled><option>${AY}</option></select></div>
      <div class="field"><label>Semester</label><select disabled><option>1st Semester</option></select></div>
      <div class="field"><label>Student (ID or name)</label>
        <input id="grade-student-search" type="text" placeholder="Type a student ID, e.g. 2025-000124" value="${query}" />
      </div>
    </div>
    ${body}
  `;
}

function gradesBySubjectForm() {
  const code = state.gradeSubjectCode || DB.subjects[0].code;
  const sub = DB.subjects.find(s => s.code === code);
  const options = DB.subjects.map(s => `<option value="${s.code}" ${s.code === code ? "selected" : ""}>${s.code} — ${s.title}</option>`).join("");

  const rows = DB.students.map(s => {
    const g = getGrade(s.studentId, "1st Semester", code);
    const comp = computeSubject(g);
    const cellInput = (field, val) => `<input type="text" inputmode="numeric" maxlength="3"
        class="${isFieldInvalid(val) ? "invalid" : ""}"
        data-action="grade-input" data-sid="${s.studentId}" data-code="${code}" data-field="${field}"
        value="${val}" />`;
    return `<tr><td>${s.studentId}</td><td>${s.name}</td>
      <td>${cellInput("prelim", g.prelim)}</td><td>${cellInput("midterm", g.midterm)}</td><td>${cellInput("finals", g.finals)}</td>
      <td><strong>${comp.final !== null ? comp.final.toFixed(2) : "—"}</strong></td><td>${remarkBadge(comp.remarks)}</td></tr>`;
  }).join("");

  return `
    <div class="form-grid">
      <div class="field"><label>Academic year</label><select disabled><option>${AY}</option></select></div>
      <div class="field"><label>Semester</label><select disabled><option>1st Semester</option></select></div>
      <div class="field"><label>Subject</label><select id="subject-select">${options}</select></div>
    </div>
    <p class="muted small">${sub.code} — ${sub.title} · ${sub.units} units · ${sub.schedule}</p>
    <table><thead><tr><th>Student ID</th><th>Name</th><th>Prelim</th><th>Midterm</th><th>Finals</th><th>Final Grade</th><th>Remarks</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="muted small" style="margin-top:10px">Grades are 0–100. Leave a box empty if not graded yet. Passing grade: ${PASSING_GRADE}.</p>
  `;
}

function renderPaymentsList() {
  const rows = DB.students.map(s => {
    const cells = SEMESTERS.map(sem => {
      const items = getPayments(s.studentId, sem);
      return ["Tuition", "Prelims", "Midterms", "Finals"].map(k => items[k].paid
        ? `<td><span class="badge badge-green">Paid</span></td>` : `<td><span class="badge badge-red">Unpaid</span></td>`).join("");
    }).join("");
    return `<tr><td><strong>${s.studentId}</strong></td><td>${s.name}</td>${cells}
      <td><button class="btn btn-sm" data-action="open-payments" data-sid="${s.studentId}">Manage</button></td></tr>`;
  }).join("");

  return `
    <h1 class="page-title">Payments</h1>
    <p class="page-sub">See who has paid tuition and exam fees each semester. Open a student to record payments.</p>
    <div class="card">
      <table>
        <thead><tr><th rowspan="2">Student ID</th><th rowspan="2">Name</th><th colspan="4">1st Semester</th><th colspan="4">2nd Semester</th><th rowspan="2"></th></tr>
        <tr><th>Tuition</th><th>Prelims</th><th>Midterms</th><th>Finals</th><th>Tuition</th><th>Prelims</th><th>Midterms</th><th>Finals</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="card-row" style="margin-top:14px">
        <span class="muted small">${DB.students.length} of ${DB.students.length} students</span>
        <button class="btn" data-action="print-status-report">🖨️ Print list</button>
      </div>
    </div>
  `;
}

function renderPaymentManage() {
  const sid = state.paymentOpenStudent || state.params.sid;
  const s = DB.students.find(st => st.studentId === sid);
  if (!s) return `<p class="empty-state">Student not found.</p>`;

  const semBlocks = SEMESTERS.map(sem => {
    const items = getPayments(sid, sem);
    const n = paidCount(items);
    const rows = Object.entries(items).map(([item, v]) => `
      <tr>
        <td>${item}</td>
        <td>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" data-action="toggle-paid" data-sid="${sid}" data-sem="${sem}" data-item="${item}" ${v.paid ? "checked" : ""} />
            ${v.paid ? "Paid" : "Unpaid"}
          </label>
        </td>
        <td><input type="text" data-action="pay-field" data-sid="${sid}" data-sem="${sem}" data-item="${item}" data-field="amount" value="${v.amount}" ${v.paid ? "" : "disabled"} /></td>
        <td><input type="date" data-action="pay-field" data-sid="${sid}" data-sem="${sem}" data-item="${item}" data-field="datePaid" value="${v.datePaid}" ${v.paid ? "" : "disabled"} /></td>
        <td><input type="text" data-action="pay-field" data-sid="${sid}" data-sem="${sem}" data-item="${item}" data-field="orNo" value="${v.orNo}" placeholder="Receipt no." ${v.paid ? "" : "disabled"} /></td>
      </tr>`).join("");
    return `
      <div class="card">
        <div class="card-row" style="margin-bottom:10px">
          <h3 style="margin:0">${sem} <span class="badge ${n === 4 ? "badge-green" : "badge-amber"}">${n} of 4 paid</span></h3>
        </div>
        <table><thead><tr><th>Item</th><th>Paid?</th><th>Amount (₱)</th><th>Date Paid</th><th>OR No.</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
  }).join("");

  return `
    <button class="btn btn-sm" data-go="payments" style="margin-bottom:14px">← All Students</button>
    <h1 class="page-title">Payments</h1>
    <p class="page-sub">Tick an item once the student has paid. The date is filled in automatically and can be changed.</p>

    <div class="card">
      <div class="card-row">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="avatar">${initials(s.name)}</span>
          <div><strong>${s.name}</strong><div class="muted small">${s.studentId} · ${s.course} · ${s.year}</div></div>
        </div>
        <button class="btn btn-sm" data-action="print-statement" data-sid="${sid}">🖨️ Print Statement</button>
      </div>
    </div>
    ${semBlocks}
  `;
}

/* ============================================================
   STUDENT VIEWS
   ============================================================ */
function renderStudentDashboard(user) {
  const s = currentStudent();
  const enr = DB.enrollments.filter(e => e.studentId === s.studentId).sort((a, b) => new Date(b.dateSubmitted) - new Date(a.dateSubmitted))[0];
  const enrolledSubjects = enr && enr.status === "approved" ? enr.subjectCodes.length : 0;
  const statusLabel = !enr ? "Not yet submitted" : enr.status === "approved" ? "Approved" : enr.status === "rejected" ? "Rejected" : "Pending approval";

  return `
    <h1 class="page-title">Hello, ${s.name.split(" ")[0]}! 👋</h1>
    <p class="page-sub">Welcome to your student portal.</p>
    <div class="stat-grid">
      ${statCard("📚", DB.subjects.length, "Available Courses")}
      ${statCard("✅", enrolledSubjects, "Enrolled Subjects")}
      ${statCard("🗓️", statusLabel, "Enrollment Status")}
      ${statCard("🎓", AY, "Academic Year")}
    </div>
    <div class="card">
      <h3 style="margin-top:0">Quick Actions</h3>
      <div class="quick-actions">
        <button class="btn btn-primary" data-go="courses">📚 Browse Courses</button>
        <button class="btn" data-go="myenrollments">📄 View My Enrollments</button>
        <button class="btn" data-go="mygrades">📝 My Grades</button>
        <button class="btn" data-go="mypayments">💳 My Payments</button>
      </div>
    </div>
  `;
}

function renderProfile() {
  const s = currentStudent();
  const docHtml = s.document
    ? `<img src="${s.document}" class="upload-preview" /><br/><button class="btn btn-sm btn-danger" style="margin-top:8px" data-action="remove-doc">Remove document</button>`
    : `<div class="upload-box">
         <p>Upload a valid ID or Certificate of Registration (image file).</p>
         <input type="file" id="doc-upload" accept="image/*" />
       </div>`;

  return `
    <h1 class="page-title">Profile</h1>
    <p class="page-sub">Your student information.</p>
    <div class="card">
      <div class="info-grid">
        <div><div class="info-label">Student ID</div>${s.studentId}</div>
        <div><div class="info-label">Full Name</div>${s.name}</div>
        <div><div class="info-label">Course</div>${s.course}</div>
        <div><div class="info-label">Year Level</div>${s.year}</div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Contact Information</h3>
      <div class="form-grid-2">
        <div class="field"><label>Email</label><input id="profile-email" type="email" value="${s.email || ""}" /></div>
        <div class="field"><label>Contact Number</label><input id="profile-contact" type="text" value="${s.contact || ""}" /></div>
      </div>
      <div class="field" style="margin-bottom:14px"><label>Address</label><input id="profile-address" type="text" value="${s.address || ""}" /></div>
      <button class="btn btn-primary" data-action="save-profile">Save Changes</button>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Document</h3>
      ${docHtml}
    </div>
  `;
}

function renderCourseSelection() {
  const s = currentStudent();
  const existing = DB.enrollments.find(e => e.studentId === s.studentId);
  if (existing) {
    return `
      <h1 class="page-title">Course Selection</h1>
      <p class="page-sub">You've already submitted an enrollment for AY ${AY}, 1st Semester.</p>
      <div class="card empty-state">
        Your submission is <strong>${existing.status}</strong>. Check <a href="#" data-go="myenrollments">My Enrollments</a> for details.
      </div>
    `;
  }
  const items = DB.subjects.map(sub => `
    <label class="course-item">
      <span style="display:flex;align-items:center">
        <input type="checkbox" value="${sub.code}" class="course-check" />
        <span><span class="course-title">${sub.code} — ${sub.title}</span><br/><span class="course-meta">${sub.units} units · ${sub.schedule}</span></span>
      </span>
    </label>`).join("");

  return `
    <h1 class="page-title">Course Selection</h1>
    <p class="page-sub">Select the subjects you want to enroll in for AY ${AY}, 1st Semester.</p>
    <div class="card">
      ${items}
      <button class="btn btn-primary" data-action="submit-enrollment" style="margin-top:10px">Submit Enrollment</button>
    </div>
  `;
}

function renderMyEnrollments() {
  const s = currentStudent();
  const list = DB.enrollments.filter(e => e.studentId === s.studentId).sort((a, b) => new Date(b.dateSubmitted) - new Date(a.dateSubmitted));
  if (!list.length) return `<h1 class="page-title">My Enrollments</h1><div class="card empty-state">You haven't submitted an enrollment yet. <a href="#" data-go="courses">Browse courses</a> to get started.</div>`;

  const cards = list.map(e => {
    const badge = e.status === "approved" ? `<span class="badge badge-green">Approved</span>`
      : e.status === "rejected" ? `<span class="badge badge-red">Rejected</span>`
      : `<span class="badge badge-amber">Pending</span>`;
    const subs = e.subjectCodes.map(code => {
      const sub = DB.subjects.find(x => x.code === code);
      return `<li>${sub.code} — ${sub.title} (${sub.units} units)</li>`;
    }).join("");
    return `<div class="card">
      <div class="card-row"><strong>AY ${AY} · 1st Semester</strong>${badge}</div>
      <p class="muted small">Submitted ${fmtDate(e.dateSubmitted)}</p>
      <ul>${subs}</ul>
      ${e.status === "approved" ? `<p class="muted small">Grades will appear under My Grades once your registrar begins encoding.</p>` : ""}
    </div>`;
  }).join("");

  return `<h1 class="page-title">My Enrollments</h1>${cards}`;
}

function renderMyGrades() {
  const s = currentStudent();
  const rows = DB.subjects.map(sub => {
    const g = getGrade(s.studentId, "1st Semester", sub.code);
    const comp = computeSubject(g);
    if (!g.prelim && !g.midterm && !g.finals) return "";
    return `<tr><td>${sub.code}</td><td>${sub.title}</td><td>${sub.units}</td><td>${g.prelim || "—"}</td><td>${g.midterm || "—"}</td><td>${g.finals || "—"}</td>
      <td><strong>${comp.final !== null ? comp.final.toFixed(2) : "—"}</strong></td><td>${remarkBadge(comp.remarks)}</td></tr>`;
  }).join("");
  const wa = weightedAverage(s.studentId, "1st Semester");

  return `
    <h1 class="page-title">My Grades</h1>
    <p class="page-sub">Your grades for each semester.</p>
    <div class="card-row" style="margin-bottom:10px">
      <span></span>
      <button class="btn" data-action="print-grades" data-sid="${s.studentId}">🖨️ Print</button>
    </div>
    <div class="card">
      <h3 style="margin-top:0">1st Semester</h3>
      <table><thead><tr><th>Code</th><th>Subject</th><th>Units</th><th>Prelim</th><th>Midterm</th><th>Finals</th><th>Final Grade</th><th>Remarks</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="empty-state">No grades recorded for this term yet.</td></tr>`}</tbody></table>
      ${wa ? `<p class="muted small" style="margin-top:10px">Weighted average: <strong>${wa.avg.toFixed(2)}</strong> (subjects with a final grade, weighted by units)</p>` : ""}
    </div>
    <div class="card"><h3 style="margin-top:0">2nd Semester</h3><p class="empty-state">No grades recorded for this term yet.</p></div>
  `;
}

function renderMyPayments() {
  const s = currentStudent();
  const blocks = SEMESTERS.map(sem => {
    const items = getPayments(s.studentId, sem);
    const n = paidCount(items);
    const rows = Object.entries(items).map(([item, v]) => `
      <tr><td>${item}</td><td>${v.paid ? `<span class="badge badge-green">Paid</span>` : `<span class="badge badge-red">Unpaid</span>`}</td>
      <td>${v.paid ? money(v.amount) : "—"}</td><td>${v.paid ? fmtDate(v.datePaid) : "—"}</td><td>${v.paid ? v.orNo : "—"}</td></tr>`).join("");
    return `<div class="card">
      <h3 style="margin-top:0">${sem} <span class="badge ${n === 4 ? "badge-green" : "badge-amber"}">${n} of 4 paid</span></h3>
      <table><thead><tr><th>Item</th><th>Status</th><th>Amount</th><th>Date Paid</th><th>OR No.</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="text-align:right;margin-top:8px"><strong>Total paid: ${money(totalPaid(items))}</strong></p>
    </div>`;
  }).join("");

  return `
    <h1 class="page-title">My Payments</h1>
    <p class="page-sub">Tuition and exam fee payments for each semester.</p>
    <div class="card-row" style="margin-bottom:10px"><span></span><button class="btn" data-action="print-statement" data-sid="${s.studentId}">🖨️ Print</button></div>
    ${blocks}
  `;
}

/* ============================================================
   NOTIFICATIONS DROPDOWN
   ============================================================ */
function renderNotifDropdown() {
  const user = currentUser();
  if (!user) return;
  const mine = DB.notifications.filter(n => n.userId === user.id);
  const count = unreadCount(user.id);
  const countEl = $("#notif-count");
  countEl.textContent = count;
  countEl.classList.toggle("hidden", count === 0);

  const dd = $("#notif-dropdown");
  const items = mine.slice(0, 8).map(n => `<div class="notif-item">${n.message}<div class="ni-time">${new Date(n.date).toLocaleString()}</div></div>`).join("");
  dd.innerHTML = `<div class="dropdown-header">Notifications</div>${items || `<div class="dropdown-empty">No notifications yet.</div>`}`;
}

/* ============================================================
   PRINT HELPERS
   ============================================================ */
function printHeader(docTitle, sub) {
  return `
    <div class="print-header">
      <div class="print-logo">🎓</div>
      <div>
        <p class="print-title">Asian Institute of Computer Studies</p>
        <p class="print-sub">Commonwealth Branch</p>
        <p class="print-doctitle">${docTitle}</p>
        <p class="print-sub">${sub}</p>
      </div>
    </div>`;
}
function printFooter() {
  const user = currentUser();
  return `<div class="print-footer">Printed on ${new Date().toLocaleString()} by ${user.name}</div>`;
}
function doPrint(html) {
  $("#print-area").innerHTML = html;
  window.print();
}

function printGradeReport(sid) {
  const s = DB.students.find(st => st.studentId === sid);
  const rows = DB.subjects.map(sub => {
    const g = getGrade(sid, "1st Semester", sub.code);
    const comp = computeSubject(g);
    if (!g.prelim && !g.midterm && !g.finals) return "";
    return `<tr><td>${sub.code}</td><td>${sub.title}</td><td>${sub.units}</td><td>${g.prelim || "—"}</td><td>${g.midterm || "—"}</td><td>${g.finals || "—"}</td>
      <td><strong>${comp.final !== null ? comp.final.toFixed(2) : "—"}</strong></td><td>${comp.remarks}</td></tr>`;
  }).join("");
  const wa = weightedAverage(sid, "1st Semester");
  doPrint(`
    ${printHeader("Grade Report", "Academic Year " + AY + " · 1st Semester")}
    <div class="print-meta">
      <div><span>Student ID</span>${s.studentId}</div>
      <div><span>Full Name</span>${s.name}</div>
      <div><span>Course</span>${s.course}</div>
      <div><span>Year Level</span>${s.year}</div>
    </div>
    <table><thead><tr><th>Code</th><th>Subject</th><th>Units</th><th>Prelim</th><th>Midterm</th><th>Finals</th><th>Final Grade</th><th>Remarks</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${wa ? `<p style="margin-top:12px"><strong>Weighted average: ${wa.avg.toFixed(2)}</strong> (subjects with a final grade, weighted by units)</p>` : ""}
    ${printFooter()}
  `);
}

function printPaymentStatement(sid) {
  const s = DB.students.find(st => st.studentId === sid);
  const blocks = SEMESTERS.map(sem => {
    const items = getPayments(sid, sem);
    const n = paidCount(items);
    const rows = Object.entries(items).map(([item, v]) => `
      <tr><td>${item}</td><td>${v.paid ? "Paid" : "Unpaid"}</td><td>${v.paid ? money(v.amount) : "—"}</td>
      <td>${v.paid ? fmtDate(v.datePaid) : "—"}</td><td>${v.paid ? v.orNo : "—"}</td></tr>`).join("");
    return `<h3>${sem} <span style="font-weight:400;font-size:12px">(${n} of 4 paid)</span></h3>
      <table><thead><tr><th>Item</th><th>Status</th><th>Amount</th><th>Date Paid</th><th>OR No.</th></tr></thead>
      <tbody>${rows}<tr class="print-total-row"><td colspan="2">Total paid</td><td>${money(totalPaid(items))}</td><td></td><td></td></tr></tbody></table>`;
  }).join("<br/>");

  doPrint(`
    ${printHeader("Payment Statement", "Academic Year " + AY)}
    <div class="print-meta">
      <div><span>Student ID</span>${s.studentId}</div>
      <div><span>Full Name</span>${s.name}</div>
      <div><span>Course</span>${s.course}</div>
      <div><span>Year Level</span>${s.year}</div>
    </div>
    ${blocks}
    ${printFooter()}
  `);
}

function printStatusReport() {
  const rows = DB.students.map(s => {
    const cells = SEMESTERS.map(sem => {
      const items = getPayments(s.studentId, sem);
      return ["Tuition", "Prelims", "Midterms", "Finals"].map(k => `<td>${items[k].paid ? "Paid" : "Unpaid"}</td>`).join("");
    }).join("");
    return `<tr><td>${s.studentId}</td><td>${s.name}</td>${cells}</tr>`;
  }).join("");
  doPrint(`
    ${printHeader("Payment Status Report", "Academic Year " + AY)}
    <p style="font-weight:600;margin-bottom:8px">All students</p>
    <table><thead><tr><th rowspan="2">Student ID</th><th rowspan="2">Name</th><th colspan="4">1st Semester</th><th colspan="4">2nd Semester</th></tr>
    <tr><th>Tuition</th><th>Prelims</th><th>Midterms</th><th>Finals</th><th>Tuition</th><th>Prelims</th><th>Midterms</th><th>Finals</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${printFooter()}
  `);
}

/* ============================================================
   GLOBAL SEARCH (registrar/admin)
   ============================================================ */
$("#global-search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const box = $("#search-results");
  if (!q) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const matches = DB.students.filter(s => s.studentId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 6);
  box.innerHTML = matches.map(s => `<div class="sr-item" data-sid="${s.studentId}"><div class="sr-name">${s.name}</div><div class="sr-sub">${s.studentId} · ${s.course} · ${s.year}</div></div>`).join("")
    || `<div class="dropdown-empty">No matches.</div>`;
  box.classList.remove("hidden");
});

$("#global-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = $("#search-results .sr-item");
    if (first) { openRecord(first.dataset.sid); }
  }
});

document.addEventListener("click", (e) => {
  const student = e.target.closest(".sr-item");
  if (student) {
    e.preventDefault();
    openRecord(student.dataset.sid);
    $("#search-results").classList.add("hidden");
    $("#global-search").value = "";
  }
  if (!e.target.closest(".search-wrap")) { $("#search-results").classList.add("hidden"); }
  if (!e.target.closest(".notif-wrap")) { $("#notif-dropdown").classList.add("hidden"); }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement.tagName !== "INPUT" && !$("#app").classList.contains("hidden")) {
    const search = $("#global-search");
    if (search && search.closest(".search-wrap").style.visibility !== "hidden") { e.preventDefault(); search.focus(); }
  }
});

$("#notif-btn").addEventListener("click", () => {
  $("#notif-dropdown").classList.toggle("hidden");
  const user = currentUser();
  DB.notifications.forEach(n => { if (n.userId === user.id) n.read = true; });
  saveDB(DB);
  renderNotifDropdown();
  $("#notif-dropdown").classList.remove("hidden");
});

function openRecord(sid) {
  state.route = "studentrecord";
  state.params = { sid };
  render();
}

/* ============================================================
   EVENT DELEGATION for dynamically rendered content
   ============================================================ */
document.addEventListener("click", (e) => {
  const goEl = e.target.closest("[data-go]");
  if (goEl) { e.preventDefault(); state.route = goEl.dataset.go; state.params = {}; render(); return; }

  const actionEl = e.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === "open-record") { openRecord(actionEl.dataset.sid); return; }
  if (action === "open-grades") {
    state.route = "grades"; state.gradeMode = "student"; state.gradeStudentQuery = actionEl.dataset.sid; render(); return;
  }
  if (action === "open-payments") {
    state.route = "paymentmanage"; state.paymentOpenStudent = actionEl.dataset.sid; state.params = { sid: actionEl.dataset.sid }; render(); return;
  }
  if (action === "open-classlist") { state.route = "classlists"; state.params = { code: actionEl.dataset.code }; render(); return; }
  if (action === "grade-mode") { state.gradeMode = actionEl.dataset.mode; render(); return; }
  if (action === "print-grades") { printGradeReport(actionEl.dataset.sid); return; }
  if (action === "print-statement") { printPaymentStatement(actionEl.dataset.sid); return; }
  if (action === "print-status-report") { printStatusReport(); return; }

  if (action === "approve" || action === "reject") {
    const enr = DB.enrollments.find(x => x.id === actionEl.dataset.id);
    if (enr) {
      enr.status = action === "approve" ? "approved" : "rejected";
      const user = DB.users.find(u => u.studentId === enr.studentId);
      if (user) notify(user.id, `Your enrollment for AY ${AY}, 1st Semester was ${enr.status}.`);
      toast(`Enrollment ${enr.status}.`);
      render();
    }
    return;
  }

  if (action === "submit-enrollment") {
    const codes = $all(".course-check:checked").map(c => c.value);
    if (!codes.length) { toast("Select at least one subject."); return; }
    const s = currentStudent();
    DB.enrollments.push({ id: uid("e"), studentId: s.studentId, subjectCodes: codes, status: "pending", dateSubmitted: new Date().toISOString() });
    toast("Enrollment submitted for approval.");
    state.route = "myenrollments";
    render();
    return;
  }

  if (action === "save-profile") {
    const s = currentStudent();
    s.email = $("#profile-email").value.trim();
    s.contact = $("#profile-contact").value.trim();
    s.address = $("#profile-address").value.trim();
    toast("Profile updated.");
    render();
    return;
  }

  if (action === "remove-doc") {
    const s = currentStudent();
    s.document = null;
    render();
    return;
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "student-filter") { state.studentsFilterQuery = e.target.value; render(); }
  if (e.target.id === "grade-student-search") { state.gradeStudentQuery = e.target.value; render(); }

  if (e.target.dataset.action === "grade-input") {
    const { sid, code, field } = e.target.dataset;
    setGrade(sid, "1st Semester", code, field, e.target.value.trim());
    saveDB(DB);
  }
  if (e.target.dataset.action === "pay-field") {
    const { sid, sem, item, field } = e.target.dataset;
    getPayments(sid, sem)[item][field] = e.target.value;
    saveDB(DB);
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "subject-select") { state.gradeSubjectCode = e.target.value; render(); }
  if (e.target.id === "classlist-subject") { state.params.code = e.target.value; render(); }

  if (e.target.dataset.action === "toggle-paid") {
    const { sid, sem, item } = e.target.dataset;
    const rec = getPayments(sid, sem)[item];
    rec.paid = e.target.checked;
    if (rec.paid && !rec.datePaid) rec.datePaid = todayISO();
    if (rec.paid && !rec.orNo) rec.orNo = nextOR();
    render();
  }

  if (e.target.id === "doc-upload" && e.target.files[0]) {
    const reader = new FileReader();
    reader.onload = () => { currentStudent().document = reader.result; render(); };
    reader.readAsDataURL(e.target.files[0]);
  }
});

/* ============================================================
   BOOT
   ============================================================ */
(function boot() {
  const user = currentUser();
  if (user) enterApp();
})();