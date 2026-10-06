"""Admin-only master-data management (users, students, branches, programs, subjects, sections, periods, enrollments).

One small generic engine drives all entities. Column names come ONLY from the ENT specs below
(never from the request), values are always bound parameters, and every route requires role=admin.
"""
import re
from flask import Blueprint, g, jsonify, request
from werkzeug.security import generate_password_hash

from app import ApiError, DAY_RE, api, body, current_period, password_problem
from db import audit, get_db, now, tx

bp = Blueprint("admin", __name__, url_prefix="/api/admin")
ADMIN = ("admin",)
EMAIL = re.compile(r"[^@\s]{1,64}@[^@\s]{1,120}\.[^@\s]{2,}")
FK_TABLES = {"program_id": "programs", "branch_id": "branches", "subject_id": "subjects", "period_id": "periods"}

# field kinds: str(max, upper, pattern) | int(lo, hi) | enum(values) | bool | fk | time | days | email
ENT = {
    "branches": dict(table="branches", active="active", fields={
        "code": ("str", True, dict(max=10, upper=True, pattern=r"[A-Z0-9]+")), "name": ("str", True, dict(max=80)),
        "address": ("str", False, dict(max=200)), "active": ("bool", False, {})},
        sql="SELECT * FROM branches", search=["code", "name"], filters={"active": "active"}, order="name"),
    "programs": dict(table="programs", active="active", fields={
        "code": ("str", True, dict(max=10, upper=True, pattern=r"[A-Z0-9]+")), "name": ("str", True, dict(max=100)),
        "active": ("bool", False, {})},
        sql="SELECT * FROM programs", search=["code", "name"], filters={"active": "active"}, order="code"),
    "subjects": dict(table="subjects", active="active", fields={
        "code": ("str", True, dict(max=12, upper=True, pattern=r"[A-Z0-9\-]+")), "title": ("str", True, dict(max=100)),
        "units": ("int", True, dict(lo=1, hi=6)), "program_id": ("fk", False, {}),
        "year_level": ("int", False, dict(lo=1, hi=4)), "active": ("bool", False, {})},
        sql="SELECT s.*, p.code program_code FROM subjects s LEFT JOIN programs p ON p.id=s.program_id",
        search=["s.code", "s.title"], filters={"program_id": "s.program_id", "year_level": "s.year_level", "active": "s.active"}, order="s.code"),
    "sections": dict(table="sections", active="active", fields={
        "subject_id": ("fk", True, {}), "period_id": ("fk", True, {}), "branch_id": ("fk", True, {}),
        "name": ("str", True, dict(max=20)), "days": ("days", True, {}),
        "time_start": ("time", True, {}), "time_end": ("time", True, {}),
        "room": ("str", False, dict(max=30)), "capacity": ("int", True, dict(lo=1, hi=200)), "active": ("bool", False, {})},
        sql="SELECT sec.*, sub.code subject_code, sub.title subject_title, b.code branch_code, per.school_year, per.semester, "
            "(SELECT COUNT(*) FROM enrollment_items ei JOIN enrollments e ON e.id=ei.enrollment_id WHERE ei.section_id=sec.id "
            " AND e.status IN ('pending','approved')) taken "
            "FROM sections sec JOIN subjects sub ON sub.id=sec.subject_id JOIN branches b ON b.id=sec.branch_id "
            "JOIN periods per ON per.id=sec.period_id",
        search=["sub.code", "sub.title", "sec.name"],
        filters={"branch_id": "sec.branch_id", "period_id": "sec.period_id", "subject_id": "sec.subject_id", "active": "sec.active"}, order="sub.code, b.code"),
    "periods": dict(table="periods", active=None, fields={
        "school_year": ("str", True, dict(max=9, pattern=r"\d{4}-\d{4}")),
        "semester": ("enum", True, dict(values=["1st Semester", "2nd Semester", "Summer"])),
        "is_current": ("bool", False, {}), "enrollment_open": ("bool", False, {})},
        sql="SELECT * FROM periods", search=["school_year"], filters={}, order="school_year DESC, semester"),
    "users": dict(table="users", active="active", fields={
        "username": ("str", True, dict(max=40, pattern=r"[A-Za-z0-9_.\-]+")), "full_name": ("str", True, dict(max=80)),
        "email": ("email", False, {}), "role": ("enum", True, dict(values=["student", "registrar", "admin"])), "active": ("bool", False, {})},
        sql="SELECT id, username, full_name, email, role, active, created_at FROM users",
        search=["username", "full_name", "email"], filters={"role": "role", "active": "active"}, order="role, username"),
    "students": dict(table="students", active="status", fields={
        "branch_id": ("fk", True, {}), "program_id": ("fk", True, {}), "year_level": ("int", True, dict(lo=1, hi=4)),
        "contact": ("str", False, dict(max=20, pattern=r"[0-9+\-() ]*")), "address": ("str", False, dict(max=200)),
        "status": ("enum", False, dict(values=["active", "inactive"]))},
        sql="SELECT s.id, s.student_no, u.full_name, u.email, u.username, s.branch_id, s.program_id, s.year_level, s.contact, s.address, "
            "s.status, b.code branch_code, p.code program_code FROM students s JOIN users u ON u.id=s.user_id "
            "JOIN branches b ON b.id=s.branch_id JOIN programs p ON p.id=s.program_id",
        search=["s.student_no", "u.full_name"],
        filters={"branch_id": "s.branch_id", "program_id": "s.program_id", "year_level": "s.year_level", "status": "s.status"}, order="s.student_no"),
}


