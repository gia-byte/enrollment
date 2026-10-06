"""Demo data.  Usage:  python seed.py          (creates instance/aics.db with demo accounts)
                       python seed.py --reset  (wipes the database first)
Demo passwords are for local demonstration only. Set DEMO_MODE=0 and change them for any real deployment."""
import os, sys
from werkzeug.security import generate_password_hash

import db as dbm

BRANCHES = [("COM", "AICS Commonwealth"), ("MON", "AICS Montalban"), ("BIC", "AICS Bicutan"), ("BAC", "AICS Bacoor"),
            ("BAT", "AICS Batangas"), ("LIP", "AICS Lipa"), ("TAR", "AICS Tarlac")]
PROGRAMS = [("BSCS", "BS Computer Science"), ("BSIT", "BS Information Technology"), ("BSIS", "BS Information Systems")]
# (code, title, units, program code or None=common, year)
SUBJECTS = [
    ("GE101", "Understanding the Self", 3, None, 1), ("GE102", "Mathematics in the Modern World", 3, None, 1),
    ("PE101", "Physical Education 1", 2, None, 1),
    ("CS101", "Introduction to Computing", 3, "BSCS", 1), ("CS102", "Computer Programming 1", 3, "BSCS", 1),
    ("IT101", "Introduction to Information Technology", 3, "BSIT", 1), ("IT102", "Computer Programming 1", 3, "BSIT", 1),
    ("IS101", "Fundamentals of Information Systems", 3, "BSIS", 1), ("IS102", "Computer Programming 1", 3, "BSIS", 1),
    ("GE201", "Purposive Communication", 3, None, 2),
    ("CS201", "Data Structures and Algorithms", 3, "BSCS", 2), ("CS202", "Object-Oriented Programming", 3, "BSCS", 2),
    ("CS203", "Database Systems", 3, "BSCS", 2),
    ("IT201", "Web Development", 3, "BSIT", 2), ("IT202", "Database Systems", 3, "BSIT", 2), ("IT203", "Networking Fundamentals", 3, "BSIT", 2),
    ("IS201", "Systems Analysis and Design", 3, "BSIS", 2), ("IS202", "Database Systems", 3, "BSIS", 2),
    ("IS203", "Business Process Management", 3, "BSIS", 2),
    ("CS301", "Software Engineering 1", 3, "BSCS", 3), ("IT301", "Systems Integration and Architecture", 3, "BSIT", 3),
    ("IS301", "Enterprise Systems", 3, "BSIS", 3),
]
SLOTS = [("MW", "08:00", "10:00"), ("TTh", "08:00", "10:00"), ("MW", "10:00", "12:00"), ("TTh", "10:00", "12:00"),
         ("MW", "13:00", "15:00"), ("TTh", "13:00", "15:00"), ("F", "08:00", "11:00"), ("F", "13:00", "16:00")]
# (student_no, name, email, program, year, branch code)
STUDENTS = [
    ("2025-000123", "Cherry-An Dorado", "cherryan@example.com", "BSCS", 2, "COM"),
    ("2025-000125", "Angelica Santos", "asantos@example.com", "BSCS", 2, "COM"),
    ("2024-000087", "Jose Miguel Cruz", "jmcruz@example.com", "BSCS", 1, "COM"),
    ("2025-000124", "Mark Anthony Reyes", "mareyes@example.com", "BSIT", 1, "MON"),
    ("2025-000131", "Rafael Lim", "rlim@example.com", "BSCS", 1, "BIC"),
    ("2024-000091", "Patricia Mae Villanueva", "pmvillanueva@example.com", "BSIS", 1, "BAC"),
    ("2025-000140", "Daniel Aquino", "daquino@example.com", "BSIT", 2, "BAT"),
    ("2025-000141", "Sofia Mendoza", "smendoza@example.com", "BSIS", 3, "LIP"),
    ("2025-000142", "Paolo Garcia", "pgarcia@example.com", "BSIT", 1, "TAR"),
]


def build_sections(db, period_id, branch_ids, years, ids):
    """One section per subject per branch. Slots are assigned so a normal program/year load has no time conflicts."""
    for year in years:
        common = [s for s in SUBJECTS if s[3] is None and s[4] == year]
        for prog in ("BSCS", "BSIT", "BSIS"):
            own = [s for s in SUBJECTS if s[3] == prog and s[4] == year]
            for i, s in enumerate(common + own):
                days, a, b = SLOTS[i % len(SLOTS)]
                for br in branch_ids:
                    db.execute("INSERT OR IGNORE INTO sections(subject_id,period_id,branch_id,name,days,time_start,time_end,room,capacity) "
                               "VALUES(?,?,?,?,?,?,?,?,?)", (ids["sub"][s[0]], period_id, br, "A", days, a, b, f"Rm {101 + i}", 40))


