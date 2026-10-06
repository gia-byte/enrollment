/* AICS Enrollment System — front end.
   Everything the user sees after login is loaded with fetch() (AJAX) from /api/*.
   The server decides what each role may do; this file only decides what to show. */
"use strict";

/* ------------------------------------------------------------ helpers */
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDT = (s) => {
  if (!s) return "-";
  const m = /^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d))?/.exec(s); if (!m) return esc(s);
  let out = `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
  if (m[4]) { const h = +m[4]; out += ` ${(h % 12) || 12}:${m[5]} ${h < 12 ? "AM" : "PM"}`; }
  return out;
};
const YEARS = { 1: "1st Year", 2: "2nd Year", 3: "3rd Year", 4: "4th Year" };
const P = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  home: P('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>'),
  users: P('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14c2.5.7 4 2.7 4 6"/>'),
  book: P('<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 21V5"/>'),
  check: P('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'),
  cal: P('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  inbox: P('<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>'),
  shield: P('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  pin: P('<path d="M12 21s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  cap: P('<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c3 2.5 9 2.5 12 0v-4.5"/>'),
  grid: P('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  logout: P('<path d="M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4"/><path d="M16 8l4 4-4 4M20 12H9"/>'),
  menu: P('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  print: P('<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
};
const STATUS = { pending: ["b-warn", "Pending"], approved: ["b-ok", "Approved"], rejected: ["b-bad", "Rejected"] };
const badge = (s) => { const [c, t] = STATUS[s] || ["b-off", s]; return `<span class="badge ${c}">${esc(t)}</span>`; };
const onOff = (on, a = "Active", b = "Inactive") => `<span class="badge ${on ? "b-ok" : "b-off"}">${on ? a : b}</span>`;

let ME = null, CSRF = "", LOOK = null, PERIOD = null;

async function api(method, url, body) {
  const opt = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
  if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  if (method !== "GET") opt.headers["X-CSRF-Token"] = CSRF;
  const r = await fetch(url, opt);
  let d = null; try { d = await r.json(); } catch (_) { /* non-JSON */ }
  if (r.status === 401) { location.href = "/login?expired=1"; throw new Error("Session ended"); }
  if (!r.ok) { const e = new Error((d && d.error) || "Request failed."); e.status = r.status; e.fields = (d && d.fields) || {}; throw e; }
  return d;
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v != null)).toString();

let toastTimer;
function toast(msg, kind = "ok") {
  const t = $("#toast"); t.textContent = msg; t.className = "toast " + kind; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
function openModal(html, cls = "") {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-back"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
  const back = root.firstElementChild;
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  const first = root.querySelector("input,select,textarea,button.btn-primary"); if (first) first.focus();
  return { el: root.firstElementChild.firstElementChild, close };
}
function confirmBox(title, msg, okLabel = "Confirm", danger = false) {
  return new Promise((res) => {
    const m = openModal(`<h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="modal-actions">
      <button class="btn" data-close>Cancel</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="ok">${esc(okLabel)}</button></div>`, "sm");
    m.el.querySelector("#ok").addEventListener("click", () => { m.close(); res(true); });
    m.el.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => res(false)));
  });
}
const view = () => $("#view");
const loading = () => { view().innerHTML = `<div class="loading">Loading…</div>`; };
const failView = (e) => { view().innerHTML = `<div class="card"><div class="note">${esc(e.message)}</div></div>`; };
const header = (t, sub = "", right = "") => `<div class="card-head"><div><h1 class="page-title">${esc(t)}</h1>${sub ? `<p class="page-sub">${esc(sub)}</p>` : ""}</div>${right}</div>`;
const printBtn = (id, label = "Print Record", cls = "btn-primary") => `<a class="btn ${cls}" target="_blank" rel="noopener" href="/print/enrollment/${+id}?autoprint=1">${ICON.print}${esc(label)}</a>`;
const stat = (n, label, cls = "", txt = false) => `<div class="stat ${cls}"><b class="${txt ? "txt" : ""}">${esc(n)}</b><span>${esc(label)}</span></div>`;
const dl = (pairs) => `<dl class="info-grid">${pairs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v || "-")}</dd></div>`).join("")}</dl>`;
const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;

function itemsTable(items, total) {
  if (!items.length) return empty("No subjects on this enrollment.");
  return `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Subject</th><th>Schedule</th><th>Room</th><th class="num">Units</th></tr></thead><tbody>
    ${items.map((i) => `<tr><td><strong>${esc(i.code)}</strong></td><td>${esc(i.title)}</td><td>${esc(i.schedule)}</td><td>${esc(i.room || "-")}</td><td class="num">${i.units}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="4" class="num"><strong>Total units</strong></td><td class="num"><strong>${total}</strong></td></tr></tfoot></table></div>`;
}
const filterOptions = (list, label, key = "id", text = "name") => `<option value="">${esc(label)}</option>` + list.map((x) => `<option value="${x[key]}">${esc(x[text])}</option>`).join("");

/* ------------------------------------------------------------ STUDENT views */
async function sDashboard() {
  loading();
  const d = await api("GET", "/api/student/dashboard"), s = d.student, e = d.enrollment;
  let body;
  if (!d.period) body = `<div class="card">${empty("No active school term yet. Please check again later.")}</div>`;
  else if (!e) body = `<div class="card"><h3>Your enrollment for ${esc(d.period.school_year)} · ${esc(d.period.semester)}</h3>
      <p>You have not enrolled yet. Choose your subjects and submit them for the registrar's review.</p><a class="btn btn-primary" href="#/enroll">Enroll subjects</a></div>`;
  else body = `<div class="card"><div class="card-head"><h3>Your enrollment for ${esc(d.period.school_year)} · ${esc(d.period.semester)}</h3>${badge(e.status)}</div>
      ${e.status === "pending" ? `<p class="muted">Submitted ${fmtDT(e.submitted_at)}. The registrar has not reviewed it yet.</p>` : ""}
      ${e.status === "rejected" ? `<div class="note"><strong>Rejected:</strong> ${esc(e.remarks || "No reason given.")}</div><a class="btn btn-primary" href="#/enroll">Choose subjects again</a>` : ""}
      ${e.status === "approved" ? `<p class="muted">Approved ${fmtDT(e.reviewed_at)}${e.reviewer ? " by " + esc(e.reviewer) : ""}.</p>` : ""}
      ${itemsTable(e.items, e.total_units)}
      <p>${printBtn(e.id, "Print enrollment record", "")} <a class="btn" href="#/schedule">View schedule</a></p></div>`;
  view().innerHTML = header(`Hello, ${s.full_name.split(" ")[0]}`, "Your enrollment and academic information.") +
    `<div class="stat-grid">${stat(s.program_code, s.program_name, "", true)}${stat(YEARS[s.year_level], "Year level", "", true)}
      ${stat(s.branch_name, "Branch", "", true)}${stat(e ? STATUS[e.status][1] : "Not yet enrolled", "Enrollment status", e ? (e.status === "approved" ? "ok" : e.status === "rejected" ? "bad" : "warn") : "warn", true)}
      ${stat(e ? e.total_units : 0, "Units selected")}${stat(d.history_count, "Terms on record")}</div>` + body;
}