def clean(db, spec, data, partial):
    """Validate `data` against spec['fields']; returns {column: value}. Raises 422 with per-field messages."""
    out, err = {}, {}
    for name, (kind, req, opt) in spec["fields"].items():
        if name not in data:
            if req and not partial:
                err[name] = "This field is required."
            continue
        v = data[name]
        empty = v is None or (isinstance(v, str) and not v.strip())
        if empty and kind != "bool":
            if req:
                err[name] = "This field is required."
            elif kind != "enum":
                out[name] = None if kind in ("fk", "int") else ""
            continue
        try:
            if kind == "str":
                v = " ".join(str(v).split())
                if opt.get("upper"):
                    v = v.upper()
                if len(v) > opt["max"]:
                    raise ValueError(f"Maximum {opt['max']} characters.")
                if opt.get("pattern") and not re.fullmatch(opt["pattern"], v):
                    raise ValueError("Contains characters that are not allowed.")
            elif kind == "int":
                if isinstance(v, bool) or not str(v).lstrip("-").isdigit():
                    raise ValueError("Enter a whole number.")
                v = int(v)
                if not opt["lo"] <= v <= opt["hi"]:
                    raise ValueError(f"Must be between {opt['lo']} and {opt['hi']}.")
            elif kind == "enum":
                if v not in opt["values"]:
                    raise ValueError("Choose a valid option.")
            elif kind == "bool":
                v = 1 if v in (True, 1, "1", "true", "on") else 0
            elif kind == "fk":
                if isinstance(v, bool) or not str(v).isdigit() or not db.execute(f"SELECT 1 FROM {FK_TABLES[name]} WHERE id=?", (int(v),)).fetchone():
                    raise ValueError("Choose a valid option.")
                v = int(v)
            elif kind == "time":
                if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(v)):
                    raise ValueError("Use HH:MM (24-hour).")
            elif kind == "days":
                v = str(v).strip()
                if not v or "".join(DAY_RE.findall(v)) != v:
                    raise ValueError("Use M, T, W, Th, F, S (e.g. MW, TTh, F).")
            elif kind == "email":
                v = str(v).strip()
                if not EMAIL.fullmatch(v):
                    raise ValueError("Enter a valid email address.")
        except ValueError as e:
            err[name] = str(e)
            continue
        out[name] = v
    if "time_start" in out and "time_end" in out and out["time_start"] >= out["time_end"]:
        err["time_end"] = "End time must be after start time."
    if err:
        raise ApiError("Please fix the highlighted fields.", 422, err)
    return out