def seed(path, reset=False):
    if reset and os.path.exists(path):
        os.remove(path)
    if not os.path.exists(path):
        dbm.init_db(path)
    db = dbm.connect(path)
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        print("Database already has data (use --reset to start over).")
        return
    db.execute("BEGIN")
    ids = {"br": {}, "prog": {}, "sub": {}}
    for c, n in BRANCHES:
        ids["br"][c] = db.execute("INSERT INTO branches(code,name) VALUES(?,?)", (c, n)).lastrowid
    for c, n in PROGRAMS:
        ids["prog"][c] = db.execute("INSERT INTO programs(code,name) VALUES(?,?)", (c, n)).lastrowid
    for code, title, u, prog, yr in SUBJECTS:
        ids["sub"][code] = db.execute("INSERT INTO subjects(code,title,units,program_id,year_level) VALUES(?,?,?,?,?)",
                                      (code, title, u, ids["prog"].get(prog), yr)).lastrowid
    past = db.execute("INSERT INTO periods(school_year,semester,is_current,enrollment_open) VALUES('2025-2026','2nd Semester',0,0)").lastrowid
    cur = db.execute("INSERT INTO periods(school_year,semester,is_current,enrollment_open) VALUES('2026-2027','1st Semester',1,1)").lastrowid
    build_sections(db, cur, list(ids["br"].values()), (1, 2, 3), ids)
    build_sections(db, past, [ids["br"]["COM"]], (1,), ids)

    def user(username, pw, role, name, email=""):
        return db.execute("INSERT INTO users(username,password_hash,role,full_name,email,created_at) VALUES(?,?,?,?,?,?)",
                          (username, generate_password_hash(pw), role, name, email, dbm.now())).lastrowid
    user("admin", "admin123", "admin", "System Administrator", "admin@example.com")
    reg = user("registrar", "registrar123", "registrar", "Registrar Office", "registrar@example.com")
    sid = {}
    for no, name, email, prog, yr, br in STUDENTS:
        uid = user(no, "student123", "student", name, email)
        sid[no] = db.execute("INSERT INTO students(student_no,user_id,branch_id,program_id,year_level) VALUES(?,?,?,?,?)",
                             (no, uid, ids["br"][br], ids["prog"][prog], yr)).lastrowid
    db.execute("UPDATE students SET contact='09123456789', address='San Pedro, Laguna' WHERE student_no='2025-000123'")

    def enroll(no, period, status, codes, when):
        s = db.execute("SELECT branch_id FROM students WHERE id=?", (sid[no],)).fetchone()
        eid = db.execute("INSERT INTO enrollments(student_id,period_id,status,submitted_at,reviewed_by,reviewed_at,remarks) VALUES(?,?,?,?,?,?,?)",
                         (sid[no], period, status, when, reg if status != "pending" else None,
                          when if status != "pending" else None, "")).lastrowid
        for c in codes:
            sec = db.execute("SELECT id FROM sections WHERE subject_id=? AND period_id=? AND branch_id=?",
                             (ids["sub"][c], period, s["branch_id"])).fetchone()
            db.execute("INSERT INTO enrollment_items VALUES(?,?)", (eid, sec["id"]))
    enroll("2025-000123", past, "approved", ["GE101", "GE102", "PE101", "CS101", "CS102"], "2026-01-12 09:30:00")
    enroll("2025-000125", cur, "approved", ["GE201", "CS201", "CS202", "CS203"], "2026-08-03 10:15:00")
    enroll("2024-000087", cur, "approved", ["GE101", "GE102", "PE101", "CS101", "CS102"], "2026-08-04 11:00:00")
    enroll("2025-000124", cur, "pending", ["GE101", "GE102", "PE101", "IT101", "IT102"], "2026-10-05 14:20:00")
    enroll("2025-000131", cur, "pending", ["GE101", "GE102", "CS101", "CS102"], "2026-10-05 15:05:00")
    db.execute("COMMIT")
    db.close()
    print("Seeded. Accounts: admin/admin123, registrar/registrar123, 2025-000123/student123")


if __name__ == "__main__":
    seed(os.path.join(os.path.dirname(os.path.abspath(__file__)), "instance", "aics.db"), reset="--reset" in sys.argv)