async function sProfile() {
  loading();
  const { student: s } = await api("GET", "/api/student/dashboard");
  view().innerHTML = header("My profile", "Your school details are managed by the registrar. You can update your contact information.") +
    `<div class="card"><h3>School information</h3>${dl([["Student ID", s.student_no], ["Full name", s.full_name], ["Program", s.program_name], ["Year level", YEARS[s.year_level]], ["Branch", s.branch_name], ["Status", s.status]])}</div>
    <form class="card" id="pf" novalidate><h3>Contact information</h3><div class="form-grid">
      <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" maxlength="120" value="${esc(s.email)}"><p class="field-error" data-for="email"></p></div>
      <div class="field"><label for="f-contact">Contact number</label><input id="f-contact" name="contact" maxlength="20" value="${esc(s.contact)}"><p class="field-error" data-for="contact"></p></div>
      <div class="field span2"><label for="f-address">Address</label><input id="f-address" name="address" maxlength="200" value="${esc(s.address)}"><p class="field-error" data-for="address"></p></div></div>
      <p style="margin-top:16px"><button class="btn btn-primary" type="submit">Save changes</button></p></form>`;
  $("#pf").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target, b = f.querySelector("button"); showFieldErrors(f, {});
    const data = Object.fromEntries(new FormData(f).entries());
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(data.email)) return showFieldErrors(f, { email: "Enter a valid email address." });
    b.disabled = true;
    try { await api("PUT", "/api/student/me", data); toast("Profile saved."); }
    catch (e) { showFieldErrors(f, e.fields); toast(e.message, "err"); }
    b.disabled = false;
  });
}
function showFieldErrors(root, fields) {
  root.querySelectorAll(".field").forEach((f) => f.classList.remove("invalid"));
  root.querySelectorAll("[data-for]").forEach((p) => { p.textContent = ""; });
  Object.entries(fields || {}).forEach(([k, m]) => { const p = root.querySelector(`[data-for="${k}"]`); if (p) { p.textContent = m; p.closest(".field").classList.add("invalid"); } });
}

const DAY_RE = /Th|M|T|W|F|S/g;
const clash = (a, b) => { const A = new Set(a.days.match(DAY_RE)); return b.days.match(DAY_RE).some((d) => A.has(d)) && a.time_start < b.time_end && b.time_start < a.time_end; };

async function sEnroll() {
  loading();
  const d = await api("GET", "/api/student/dashboard");
  if (!d.period) return void (view().innerHTML = header("Enroll subjects") + `<div class="card">${empty("Enrollment is not open yet.")}</div>`);
  if (d.enrollment && d.enrollment.status !== "rejected") {
    return void (view().innerHTML = header("Enroll subjects") + `<div class="card"><p>You already have a <strong>${esc(d.enrollment.status)}</strong> enrollment for this term.</p><a class="btn btn-primary" href="#/status">View enrollment status</a></div>`);
  }
  const MAX = 24, picked = new Map();
  view().innerHTML = header("Enroll subjects", `${d.period.school_year} · ${d.period.semester} · ${d.student.program_code}, ${YEARS[d.student.year_level]}, ${d.student.branch_name}`) +
    (d.enrollment ? `<div class="note"><strong>Previous request was rejected:</strong> ${esc(d.enrollment.remarks || "")}. Review your choices and submit again.</div>` : "") +
    `<div class="card"><div class="filters"><input class="grow" id="sq" type="search" placeholder="Search subject code or title" aria-label="Search subjects"></div>
    <div id="list"><div class="loading">Loading subjects…</div></div></div><div class="summary" id="sum"></div>`;

  const sum = () => {
    const list = [...picked.values()], units = list.reduce((a, x) => a + x.units, 0), problems = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (clash(list[i], list[j])) problems.push(`${list[i].code} and ${list[j].code} overlap`);
    if (units > MAX) problems.push(`Maximum load is ${MAX} units`);
    $("#sum").innerHTML = `<div><strong>${list.length}</strong> subject(s) · <strong>${units}</strong> / ${MAX} units
      ${problems.length ? `<div class="warnbox">${esc(problems.join("; "))}</div>` : ""}</div>
      <button class="btn btn-primary" id="submit" ${!list.length || problems.length ? "disabled" : ""}>Submit enrollment</button>`;
    $("#submit").addEventListener("click", submit);
  };
  const submit = async () => {
    const list = [...picked.values()];
    if (!(await confirmBox("Submit enrollment?", `You are submitting ${list.length} subject(s), ${list.reduce((a, x) => a + x.units, 0)} units, for the registrar to review.`, "Submit"))) return;
    try { await api("POST", "/api/student/enrollment", { section_ids: [...picked.keys()] }); toast("Enrollment submitted. Status: Pending."); location.hash = "#/status"; }
    catch (e) { toast(e.message, "err"); }
  };
  const load = async () => {
    const box = $("#list");
    try {
      const r = await api("GET", "/api/student/sections?" + qs({ q: $("#sq").value.trim() }));
      if (!r.sections.length) { box.innerHTML = empty("No subjects match. Try a different search, or ask the registrar if sections are open for your program."); return; }
      box.innerHTML = `<div class="table-wrap"><table class="pick"><thead><tr><th></th><th>Code</th><th>Subject</th><th>Schedule</th><th>Room</th><th class="num">Units</th><th class="num">Seats</th></tr></thead><tbody>
        ${r.sections.map((s) => `<tr class="${picked.has(s.id) ? "sel" : ""} ${s.seats_left ? "" : "full"}"><td><input type="checkbox" data-id="${s.id}" ${picked.has(s.id) ? "checked" : ""} ${s.seats_left ? "" : "disabled"} aria-label="Select ${esc(s.code)}"></td>
        <td><strong>${esc(s.code)}</strong></td><td>${esc(s.title)}</td><td>${esc(s.schedule)}</td><td>${esc(s.room || "-")}</td><td class="num">${s.units}</td>
        <td class="num">${s.seats_left ? s.seats_left : '<span class="badge b-bad">Full</span>'}</td></tr>`).join("")}</tbody></table></div>`;
      box.querySelectorAll("input[type=checkbox]").forEach((cb) => cb.addEventListener("change", () => {
        const s = r.sections.find((x) => x.id === +cb.dataset.id);
        cb.checked ? picked.set(s.id, s) : picked.delete(s.id);
        cb.closest("tr").classList.toggle("sel", cb.checked); sum();
      }));
    } catch (e) { box.innerHTML = `<div class="note">${esc(e.message)}</div>`; }
  };
  $("#sq").addEventListener("input", debounce(load, 250));
  sum(); load();
}