def spec_for(name):
    if name not in ENT:
        raise ApiError("Unknown resource.", 404)
    return ENT[name]


@bp.get("/<entity>")
@api(ADMIN)
def list_(entity):
    s, a = spec_for(entity), request.args
    sql, args = s["sql"] + " WHERE 1=1", []
    q = a.get("q", "").strip()[:50]
    if q:
        sql += " AND (" + " OR ".join(f"{c} LIKE ?" for c in s["search"]) + ")"
        args += [f"%{q}%"] * len(s["search"])
    for p, col in s["filters"].items():
        if a.get(p, "") != "":
            sql += f" AND {col}=?"
            args.append(a[p])
    sql += f" ORDER BY {s['order']} LIMIT 300"
    return jsonify(rows=[dict(r) for r in get_db().execute(sql, args)])


def _guard_admin_change(db, uid, new_role=None, new_active=None):
    """Never lock everyone out: you can't deactivate/demote yourself or the last active admin."""
    u = db.execute("SELECT role, active FROM users WHERE id=?", (uid,)).fetchone()
    if not u or u["role"] != "admin":
        return
    losing = (new_role is not None and new_role != "admin") or new_active == 0
    if losing and (uid == g.user["id"] or db.execute("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").fetchone()["n"] <= 1):
        raise ApiError("You can't deactivate or demote yourself or the last active admin.", 409)


@bp.post("/<entity>")
@api(ADMIN)
def create(entity):
    s, d, db = spec_for(entity), body(), get_db()
    vals = clean(db, s, d, partial=False)
    with tx(db):
        if entity == "users":
            err = password_problem(d.get("password"))
            if err:
                raise ApiError("Please fix the highlighted fields.", 422, {"password": err})
            if vals["role"] == "student":
                raise ApiError("Create student accounts from the Students page.", 422, {"role": "Use the Students page for student accounts."})
            vals.setdefault("active", 1)
            vals.update(password_hash=generate_password_hash(d["password"]), created_at=now())
            new_id = _insert(db, "users", vals)
        elif entity == "students":
            new_id = _create_student(db, d, vals)
        else:
            if entity == "periods" and vals.get("is_current"):
                db.execute("UPDATE periods SET is_current=0")
            new_id = _insert(db, s["table"], vals)
        audit(db, g.user["id"], f"create_{entity}", f"id {new_id}")
    return jsonify(ok=True, id=new_id), 201


def _insert(db, table, vals):
    cols = list(vals)                                        # keys originate from the ENT whitelist
    return db.execute(f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join('?' * len(cols))})", [vals[c] for c in cols]).lastrowid


def _create_student(db, d, vals):
    name, email = " ".join(str(d.get("full_name", "")).split()), str(d.get("email", "")).strip()
    err = {}
    if not (2 <= len(name) <= 80):
        err["full_name"] = "Enter the student's full name."
    if not EMAIL.fullmatch(email):
        err["email"] = "Enter a valid email address."
    sno = str(d.get("student_no", "")).strip()
    if not re.fullmatch(r"\d{4}-\d{6}", sno):
        err["student_no"] = "Use the format YYYY-NNNNNN (e.g. 2026-000150)."
    pw = password_problem(d.get("password"))
    if pw:
        err["password"] = pw
    if err:
        raise ApiError("Please fix the highlighted fields.", 422, err)
    uid = db.execute("INSERT INTO users(username,password_hash,role,full_name,email,active,created_at) VALUES(?,?,?,?,?,1,?)",
                     (sno, generate_password_hash(d["password"]), "student", name, email, now())).lastrowid
    vals.update(student_no=sno, user_id=uid, status=vals.get("status") or "active")
    return _insert(db, "students", vals)


