"""AICS Enrollment System — Flask backend.

Layers:  routes (this file + admin_api.py)  ->  db.py (SQLite, parameterized SQL)
Security: server-side RBAC on every /api route, hashed passwords, CSRF token,
          session expiry, login throttling, security headers, output escaping in the UI.
"""
import os, re, secrets, sqlite3, time
from datetime import timedelta
from functools import wraps

from flask import (Flask, abort, g, jsonify, redirect, render_template, request,
                   session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

import db as dbm
from db import audit, get_db, now, tx

MAX_UNITS = 24
DAY_RE = re.compile(r"Th|M|T|W|F|S")
_DUMMY_HASH = generate_password_hash("not-a-real-password")
_attempts = {}


class ApiError(Exception):
    def __init__(self, msg, status=400, fields=None):
        self.msg, self.status, self.fields = msg, status, fields or {}


# ----------------------------------------------------------------- helpers
def throttled(key, limit, window):
    t = time.time()
    _attempts[key] = [x for x in _attempts.get(key, []) if t - x < window]
    return len(_attempts[key]) >= limit


def hit(key):
    _attempts.setdefault(key, []).append(time.time())


def password_problem(pw):
    if not isinstance(pw, str) or len(pw) < 8 or len(pw) > 72:
        return "Password must be 8 to 72 characters."
    if not (re.search(r"[A-Za-z]", pw) and re.search(r"\d", pw)):
        return "Password must contain at least one letter and one number."
    return None


def fmt_time(t):
    h, m = int(t[:2]), t[3:5]
    return f"{(h % 12) or 12}:{m} {'AM' if h < 12 else 'PM'}"


def schedule_text(r):
    return f"{r['days']} {fmt_time(r['time_start'])} - {fmt_time(r['time_end'])}"


def overlaps(a, b):
    return (set(DAY_RE.findall(a["days"])) & set(DAY_RE.findall(b["days"]))
            and a["time_start"] < b["time_end"] and b["time_start"] < a["time_end"])


def body():
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        raise ApiError("Expected a JSON object.", 400)
    return d


def current_user():
    if "user" not in g:
        g.user = None
        uid = session.get("uid")
        if uid:
            r = get_db().execute("SELECT id,username,full_name,email,role,active FROM users WHERE id=?", (uid,)).fetchone()
            if r and r["active"]:
                g.user = dict(r)            # role is ALWAYS read from the database, never from the browser
    return g.user


def api(roles=None):
    """Decorator: must be logged in, role must be allowed, state-changing calls need the CSRF header."""
    def deco(f):
        @wraps(f)
        def wrapper(*a, **kw):
            u = current_user()
            if not u:
                raise ApiError("Please log in.", 401)
            if roles and u["role"] not in roles:
                raise ApiError("You do not have permission to do that.", 403)
            if request.method not in ("GET", "HEAD"):
                tok = request.headers.get("X-CSRF-Token", "")
                if not tok or not secrets.compare_digest(tok, session.get("csrf", "")):
                    raise ApiError("Security token missing or expired. Reload the page.", 403)
            return f(*a, **kw)
        return wrapper
    return deco


def current_period(db):
    return db.execute("SELECT * FROM periods WHERE is_current=1").fetchone()


def my_student(db):
    s = db.execute("""SELECT s.*, u.full_name, u.email, b.name branch_name, p.name program_name, p.code program_code
                      FROM students s JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id
                      JOIN programs p ON p.id=s.program_id WHERE s.user_id=?""", (g.user["id"],)).fetchone()
    if not s or s["status"] != "active":
        raise ApiError("Your student record is not active. Please contact the registrar.", 403)
    return dict(s)


SECTION_SQL = """
SELECT sec.id, sec.name section_name, sec.days, sec.time_start, sec.time_end, sec.room, sec.capacity, sec.branch_id,
       sub.id subject_id, sub.code, sub.title, sub.units, sub.program_id, sub.year_level, b.name branch_name,
       (SELECT COUNT(*) FROM enrollment_items ei JOIN enrollments e ON e.id=ei.enrollment_id
         WHERE ei.section_id=sec.id AND e.status IN ('pending','approved')) taken
FROM sections sec JOIN subjects sub ON sub.id=sec.subject_id JOIN branches b ON b.id=sec.branch_id
"""


def with_schedule(rows):
    out = []
    for r in rows:
        d = dict(r)
        d["schedule"] = schedule_text(d)
        if "taken" in d:
            d["seats_left"] = max(d["capacity"] - d["taken"], 0)
        out.append(d)
    return out


def enrollment_detail(db, eid):
    e = db.execute("""SELECT e.*, per.school_year, per.semester, s.student_no, s.year_level, s.contact, s.address,
                             u.full_name, u.email, b.name branch_name, p.name program_name, p.code program_code,
                             rv.full_name reviewer
                      FROM enrollments e JOIN periods per ON per.id=e.period_id JOIN students s ON s.id=e.student_id
                      JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id JOIN programs p ON p.id=s.program_id
                      LEFT JOIN users rv ON rv.id=e.reviewed_by WHERE e.id=?""", (eid,)).fetchone()
    if not e:
        return None
    d = dict(e)
    d["items"] = with_schedule(db.execute(
        "SELECT sec.id, sec.name section_name, sec.days, sec.time_start, sec.time_end, sec.room, sub.code, sub.title, sub.units "
        "FROM enrollment_items ei JOIN sections sec ON sec.id=ei.section_id JOIN subjects sub ON sub.id=sec.subject_id "
        "WHERE ei.enrollment_id=? ORDER BY sub.code", (eid,)).fetchall())
    d["total_units"] = sum(i["units"] for i in d["items"])
    return d


# ----------------------------------------------------------------- app factory
def create_app(config=None):
    app = Flask(__name__)
    inst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instance")
    os.makedirs(inst, exist_ok=True)
    key = os.environ.get("SECRET_KEY")
    if not key:                                   # generated once, kept out of git (instance/ is ignored)
        kf = os.path.join(inst, "secret.key")
        if not os.path.exists(kf):
            with open(kf, "w") as f:
                f.write(secrets.token_hex(32))
        with open(kf) as f:
            key = f.read().strip()
    app.config.update(
        SECRET_KEY=key, DATABASE=os.path.join(inst, "aics.db"),
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE") == "1",
        PERMANENT_SESSION_LIFETIME=timedelta(minutes=30),   # idle timeout (cookie refreshed on each request)
        MAX_CONTENT_LENGTH=64 * 1024,
        DEMO_MODE=os.environ.get("DEMO_MODE", "1") == "1")
    if config:
        app.config.update(config)
    if not os.path.exists(app.config["DATABASE"]):
        dbm.init_db(app.config["DATABASE"])
    app.teardown_appcontext(dbm.close_db)

    from admin_api import bp as admin_bp
    app.register_blueprint(admin_bp)

    # ---- errors / headers
    @app.errorhandler(ApiError)
    def _api_error(e):
        if request.path.startswith("/api/"):
            return jsonify(error=e.msg, fields=e.fields), e.status
        return render_template("error.html", code=e.status, msg=e.msg), e.status

    @app.errorhandler(sqlite3.IntegrityError)
    def _integrity(_e):
        return jsonify(error="That value already exists or refers to a record that does not exist.", fields={}), 409

    @app.errorhandler(404)
    @app.errorhandler(405)
    @app.errorhandler(413)
    def _http(e):
        if request.path.startswith("/api/"):
            return jsonify(error="Not found." if e.code == 404 else "Request not allowed.", fields={}), e.code
        return render_template("error.html", code=e.code, msg="The page you asked for is not available."), e.code

    @app.errorhandler(500)
    def _500(_e):
        if request.path.startswith("/api/"):
            return jsonify(error="Something went wrong on the server.", fields={}), 500
        return render_template("error.html", code=500, msg="Something went wrong on the server."), 500

    @app.after_request
    def _headers(r):
        r.headers["Content-Security-Policy"] = ("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                                                "script-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'")
        r.headers["X-Content-Type-Options"] = "nosniff"
        r.headers["X-Frame-Options"] = "DENY"
        r.headers["Referrer-Policy"] = "same-origin"
        if request.path.startswith(("/api/", "/app", "/print/")):
            r.headers["Cache-Control"] = "no-store"
        return r

    # ---------------------------------------------------------- public pages
    @app.get("/")
    def home():
        db = get_db()
        return render_template("home.html",
                               branches=db.execute("SELECT * FROM branches WHERE active=1 ORDER BY name").fetchall(),
                               programs=db.execute("SELECT * FROM programs WHERE active=1 ORDER BY name").fetchall())

    @app.get("/login")
    def login_page():
        if current_user():
            return redirect(url_for("app_shell"))
        return render_template("login.html", demo=app.config["DEMO_MODE"])

    @app.get("/register")
    def register_page():
        db = get_db()
        return render_template("register.html",
                               branches=db.execute("SELECT id,name FROM branches WHERE active=1 ORDER BY name").fetchall(),
                               programs=db.execute("SELECT id,code,name FROM programs WHERE active=1 ORDER BY name").fetchall())

    @app.get("/app")
    def app_shell():
        if not current_user():
            return redirect(url_for("login_page"))
        return render_template("app.html")

    @app.get("/print/enrollment/<int:eid>")
    def print_enrollment(eid):
        u = current_user()
        if not u:
            return redirect(url_for("login_page"))
        db = get_db()
        d = enrollment_detail(db, eid)
        if not d:
            abort(404)
        if u["role"] == "student":                       # IDOR guard: students may only print their own record
            s = db.execute("SELECT id FROM students WHERE user_id=?", (u["id"],)).fetchone()
            if not s or s["id"] != d["student_id"]:
                abort(404)
        audit(db, u["id"], "print_record", f"enrollment {eid}")
        return render_template("print_record.html", e=d, printed_by=u, printed_on=now())

    # ---------------------------------------------------------- auth API
    @app.post("/api/login")
    def login():
        d = body()
        username, pw = str(d.get("username", "")).strip()[:60], str(d.get("password", ""))[:200]
        key = ("login", request.remote_addr, username.lower())
        if throttled(key, 5, 300):
            raise ApiError("Too many failed attempts. Try again in 5 minutes.", 429)
        db = get_db()
        u = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        ok = check_password_hash(u["password_hash"] if u else _DUMMY_HASH, pw)
        if not (u and ok):
            hit(key)
            raise ApiError("Invalid username or password.", 401)
        if not u["active"]:
            raise ApiError("This account is deactivated. Please contact the registrar.", 403)
        _attempts.pop(key, None)
        session.clear()                                   # new session on login (prevents session fixation)
        session.permanent = True
        session["uid"], session["csrf"] = u["id"], secrets.token_hex(16)
        audit(db, u["id"], "login")
        return jsonify(ok=True, role=u["role"])

    @app.post("/api/logout")
    @api()
    def logout():
        audit(get_db(), g.user["id"], "logout")
        session.clear()
        return jsonify(ok=True)

    @app.get("/api/me")
    @api()
    def me():
        db = get_db()
        out = {"user": g.user, "csrf": session["csrf"], "demo": app.config["DEMO_MODE"],
               "period": (lambda p: dict(p) if p else None)(current_period(db))}
        if g.user["role"] == "student":
            out["student"] = my_student(db)
        return jsonify(out)

    @app.get("/api/lookups")
    @api()
    def lookups():
        db = get_db()
        q = lambda sql: [dict(r) for r in db.execute(sql).fetchall()]
        return jsonify(branches=q("SELECT id,code,name,active FROM branches ORDER BY name"),
                       programs=q("SELECT id,code,name,active FROM programs ORDER BY name"),
                       subjects=q("SELECT id,code,title FROM subjects WHERE active=1 ORDER BY code"),
                       periods=q("SELECT id,school_year,semester,is_current FROM periods ORDER BY school_year DESC, semester"))

    @app.post("/api/register")
    def register():
        d = body()
        db = get_db()
        if throttled(("reg", request.remote_addr), 10, 3600):
            raise ApiError("Too many registrations from this device. Try again later.", 429)
        err = {}
        name = " ".join(str(d.get("full_name", "")).split())
        email = str(d.get("email", "")).strip()
        if not (2 <= len(name) <= 80) or not re.fullmatch(r"[A-Za-z0-9 .,'\-ñÑ]+", name):
            err["full_name"] = "Enter your full name (letters, spaces, . , ' - only)."
        if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,120}\.[^@\s]{2,}", email):
            err["email"] = "Enter a valid email address."
        pw_err = password_problem(d.get("password"))
        if pw_err:
            err["password"] = pw_err
        try:
            bid, pid, yr = int(d.get("branch_id")), int(d.get("program_id")), int(d.get("year_level"))
        except (TypeError, ValueError):
            bid = pid = yr = 0
        if not db.execute("SELECT 1 FROM branches WHERE id=? AND active=1", (bid,)).fetchone():
            err["branch_id"] = "Choose a branch."
        if not db.execute("SELECT 1 FROM programs WHERE id=? AND active=1", (pid,)).fetchone():
            err["program_id"] = "Choose a program."
        if yr not in (1, 2, 3, 4):
            err["year_level"] = "Choose a year level."
        if err:
            raise ApiError("Please fix the highlighted fields.", 422, err)
        hit(("reg", request.remote_addr))
        with tx(db):
            if db.execute("SELECT 1 FROM users WHERE lower(email)=lower(?) AND role='student'", (email,)).fetchone():
                raise ApiError("An account with that email already exists.", 409, {"email": "Already registered."})
            yr_s = now()[:4]
            last = db.execute("SELECT MAX(CAST(substr(student_no,6) AS INTEGER)) m FROM students WHERE student_no LIKE ?",
                              (yr_s + "-%",)).fetchone()["m"] or 0
            sno = f"{yr_s}-{last + 1:06d}"
            uid = db.execute("INSERT INTO users(username,password_hash,role,full_name,email,active,created_at) VALUES(?,?,?,?,?,1,?)",
                             (sno, generate_password_hash(d["password"]), "student", name, email, now())).lastrowid
            db.execute("INSERT INTO students(student_no,user_id,branch_id,program_id,year_level) VALUES(?,?,?,?,?)",
                       (sno, uid, bid, pid, yr))
            audit(db, uid, "register", sno)
        return jsonify(ok=True, student_no=sno), 201

    # ---------------------------------------------------------- STUDENT API
    @app.get("/api/student/dashboard")
    @api(("student",))
    def s_dashboard():
        db = get_db()
        s, per = my_student(db), current_period(db)
        enr = None
        if per:
            r = db.execute("SELECT id FROM enrollments WHERE student_id=? AND period_id=?", (s["id"], per["id"])).fetchone()
            enr = enrollment_detail(db, r["id"]) if r else None
        hist = db.execute("SELECT COUNT(*) n FROM enrollments WHERE student_id=?", (s["id"],)).fetchone()["n"]
        return jsonify(student=s, period=dict(per) if per else None, enrollment=enr, history_count=hist)

    @app.put("/api/student/me")
    @api(("student",))
    def s_update():
        d, db = body(), get_db()
        email, contact, address = str(d.get("email", "")).strip(), str(d.get("contact", "")).strip(), str(d.get("address", "")).strip()
        err = {}
        if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,120}\.[^@\s]{2,}", email):
            err["email"] = "Enter a valid email address."
        if contact and not re.fullmatch(r"[0-9+\-() ]{7,20}", contact):
            err["contact"] = "Use 7-20 digits (+ - ( ) allowed)."
        if len(address) > 200:
            err["address"] = "Address is too long (200 characters max)."
        if err:
            raise ApiError("Please fix the highlighted fields.", 422, err)
        s = my_student(db)                      # only the logged-in student's own row can be changed
        with tx(db):
            db.execute("UPDATE users SET email=? WHERE id=?", (email, g.user["id"]))
            db.execute("UPDATE students SET contact=?, address=? WHERE id=?", (contact, address, s["id"]))
            audit(db, g.user["id"], "update_profile")
        return jsonify(ok=True)

    def eligible_sections(db, s, per, q="", ids=None):
        sql = SECTION_SQL + """ WHERE sec.period_id=? AND sec.branch_id=? AND sec.active=1 AND sub.active=1
                 AND (sub.program_id IS NULL OR sub.program_id=?) AND (sub.year_level IS NULL OR sub.year_level=?)"""
        args = [per["id"], s["branch_id"], s["program_id"], s["year_level"]]
        if q:
            sql += " AND (sub.code LIKE ? OR sub.title LIKE ?)"
            args += [f"%{q}%", f"%{q}%"]
        if ids is not None:
            sql += f" AND sec.id IN ({','.join('?' * len(ids))})"
            args += ids
        return db.execute(sql + " ORDER BY sub.code", args).fetchall()

    @app.get("/api/student/sections")
    @api(("student",))
    def s_sections():
        db = get_db()
        s, per = my_student(db), current_period(db)
        if not per:
            return jsonify(sections=[], period=None)
        q = request.args.get("q", "").strip()[:50]
        return jsonify(sections=with_schedule(eligible_sections(db, s, per, q)), period=dict(per))

    @app.post("/api/student/enrollment")
    @api(("student",))
    def s_submit():
        d, db = body(), get_db()
        ids = d.get("section_ids")
        if not isinstance(ids, list) or not ids or len(ids) > 12 or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
            raise ApiError("Select at least one subject.", 422)
        ids = list(dict.fromkeys(ids))
        s = my_student(db)
        with tx(db):
            per = current_period(db)
            if not per or not per["enrollment_open"]:
                raise ApiError("Enrollment is not open right now.", 409)
            ex = db.execute("SELECT id,status FROM enrollments WHERE student_id=? AND period_id=?", (s["id"], per["id"])).fetchone()
            if ex and ex["status"] in ("pending", "approved"):
                raise ApiError(f"You already have a {ex['status']} enrollment for this term.", 409)
            secs = [dict(r) for r in eligible_sections(db, s, per, ids=ids)]
            if len(secs) != len(ids):               # also blocks IDs from other branches/programs/years (tampering)
                raise ApiError("One or more selected subjects are not available for your branch, program or year level.", 422)
            if len({x["subject_id"] for x in secs}) != len(secs):
                raise ApiError("You selected the same subject twice.", 422)
            units = sum(x["units"] for x in secs)
            if units > MAX_UNITS:
                raise ApiError(f"Maximum load is {MAX_UNITS} units. You selected {units}.", 422)
            for i, a in enumerate(secs):
                for b in secs[i + 1:]:
                    if overlaps(a, b):
                        raise ApiError(f"Schedule conflict: {a['code']} ({schedule_text(a)}) overlaps {b['code']} ({schedule_text(b)}).", 422)
                if a["taken"] >= a["capacity"]:
                    raise ApiError(f"{a['code']} is already full.", 409)
            if ex:                                   # re-submission after a rejection reuses the same row
                eid = ex["id"]
                db.execute("DELETE FROM enrollment_items WHERE enrollment_id=?", (eid,))
                db.execute("UPDATE enrollments SET status='pending', submitted_at=?, reviewed_by=NULL, reviewed_at=NULL, remarks='' WHERE id=?",
                           (now(), eid))
            else:
                eid = db.execute("INSERT INTO enrollments(student_id,period_id,status,submitted_at) VALUES(?,?,'pending',?)",
                                 (s["id"], per["id"], now())).lastrowid
            db.executemany("INSERT INTO enrollment_items(enrollment_id,section_id) VALUES(?,?)", [(eid, x["id"]) for x in secs])
            audit(db, g.user["id"], "submit_enrollment", f"enrollment {eid}, {units} units")
        return jsonify(ok=True, id=eid, status="pending", total_units=units), 201

    @app.get("/api/student/enrollments")
    @api(("student",))
    def s_history():
        db = get_db()
        s = my_student(db)
        ids = [r["id"] for r in db.execute("SELECT e.id FROM enrollments e JOIN periods p ON p.id=e.period_id "
                                           "WHERE e.student_id=? ORDER BY p.school_year DESC, p.semester DESC, e.id DESC", (s["id"],))]
        return jsonify(enrollments=[enrollment_detail(db, i) for i in ids])

    # ---------------------------------------------------------- STAFF API (registrar + admin read; registrar decides)
    STAFF = ("registrar", "admin")

    @app.get("/api/staff/stats")
    @api(STAFF)
    def stats():
        db = get_db()
        per = current_period(db)
        pid = per["id"] if per else -1
        by = {r["status"]: r["n"] for r in db.execute("SELECT status, COUNT(*) n FROM enrollments WHERE period_id=? GROUP BY status", (pid,))}
        q = lambda sql, a=(): [dict(r) for r in db.execute(sql, a).fetchall()]
        out = dict(
            period=dict(per) if per else None,
            total_students=db.execute("SELECT COUNT(*) n FROM students WHERE status='active'").fetchone()["n"],
            pending=by.get("pending", 0), approved=by.get("approved", 0), rejected=by.get("rejected", 0),
            by_branch=q("SELECT b.name label, COUNT(s.id) n FROM branches b LEFT JOIN students s ON s.branch_id=b.id AND s.status='active' "
                        "WHERE b.active=1 GROUP BY b.id ORDER BY b.name"),
            by_program=q("SELECT p.code label, COUNT(s.id) n FROM programs p LEFT JOIN students s ON s.program_id=p.id AND s.status='active' "
                         "WHERE p.active=1 GROUP BY p.id ORDER BY p.code"),
            recent_pending=q("SELECT e.id, e.submitted_at, u.full_name, s.student_no, p.code program_code FROM enrollments e "
                             "JOIN students s ON s.id=e.student_id JOIN users u ON u.id=s.user_id JOIN programs p ON p.id=s.program_id "
                             "WHERE e.status='pending' AND e.period_id=? ORDER BY e.submitted_at LIMIT 5", (pid,)))
        if g.user["role"] == "admin":
            out["counts"] = {t: db.execute(f"SELECT COUNT(*) n FROM {t} WHERE active=1").fetchone()["n"]
                             for t in ("users", "subjects", "sections", "branches", "programs")}
            out["audit"] = q("SELECT a.at, a.action, a.detail, COALESCE(u.username,'-') username FROM audit_log a "
                             "LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 8")
        return jsonify(out)

    def like(v):
        return f"%{v.strip()[:50]}%"

    @app.get("/api/staff/students")
    @api(STAFF)
    def staff_students():
        a = request.args
        sql = ("SELECT s.id, s.student_no, u.full_name, u.email, s.year_level, s.status, b.name branch_name, p.code program_code "
               "FROM students s JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id JOIN programs p ON p.id=s.program_id WHERE 1=1")
        args = []
        if a.get("q", "").strip():
            sql += " AND (s.student_no LIKE ? OR u.full_name LIKE ?)"
            args += [like(a["q"])] * 2
        for p, col in (("branch_id", "s.branch_id"), ("program_id", "s.program_id"), ("year_level", "s.year_level")):
            if a.get(p, "").isdigit():                  # column names come from this fixed whitelist, values are bound
                sql += f" AND {col}=?"
                args.append(int(a[p]))
        return jsonify(students=[dict(r) for r in get_db().execute(sql + " ORDER BY s.student_no LIMIT 200", args)])

    @app.get("/api/staff/students/<int:sid>")
    @api(STAFF)
    def staff_student(sid):
        db = get_db()
        s = db.execute("SELECT s.*, u.full_name, u.email, b.name branch_name, p.name program_name, p.code program_code "
                       "FROM students s JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id "
                       "JOIN programs p ON p.id=s.program_id WHERE s.id=?", (sid,)).fetchone()
        if not s:
            raise ApiError("Student not found.", 404)
        ids = [r["id"] for r in db.execute("SELECT e.id FROM enrollments e JOIN periods p ON p.id=e.period_id WHERE e.student_id=? "
                                           "ORDER BY p.school_year DESC, p.semester DESC", (sid,))]
        return jsonify(student=dict(s), enrollments=[enrollment_detail(db, i) for i in ids])

    @app.get("/api/staff/enrollments")
    @api(STAFF)
    def staff_enrollments():
        a = request.args
        sql = ("SELECT e.id, e.status, e.submitted_at, e.reviewed_at, s.id student_id, s.student_no, u.full_name, "
               "b.name branch_name, p.code program_code, s.year_level, per.school_year, per.semester, "
               "(SELECT COALESCE(SUM(sub.units),0) FROM enrollment_items ei JOIN sections sec ON sec.id=ei.section_id "
               " JOIN subjects sub ON sub.id=sec.subject_id WHERE ei.enrollment_id=e.id) total_units, "
               "(SELECT COUNT(*) FROM enrollment_items WHERE enrollment_id=e.id) n_subjects "
               "FROM enrollments e JOIN students s ON s.id=e.student_id JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id "
               "JOIN programs p ON p.id=s.program_id JOIN periods per ON per.id=e.period_id WHERE 1=1")
        args = []
        if a.get("status") in ("pending", "approved", "rejected"):
            sql += " AND e.status=?"
            args.append(a["status"])
        if a.get("q", "").strip():
            sql += " AND (s.student_no LIKE ? OR u.full_name LIKE ?)"
            args += [like(a["q"])] * 2
        if a.get("branch_id", "").isdigit():
            sql += " AND s.branch_id=?"
            args.append(int(a["branch_id"]))
        if a.get("period", "current") == "current":
            sql += " AND per.is_current=1"
        return jsonify(enrollments=[dict(r) for r in get_db().execute(sql + " ORDER BY (e.status='pending') DESC, e.submitted_at DESC LIMIT 200", args)])

    @app.get("/api/staff/enrollments/<int:eid>")
    @api(STAFF)
    def staff_enrollment(eid):
        d = enrollment_detail(get_db(), eid)
        if not d:
            raise ApiError("Enrollment not found.", 404)
        return jsonify(enrollment=d)

    @app.post("/api/staff/enrollments/<int:eid>/decision")
    @api(("registrar",))                              # admin is intentionally NOT allowed to approve
    def decide(eid):
        d, db = body(), get_db()
        decision, remarks = d.get("decision"), str(d.get("remarks", "")).strip()[:300]
        if decision not in ("approved", "rejected"):
            raise ApiError("Decision must be approved or rejected.", 422)
        if decision == "rejected" and not remarks:
            raise ApiError("Please give a reason for rejecting.", 422, {"remarks": "A reason is required."})
        with tx(db):
            cur = db.execute("UPDATE enrollments SET status=?, reviewed_by=?, reviewed_at=?, remarks=? WHERE id=? AND status='pending'",
                             (decision, g.user["id"], now(), remarks, eid))
            if cur.rowcount == 0:                     # optimistic guard: someone else already processed it
                if not db.execute("SELECT 1 FROM enrollments WHERE id=?", (eid,)).fetchone():
                    raise ApiError("Enrollment not found.", 404)
                raise ApiError("This enrollment was already processed. Refresh the list.", 409)
            audit(db, g.user["id"], f"enrollment_{decision}", f"enrollment {eid}")
        return jsonify(ok=True, status=decision)

    return app