async function sStatus() {
  loading();
  const { enrollments } = await api("GET", "/api/student/enrollments");
  view().innerHTML = header("Enrollment status and history", "Every term you have enrolled in.") +
    (enrollments.length ? `<div class="timeline">${enrollments.map((e) => `<section class="enr"><div class="card-head"><h3>${esc(e.school_year)} · ${esc(e.semester)}</h3>${badge(e.status)}</div>
      <p class="muted small">Submitted ${fmtDT(e.submitted_at)}${e.reviewed_at ? ` · Reviewed ${fmtDT(e.reviewed_at)}${e.reviewer ? " by " + esc(e.reviewer) : ""}` : ""}</p>
      ${e.status === "rejected" ? `<div class="note"><strong>Reason:</strong> ${esc(e.remarks || "-")}</div>` : e.remarks ? `<p>Remarks: ${esc(e.remarks)}</p>` : ""}
      ${itemsTable(e.items, e.total_units)}<p>${printBtn(e.id, "Print record", "")}</p></section>`).join("")}</div>`
      : `<div class="card">${empty("You have not submitted an enrollment yet.")}<p class="center"><a class="btn btn-primary" href="#/enroll">Enroll subjects</a></p></div>`);
}

async function sSchedule() {
  loading();
  const d = await api("GET", "/api/student/dashboard"), e = d.enrollment;
  let body;
  if (!e || e.status === "rejected") body = `<div class="card">${empty("No schedule yet. Your schedule appears here after you submit an enrollment.")}</div>`;
  else {
    const order = ["M", "T", "W", "Th", "F", "S"], names = { M: "Monday", T: "Tuesday", W: "Wednesday", Th: "Thursday", F: "Friday", S: "Saturday" };
    const by = {}; e.items.forEach((i) => i.days.match(DAY_RE).forEach((dd) => (by[dd] = by[dd] || []).push(i)));
    body = (e.status === "pending" ? `<div class="warnbox">Pending approval. This schedule is not final until the registrar approves your enrollment.</div>` : "") +
      `<div class="days">${order.filter((x) => by[x]).map((x) => `<div class="day"><h4>${names[x]}</h4>${by[x].sort((a, b) => a.time_start.localeCompare(b.time_start))
        .map((i) => `<div class="slot"><b>${esc(i.code)} · ${esc(i.title)}</b><span>${esc(i.schedule.split(" ").slice(1).join(" "))} · ${esc(i.room || "-")}</span></div>`).join("")}</div>`).join("")}</div>`;
  }
  view().innerHTML = header("My schedule", d.period ? `${d.period.school_year} · ${d.period.semester}` : "") + body;
}

/* ------------------------------------------------------------ STAFF views */
const barRows = (rows) => { const max = Math.max(1, ...rows.map((r) => r.n)); return `<div class="bars">${rows.map((r) => `<div class="bar-row"><span>${esc(r.label)}</span><div class="bar"><i style="width:${(r.n / max) * 100}%"></i></div><strong>${r.n}</strong></div>`).join("")}</div>`; };