@bp.put("/<entity>/<int:rid>")
@api(ADMIN)
def update(entity, rid):
    s, d, db = spec_for(entity), body(), get_db()
    vals = clean(db, s, d, partial=True)
    with tx(db):
        if not db.execute(f"SELECT 1 FROM {s['table']} WHERE id=?", (rid,)).fetchone():
            raise ApiError("Record not found.", 404)
        if entity == "users":
            _guard_admin_change(db, rid, vals.get("role"), vals.get("active"))
            if db.execute("SELECT 1 FROM students WHERE user_id=?", (rid,)).fetchone() and vals.get("role", "student") != "student":
                raise ApiError("Student accounts can't be changed to a staff role.", 409)
            if d.get("password"):
                err = password_problem(d["password"])
                if err:
                    raise ApiError("Please fix the highlighted fields.", 422, {"password": err})
                vals["password_hash"] = generate_password_hash(d["password"])
        if entity == "students":
            uvals = {}
            if "full_name" in d:
                nm = " ".join(str(d["full_name"]).split())
                if not 2 <= len(nm) <= 80:
                    raise ApiError("Please fix the highlighted fields.", 422, {"full_name": "Enter the student's full name."})
                uvals["full_name"] = nm
            if "email" in d:
                if not EMAIL.fullmatch(str(d["email"]).strip()):
                    raise ApiError("Please fix the highlighted fields.", 422, {"email": "Enter a valid email address."})
                uvals["email"] = str(d["email"]).strip()
            if "status" in vals:
                uvals["active"] = 1 if vals["status"] == "active" else 0
            if uvals:
                uid = db.execute("SELECT user_id FROM students WHERE id=?", (rid,)).fetchone()["user_id"]
                db.execute(f"UPDATE users SET {','.join(c + '=?' for c in uvals)} WHERE id=?", [*uvals.values(), uid])
        if entity == "periods" and vals.get("is_current"):
            db.execute("UPDATE periods SET is_current=0 WHERE id<>?", (rid,))
        if vals:
            db.execute(f"UPDATE {s['table']} SET {','.join(c + '=?' for c in vals)} WHERE id=?", [*vals.values(), rid])
        audit(db, g.user["id"], f"update_{entity}", f"id {rid}")
    return jsonify(ok=True)


@bp.delete("/<entity>/<int:rid>")
@api(ADMIN)
def deactivate(entity, rid):
    """'Delete' = soft delete (deactivate) so historical enrollments keep their references."""
    s, db = spec_for(entity), get_db()
    if not s["active"]:
        raise ApiError("This record type can't be deleted. Mark another period as current instead.", 409)
    with tx(db):
        if not db.execute(f"SELECT 1 FROM {s['table']} WHERE id=?", (rid,)).fetchone():
            raise ApiError("Record not found.", 404)
        if entity == "users":
            _guard_admin_change(db, rid, new_active=0)
        if entity == "students":
            db.execute("UPDATE users SET active=0 WHERE id=(SELECT user_id FROM students WHERE id=?)", (rid,))
            db.execute("UPDATE students SET status='inactive' WHERE id=?", (rid,))
        else:
            db.execute(f"UPDATE {s['table']} SET {s['active']}=0 WHERE id=?", (rid,))
        audit(db, g.user["id"], f"deactivate_{entity}", f"id {rid}")
    return jsonify(ok=True)


@bp.delete("/enrollments/<int:eid>")
@api(ADMIN)
def delete_enrollment(eid):
    db = get_db()
    with tx(db):
        if db.execute("DELETE FROM enrollments WHERE id=?", (eid,)).rowcount == 0:
            raise ApiError("Enrollment not found.", 404)
        audit(db, g.user["id"], "delete_enrollment", f"id {eid}")
    return jsonify(ok=True)