async function staffDash() {
  loading();
  const s = await api("GET", "/api/staff/stats"), admin = ME.role === "admin";
  view().innerHTML = header(admin ? "System overview" : "Registrar dashboard", admin ? "Manage the school's enrollment system." : "Process enrollment requests and student records.") +
    `<div class="stat-grid">${stat(s.total_students, "Active students")}${stat(s.pending, "Pending enrollments", "warn")}${stat(s.approved, "Approved enrollments", "ok")}${stat(s.rejected, "Rejected enrollments", "bad")}</div>
    ${admin ? `<div class="stat-grid">${Object.entries({ users: "User accounts", subjects: "Subjects", sections: "Sections", branches: "Branches", programs: "Programs" }).map(([k, l]) => stat(s.counts[k], l)).join("")}</div>` : ""}
    <div class="two"><div class="card"><h3>Students by branch</h3>${barRows(s.by_branch)}</div><div class="card"><h3>Students by program</h3>${barRows(s.by_program)}</div></div>
    <div class="card"><div class="card-head"><h3>Waiting for review</h3><a class="btn btn-sm" href="#/${admin ? "enrollments" : "requests"}">All requests</a></div>
      ${s.recent_pending.length ? `<table><thead><tr><th>Student</th><th>Program</th><th>Submitted</th><th></th></tr></thead><tbody>${s.recent_pending.map((r) => `<tr><td><strong>${esc(r.full_name)}</strong><div class="muted small">${esc(r.student_no)}</div></td><td>${esc(r.program_code)}</td><td>${fmtDT(r.submitted_at)}</td>
      <td class="actions"><button class="btn btn-sm btn-primary" data-review="${r.id}">Review</button></td></tr>`).join("")}</tbody></table>` : empty("Nothing is waiting. New requests will appear here.")}</div>
    ${admin ? `<div class="card"><h3>Recent activity</h3><table><thead><tr><th>When</th><th>User</th><th>Action</th><th>Detail</th></tr></thead><tbody>${s.audit.map((a) => `<tr><td>${fmtDT(a.at)}</td><td>${esc(a.username)}</td><td>${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  view().querySelectorAll("[data-review]").forEach((b) => b.addEventListener("click", () => reviewModal(+b.dataset.review, () => staffDash())));
}

async function reviewModal(id, done) {
  let e;
  try { e = (await api("GET", "/api/staff/enrollments/" + id)).enrollment; } catch (x) { return toast(x.message, "err"); }
  const canDecide = ME.role === "registrar" && e.status === "pending";
  const m = openModal(`<h3>Enrollment request ${badge(e.status)}</h3>
    ${dl([["Student", e.full_name], ["Student ID", e.student_no], ["Program", `${e.program_code}, ${YEARS[e.year_level]}`], ["Branch", e.branch_name], ["Term", `${e.school_year} · ${e.semester}`], ["Submitted", fmtDT(e.submitted_at)]])}
    <div style="margin:14px 0">${itemsTable(e.items, e.total_units)}</div>
    ${e.status !== "pending" ? `<p class="muted">${esc(STATUS[e.status][1])} ${fmtDT(e.reviewed_at)}${e.reviewer ? " by " + esc(e.reviewer) : ""}${e.remarks ? ". Remarks: " + esc(e.remarks) : ""}</p>` : ""}
    ${canDecide ? `<div class="field"><label for="rm">Remarks <span class="muted">(required when rejecting)</span></label><textarea id="rm" rows="2" maxlength="300"></textarea><p class="field-error" data-for="remarks"></p></div>` : ""}
    ${ME.role === "admin" && e.status === "pending" ? `<p class="muted small">Only the registrar can approve or reject. Admins can view and manage records.</p>` : ""}
    <div class="modal-actions">${ME.role === "admin" ? `<button class="btn btn-danger" id="del" style="margin-right:auto">Delete record</button>` : ""}
      <button class="btn" data-close>Close</button>${printBtn(e.id, "Print Record", "")}
      ${canDecide ? `<button class="btn btn-danger" id="rej">Reject</button><button class="btn btn-ok" id="app">Approve</button>` : ""}</div>`);
  const decide = async (decision) => {
    const remarks = ($("#rm", m.el) || {}).value || "";
    if (decision === "rejected" && !remarks.trim()) return showFieldErrors(m.el, { remarks: "Please give a reason for rejecting." });
    m.el.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try { await api("POST", `/api/staff/enrollments/${id}/decision`, { decision, remarks }); m.close(); toast(`Enrollment ${decision}.`); done && done(); }
    catch (x) { toast(x.message, "err"); m.close(); done && done(); }
  };
  const bind = (sel, fn) => { const b = $(sel, m.el); if (b) b.addEventListener("click", fn); };
  bind("#app", () => decide("approved")); bind("#rej", () => decide("rejected"));
  bind("#del", async () => {
    if (!(await confirmBox("Delete this enrollment record?", "This permanently removes the enrollment and its subjects.", "Delete", true))) return;
    try { await api("DELETE", "/api/admin/enrollments/" + id); m.close(); toast("Enrollment deleted."); done && done(); } catch (x) { toast(x.message, "err"); }
  });
}

async function requests() {
  const admin = ME.role === "admin";
  view().innerHTML = header(admin ? "Enrollment records" : "Enrollment requests", admin ? "View and manage enrollment records." : "Review the subjects students selected, then approve or reject.") +
    `<div class="card"><div class="filters"><input class="grow" id="q" type="search" placeholder="Search student name or ID" aria-label="Search students">
      <select id="st" aria-label="Status"><option value="">All statuses</option><option value="pending" ${admin ? "" : "selected"}>Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
      <select id="br" aria-label="Branch">${filterOptions(LOOK.branches, "All branches")}</select>
      <select id="pd" aria-label="Term"><option value="current">Current term</option><option value="all">All terms</option></select></div><div id="tbl"><div class="loading">Loading…</div></div></div>`;
  const load = async () => {
    const box = $("#tbl");
    try {
      const { enrollments: rows } = await api("GET", "/api/staff/enrollments?" + qs({ q: $("#q").value.trim(), status: $("#st").value, branch_id: $("#br").value, period: $("#pd").value }));
      box.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Branch</th><th>Program</th><th>Term</th><th class="num">Subjects / units</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><strong>${esc(r.full_name)}</strong><div class="muted small">${esc(r.student_no)}</div></td><td>${esc(r.branch_name.replace("AICS ", ""))}</td><td>${esc(r.program_code)} · ${r.year_level}</td>
        <td>${esc(r.school_year)}<div class="muted small">${esc(r.semester)}</div></td><td class="num">${r.n_subjects} / ${r.total_units}</td><td>${fmtDT(r.submitted_at)}</td><td>${badge(r.status)}</td>
        <td class="actions"><button class="btn btn-sm ${r.status === "pending" && !admin ? "btn-primary" : ""}" data-review="${r.id}">${r.status === "pending" && !admin ? "Review" : "View"}</button> <a class="btn btn-sm" href="#/record/${r.student_id}">Record</a></td></tr>`).join("")}</tbody></table></div>`
        : empty("No enrollment records match these filters.");
      box.querySelectorAll("[data-review]").forEach((b) => b.addEventListener("click", () => reviewModal(+b.dataset.review, load)));
    } catch (e) { box.innerHTML = `<div class="note">${esc(e.message)}</div>`; }
  };
  ["#st", "#br", "#pd"].forEach((s) => $(s).addEventListener("change", load));
  $("#q").addEventListener("input", debounce(load, 250));
  load();
}

async function studentSearch() {
  view().innerHTML = header("Student records", "Search and filter, then open a student's record.") +
    `<div class="card"><div class="filters"><input class="grow" id="q" type="search" placeholder="Search student name or ID" aria-label="Search students">
      <select id="br" aria-label="Branch">${filterOptions(LOOK.branches, "All branches")}</select><select id="pg" aria-label="Program">${filterOptions(LOOK.programs, "All programs", "id", "code")}</select>
      <select id="yr" aria-label="Year level"><option value="">All years</option>${[1, 2, 3, 4].map((y) => `<option value="${y}">${YEARS[y]}</option>`).join("")}</select></div><div id="tbl"><div class="loading">Loading…</div></div></div>`;
  const load = async () => {
    const box = $("#tbl");
    try {
      const { students } = await api("GET", "/api/staff/students?" + qs({ q: $("#q").value.trim(), branch_id: $("#br").value, program_id: $("#pg").value, year_level: $("#yr").value }));
      box.innerHTML = students.length ? `<div class="table-wrap"><table><thead><tr><th>Student ID</th><th>Name</th><th>Branch</th><th>Program</th><th>Year</th><th>Status</th><th></th></tr></thead><tbody>
        ${students.map((s) => `<tr><td><strong>${esc(s.student_no)}</strong></td><td>${esc(s.full_name)}</td><td>${esc(s.branch_name.replace("AICS ", ""))}</td><td>${esc(s.program_code)}</td><td>${s.year_level}</td><td>${onOff(s.status === "active")}</td>
        <td class="actions"><a class="btn btn-sm btn-primary" href="#/record/${s.id}">Open record</a></td></tr>`).join("")}</tbody></table></div><p class="muted small">${students.length} student(s) shown.</p>` : empty("No students match these filters.");
    } catch (e) { box.innerHTML = `<div class="note">${esc(e.message)}</div>`; }
  };
  ["#br", "#pg", "#yr"].forEach((s) => $(s).addEventListener("change", load));
  $("#q").addEventListener("input", debounce(load, 250));
  load();
}

async function studentRecord(id) {
  loading();
  const { student: s, enrollments: es } = await api("GET", "/api/staff/students/" + +id), latest = es[0];
  view().innerHTML = header(s.full_name, `${s.student_no} · ${s.program_code} · ${YEARS[s.year_level]} · ${s.branch_name}`,
    `<div>${latest ? printBtn(latest.id) : `<button class="btn btn-primary" disabled title="No enrollment to print yet">${ICON.print}Print Record</button>`}</div>`) +
    `<p><a href="#/${ME.role === "admin" ? "students" : "students"}">&larr; All students</a></p>
    <div class="card"><h3>Student information</h3>${dl([["Student ID", s.student_no], ["Full name", s.full_name], ["Program", s.program_name], ["Year level", YEARS[s.year_level]], ["Branch", s.branch_name], ["Email", s.email], ["Contact", s.contact], ["Address", s.address], ["Status", s.status]])}</div>
    <div class="card"><h3>Enrollment history</h3>${es.length ? `<div class="timeline">${es.map((e) => `<section class="enr"><div class="card-head"><h3>${esc(e.school_year)} · ${esc(e.semester)}</h3>${badge(e.status)}</div>
      <p class="muted small">Submitted ${fmtDT(e.submitted_at)}${e.reviewed_at ? ` · Reviewed ${fmtDT(e.reviewed_at)}${e.reviewer ? " by " + esc(e.reviewer) : ""}` : ""}${e.remarks ? ` · Remarks: ${esc(e.remarks)}` : ""}</p>
      ${itemsTable(e.items, e.total_units)}<p>${printBtn(e.id, "Print Record", "")} ${e.status === "pending" ? `<button class="btn btn-primary" data-review="${e.id}">${ME.role === "registrar" ? "Review" : "View"}</button>` : ""}</p></section>`).join("")}</div>` : empty("This student has no enrollment records yet.")}</div>`;
  view().querySelectorAll("[data-review]").forEach((b) => b.addEventListener("click", () => reviewModal(+b.dataset.review, () => studentRecord(id))));
}

/* ------------------------------------------------------------ ADMIN CRUD (one engine, seven resources) */
const L = (k, label, key = "id", text = "name") => () => [["", label]].concat(LOOK[k].filter((x) => x.active !== 0).map((x) => [x[key], x[text]]));
const SEM = ["1st Semester", "2nd Semester", "Summer"].map((x) => [x, x]);
const YR = [["", "Any year"]].concat([1, 2, 3, 4].map((y) => [y, YEARS[y]]));
const CRUD = {
  users: { title: "Users", sub: "Create staff accounts, assign roles and activate or deactivate accounts. Student accounts are managed under Students.", noun: "user", activeKey: "active",
    cols: [["username", "Username"], ["full_name", "Name"], ["role", "Role", (r) => `<span class="badge b-info">${esc(r.role)}</span>`], ["email", "Email"], ["active", "Status", (r) => onOff(r.active)]],
    filters: [{ n: "role", opts: () => [["", "All roles"], ["student", "student"], ["registrar", "registrar"], ["admin", "admin"]] }, { n: "active", opts: () => [["", "Any status"], ["1", "Active"], ["0", "Inactive"]] }],
    fields: [{ n: "username", l: "Username", req: 1, max: 40 }, { n: "full_name", l: "Full name", req: 1, max: 80 }, { n: "email", l: "Email", t: "email", max: 120 },
      { n: "role", l: "Role", t: "select", req: 1, opts: (row) => [["registrar", "Registrar"], ["admin", "Admin"]].concat(row && row.role === "student" ? [["student", "Student"]] : []), lock: (row) => row && row.role === "student" },
      { n: "password", l: "Password", t: "password", createReq: 1, hint: "8+ characters with a letter and a number. Leave blank to keep the current password.", max: 72 }, { n: "active", l: "Account is active", t: "check", def: true }] },
  students: { title: "Students", sub: "Add, edit and deactivate student accounts and academic profiles.", noun: "student", activeKey: "status", record: true,
    cols: [["student_no", "Student ID"], ["full_name", "Name"], ["branch_code", "Branch"], ["program_code", "Program"], ["year_level", "Year"], ["status", "Status", (r) => onOff(r.status === "active")]],
    filters: [{ n: "branch_id", opts: L("branches", "All branches") }, { n: "program_id", opts: L("programs", "All programs", "id", "code") }, { n: "year_level", opts: () => [["", "All years"]].concat([1, 2, 3, 4].map((y) => [y, YEARS[y]])) }, { n: "status", opts: () => [["", "Any status"], ["active", "Active"], ["inactive", "Inactive"]] }],
    fields: [{ n: "student_no", l: "Student ID", req: 1, createOnly: 1, ph: "2026-000150", hint: "Format YYYY-NNNNNN. This is also the login username." }, { n: "full_name", l: "Full name", req: 1, max: 80 }, { n: "email", l: "Email", t: "email", req: 1, max: 120 },
      { n: "branch_id", l: "Branch", t: "select", req: 1, opts: L("branches", "Choose a branch") }, { n: "program_id", l: "Program", t: "select", req: 1, opts: L("programs", "Choose a program") },
      { n: "year_level", l: "Year level", t: "select", req: 1, opts: () => [["", "Choose a year"]].concat([1, 2, 3, 4].map((y) => [y, YEARS[y]])) },
      { n: "contact", l: "Contact number", max: 20 }, { n: "address", l: "Address", max: 200 }, { n: "password", l: "Initial password", t: "password", createOnly: 1, createReq: 1, hint: "8+ characters with a letter and a number." },
      { n: "status", l: "Status", t: "select", editOnly: 1, opts: () => [["active", "Active"], ["inactive", "Inactive"]] }] },
  branches: { title: "Branches", sub: "AICS campuses. Students and sections belong to a branch.", noun: "branch", activeKey: "active",
    cols: [["code", "Code"], ["name", "Branch"], ["address", "Address"], ["active", "Status", (r) => onOff(r.active)]], filters: [{ n: "active", opts: () => [["", "Any status"], ["1", "Active"], ["0", "Inactive"]] }],
    fields: [{ n: "code", l: "Code", req: 1, max: 10, ph: "COM" }, { n: "name", l: "Branch name", req: 1, max: 80, ph: "AICS Commonwealth" }, { n: "address", l: "Address", max: 200 }, { n: "active", l: "Branch is active", t: "check", def: true }] },
  programs: { title: "Programs", sub: "Degree programs offered by AICS.", noun: "program", activeKey: "active",
    cols: [["code", "Code"], ["name", "Program"], ["active", "Status", (r) => onOff(r.active)]], filters: [{ n: "active", opts: () => [["", "Any status"], ["1", "Active"], ["0", "Inactive"]] }],
    fields: [{ n: "code", l: "Code", req: 1, max: 10, ph: "BSCS" }, { n: "name", l: "Program name", req: 1, max: 100 }, { n: "active", l: "Program is active", t: "check", def: true }] },
  subjects: { title: "Subjects", sub: "The subject catalog. A subject with no program is common to every program.", noun: "subject", activeKey: "active",
    cols: [["code", "Code"], ["title", "Title"], ["units", "Units"], ["program_code", "Program", (r) => esc(r.program_code || "All")], ["year_level", "Year", (r) => esc(r.year_level || "Any")], ["active", "Status", (r) => onOff(r.active)]],
    filters: [{ n: "program_id", opts: L("programs", "All programs", "id", "code") }, { n: "year_level", opts: () => [["", "All years"]].concat([1, 2, 3, 4].map((y) => [y, YEARS[y]])) }, { n: "active", opts: () => [["", "Any status"], ["1", "Active"], ["0", "Inactive"]] }],
    fields: [{ n: "code", l: "Subject code", req: 1, max: 12, ph: "CS101" }, { n: "title", l: "Title", req: 1, max: 100 }, { n: "units", l: "Units", t: "number", req: 1, min: 1, max: 6 },
      { n: "program_id", l: "Program", t: "select", opts: L("programs", "All programs") }, { n: "year_level", l: "Year level", t: "select", opts: () => YR }, { n: "active", l: "Subject is active", t: "check", def: true }] },
  sections: { title: "Sections", sub: "A section is a subject offered in one branch for one term, with a schedule and capacity.", noun: "section", activeKey: "active",
    cols: [["subject_code", "Subject", (r) => `<strong>${esc(r.subject_code)}</strong><div class="muted small">${esc(r.subject_title)}</div>`], ["branch_code", "Branch"], ["name", "Section"],
      ["days", "Schedule", (r) => esc(`${r.days} ${r.time_start}-${r.time_end}`)], ["taken", "Enrolled", (r) => `${r.taken} / ${r.capacity}`], ["school_year", "Term", (r) => esc(`${r.school_year} ${r.semester}`)], ["active", "Status", (r) => onOff(r.active)]],
    filters: [{ n: "branch_id", opts: L("branches", "All branches") }, { n: "period_id", opts: () => [["", "All terms"]].concat(LOOK.periods.map((p) => [p.id, `${p.school_year} ${p.semester}`])), def: () => (PERIOD ? PERIOD.id : "") }],
    fields: [{ n: "subject_id", l: "Subject", t: "select", req: 1, opts: () => [["", "Choose a subject"]].concat(LOOK.subjects.map((s) => [s.id, `${s.code} - ${s.title}`])) },
      { n: "branch_id", l: "Branch", t: "select", req: 1, opts: L("branches", "Choose a branch") }, { n: "period_id", l: "Term", t: "select", req: 1, opts: () => [["", "Choose a term"]].concat(LOOK.periods.map((p) => [p.id, `${p.school_year} ${p.semester}`])) },
      { n: "name", l: "Section name", req: 1, max: 20, ph: "A" }, { n: "days", l: "Days", req: 1, ph: "MW", hint: "Use M, T, W, Th, F, S. Examples: MW, TTh, F." },
      { n: "time_start", l: "Start time", t: "time", req: 1 }, { n: "time_end", l: "End time", t: "time", req: 1 }, { n: "room", l: "Room", max: 30 }, { n: "capacity", l: "Capacity", t: "number", req: 1, min: 1, max: 200, def: 40 },
      { n: "active", l: "Section is open", t: "check", def: true }] },
  periods: { title: "School years and semesters", sub: "Only one term is current. Students enroll in the current term while enrollment is open.", noun: "term", noDelete: true,
    cols: [["school_year", "School year"], ["semester", "Semester"], ["is_current", "Current", (r) => onOff(r.is_current, "Current", "-")], ["enrollment_open", "Enrollment", (r) => onOff(r.enrollment_open, "Open", "Closed")]], filters: [],
    fields: [{ n: "school_year", l: "School year", req: 1, ph: "2026-2027", max: 9 }, { n: "semester", l: "Semester", t: "select", req: 1, opts: () => SEM },
      { n: "is_current", l: "Make this the current term", t: "check" }, { n: "enrollment_open", l: "Enrollment is open", t: "check" }] },
};

function crudView(key) {
  return async () => {
    const c = CRUD[key];
    view().innerHTML = header(c.title, c.sub, `<button class="btn btn-primary" id="add">Add ${esc(c.noun)}</button>`) +
      `<div class="card"><div class="filters"><input class="grow" id="q" type="search" placeholder="Search ${esc(c.title.toLowerCase())}" aria-label="Search">
      ${c.filters.map((f, i) => `<select data-f="${f.n}" aria-label="${esc(f.n)}">${f.opts().map(([v, t]) => `<option value="${esc(v)}" ${f.def && String(f.def()) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`).join("")}</div><div id="tbl"><div class="loading">Loading…</div></div></div>`;
    let rows = [];
    const load = async () => {
      const f = { q: $("#q").value.trim() }; view().querySelectorAll("[data-f]").forEach((s) => (f[s.dataset.f] = s.value));
      const box = $("#tbl");
      try {
        rows = (await api("GET", `/api/admin/${key}?` + qs(f))).rows;
        box.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr>${c.cols.map((x) => `<th>${esc(x[1])}</th>`).join("")}<th></th></tr></thead><tbody>
          ${rows.map((r, i) => { const on = c.activeKey === "status" ? r.status === "active" : r.active === 1; return `<tr>${c.cols.map((x) => `<td>${x[2] ? x[2](r) : esc(r[x[0]] ?? "-")}</td>`).join("")}
          <td class="actions">${c.record ? `<a class="btn btn-sm" href="#/record/${r.id}">Record</a> ` : ""}<button class="btn btn-sm" data-edit="${i}">Edit</button>
          ${c.noDelete ? "" : on ? `<button class="btn btn-sm btn-danger" data-off="${i}">Deactivate</button>` : `<button class="btn btn-sm" data-on="${i}">Reactivate</button>`}</td></tr>`; }).join("")}</tbody></table></div><p class="muted small">${rows.length} record(s).</p>` : empty(`No ${c.title.toLowerCase()} match. Use "Add ${c.noun}" to create one.`);
      } catch (e) { box.innerHTML = `<div class="note">${esc(e.message)}</div>`; }
    };
    $("#tbl").addEventListener("click", async (ev) => {
      const b = ev.target.closest("button[data-edit],button[data-off],button[data-on]"); if (!b) return;
      const row = rows[+(b.dataset.edit ?? b.dataset.off ?? b.dataset.on)];
      if (b.dataset.edit !== undefined) return formModal(key, row, load);
      const label = row.full_name || row.title || row.name || row.code || row.username || row.subject_code;
      try {
        if (b.dataset.off !== undefined) {
          if (!(await confirmBox(`Deactivate ${c.noun}?`, `"${label}" will be hidden from new enrollment and, for accounts, unable to log in. Existing records are kept.`, "Deactivate", true))) return;
          await api("DELETE", `/api/admin/${key}/${row.id}`); toast("Deactivated.");
        } else { await api("PUT", `/api/admin/${key}/${row.id}`, { [c.activeKey]: c.activeKey === "status" ? "active" : true }); toast("Reactivated."); }
        if (key !== "users" && key !== "students") LOOK = await api("GET", "/api/lookups");
        load();
      } catch (e) { toast(e.message, "err"); }
    });
    $("#add").addEventListener("click", () => formModal(key, null, load));
    view().querySelectorAll("[data-f]").forEach((s) => s.addEventListener("change", load));
    $("#q").addEventListener("input", debounce(load, 250));
    load();
  };
}

function formModal(key, row, done) {
  const c = CRUD[key], edit = !!row;
  const fields = c.fields.filter((f) => !(edit && f.createOnly) && !(!edit && f.editOnly));
  const input = (f) => {
    const v = edit ? row[f.n] : f.def, id = "f-" + f.n, lock = f.lock && f.lock(row) ? "disabled" : "";
    if (f.t === "check") return `<label class="chk"><input type="checkbox" id="${id}" name="${f.n}" ${v === true || v === 1 ? "checked" : ""}> ${esc(f.l)}</label>`;
    if (f.t === "select") return `<label for="${id}">${esc(f.l)}</label><select id="${id}" name="${f.n}" ${lock}>${f.opts(row).map(([val, t]) => `<option value="${esc(val)}" ${String(v ?? "") === String(val) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
    const type = f.t === "number" ? "number" : f.t || "text";
    return `<label for="${id}">${esc(f.l)}${f.req || (f.createReq && !edit) ? "" : ' <span class="muted">(optional)</span>'}</label>
      <input id="${id}" name="${f.n}" type="${type}" value="${f.t === "password" ? "" : esc(v ?? "")}" ${f.max ? `maxlength="${f.max}"` : ""} ${f.min != null ? `min="${f.min}" max="${f.max}"` : ""} ${f.ph ? `placeholder="${esc(f.ph)}"` : ""} ${f.t === "password" ? 'autocomplete="new-password"' : ""}>${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ""}`;
  };
  const m = openModal(`<h3>${edit ? "Edit" : "Add"} ${esc(c.noun)}</h3><form id="cf" novalidate><div class="form-grid">${fields.map((f) => `<div class="field ${["address", "title", "name"].includes(f.n) && f.t !== "select" ? "span2" : ""}">${input(f)}<p class="field-error" data-for="${f.n}"></p></div>`).join("")}</div>
    <p class="field-error" id="ferr" hidden></p><div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">${edit ? "Save changes" : "Add " + esc(c.noun)}</button></div></form>`);
  $("#cf", m.el).addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target; showFieldErrors(f, {}); $("#ferr", f).hidden = true;
    const data = {}, local = {};
    fields.forEach((fd) => {
      const el = f.elements[fd.n]; let v = fd.t === "check" ? el.checked : el.value.trim();
      if (el.disabled) return;
      if (fd.t === "password" && !v) { if (!edit && fd.createReq) local[fd.n] = "This field is required."; return; }
      if (fd.req && v === "") local[fd.n] = "This field is required.";
      if (fd.t === "number" && v !== "" && (+v < fd.min || +v > fd.max)) local[fd.n] = `Must be between ${fd.min} and ${fd.max}.`;
      if (fd.t === "select" && v === "" && !fd.req) v = null;
      data[fd.n] = v;
    });
    if (Object.keys(local).length) return showFieldErrors(f, local);
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      await api(edit ? "PUT" : "POST", `/api/admin/${key}${edit ? "/" + row.id : ""}`, data);
      m.close(); toast(edit ? "Changes saved." : "Added."); LOOK = await api("GET", "/api/lookups"); done();
    } catch (e) { showFieldErrors(f, e.fields); const fe = $("#ferr", f); fe.textContent = e.message; fe.hidden = false; btn.disabled = false; }
  });
}

/* ------------------------------------------------------------ router + boot */
const NAV = {
  student: [["dashboard", "Dashboard", "home"], ["profile", "My profile", "user"], ["enroll", "Enroll subjects", "book"], ["status", "Enrollment status", "check"], ["schedule", "My schedule", "cal"]],
  registrar: [["dashboard", "Dashboard", "home"], ["requests", "Enrollment requests", "inbox"], ["students", "Student records", "users"]],
  admin: [["dashboard", "Dashboard", "home"], ["enrollments", "Enrollments", "inbox"], ["students", "Students", "users"], ["users", "Users", "shield"], ["branches", "Branches", "pin"],
    ["programs", "Programs", "cap"], ["subjects", "Subjects", "book"], ["sections", "Sections", "grid"], ["periods", "School years", "cal"]],
};
const VIEWS = {
  student: { dashboard: sDashboard, profile: sProfile, enroll: sEnroll, status: sStatus, schedule: sSchedule },
  registrar: { dashboard: staffDash, requests, students: studentSearch, record: studentRecord },
  admin: { dashboard: staffDash, enrollments: requests, record: studentRecord, students: crudView("students"), users: crudView("users"), branches: crudView("branches"),
    programs: crudView("programs"), subjects: crudView("subjects"), sections: crudView("sections"), periods: crudView("periods") },
};

async function route() {
  const [name, arg] = (location.hash.replace(/^#\//, "") || "dashboard").split("/");
  const views = VIEWS[ME.role], key = views[name] ? name : "dashboard";
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.r === key || (key === "record" && a.dataset.r === "students")));
  $("#sidebar").classList.remove("open");
  try { await views[key](arg); view().focus({ preventScroll: true }); window.scrollTo(0, 0); } catch (e) { if (e.message !== "Session ended") failView(e); }
}

async function boot() {
  try {
    const me = await api("GET", "/api/me");
    ME = me.user; CSRF = me.csrf; PERIOD = me.period;
    if (ME.role !== "student") LOOK = await api("GET", "/api/lookups");
  } catch (e) { return; }
  $("#nav").innerHTML = NAV[ME.role].map(([r, t, i]) => `<a href="#/${r}" data-r="${r}">${ICON[i]}<span>${esc(t)}</span></a>`).join("");
  $("#logout-btn").innerHTML = ICON.logout + "<span>Log out</span>";
  $("#menu-btn").innerHTML = ICON.menu;
  $("#menu-btn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#logout-btn").addEventListener("click", async () => { try { await api("POST", "/api/logout", {}); } catch (_) { /* ignore */ } location.href = "/login"; });
  $("#avatar").textContent = ME.full_name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  $("#uname").textContent = ME.full_name; $("#urole").textContent = ME.role[0].toUpperCase() + ME.role.slice(1);
  $("#period-chip").innerHTML = PERIOD ? `<span class="chip">${esc(PERIOD.school_year)} · ${esc(PERIOD.semester)}</span>` : "No active term";
  window.addEventListener("hashchange", route);
  route();
}
boot();
