"""Run:  python -m unittest discover -s tests -v
Covers the security rules and the enrollment workflow that the professor is most likely to probe."""
import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as appmod
from seed import seed


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        path = os.path.join(self.tmp, "t.db")
        seed(path)
        appmod._attempts.clear()
        self.app = appmod.create_app({"DATABASE": path, "TESTING": True})

    def login(self, user, pw):
        c = self.app.test_client()
        r = c.post("/api/login", json={"username": user, "password": pw})
        self.assertEqual(r.status_code, 200, r.get_json())
        c.csrf = c.get("/api/me").get_json()["csrf"]
        return c

    def post(self, c, url, **j):
        return c.post(url, json=j, headers={"X-CSRF-Token": c.csrf})

    def sections(self, c, q=""):
        return {s["code"]: s for s in c.get("/api/student/sections?q=" + q).get_json()["sections"]}


class TestAuth(Base):
    def test_unauthenticated_blocked(self):
        c = self.app.test_client()
        for url in ("/api/me", "/api/staff/stats", "/api/admin/users", "/api/student/dashboard"):
            self.assertEqual(c.get(url).status_code, 401, url)
        self.assertEqual(c.get("/app").status_code, 302)

    def test_bad_login_and_throttle(self):
        c = self.app.test_client()
        for _ in range(5):
            self.assertEqual(c.post("/api/login", json={"username": "admin", "password": "wrong"}).status_code, 401)
        self.assertEqual(c.post("/api/login", json={"username": "admin", "password": "admin123"}).status_code, 429)

    def test_passwords_are_hashed(self):
        import sqlite3
        c = sqlite3.connect(self.app.config["DATABASE"])
        for (h,) in c.execute("SELECT password_hash FROM users"):
            for plain in ("admin123", "registrar123", "student123"):
                self.assertNotIn(plain, h)
            self.assertTrue(h.startswith(("scrypt:", "pbkdf2:")))

    def test_csrf_required(self):
        c = self.login("registrar", "registrar123")
        self.assertEqual(c.post("/api/staff/enrollments/1/decision", json={"decision": "approved"}).status_code, 403)

    def test_deactivated_user_cannot_login(self):
        a = self.login("admin", "admin123")
        sid = [r for r in a.get("/api/admin/students?q=000123").get_json()["rows"]][0]["id"]
        self.assertEqual(a.delete(f"/api/admin/students/{sid}", headers={"X-CSRF-Token": a.csrf}).status_code, 200)
        r = self.app.test_client().post("/api/login", json={"username": "2025-000123", "password": "student123"})
        self.assertEqual(r.status_code, 403)


class TestRoles(Base):
    def test_student_cannot_use_staff_or_admin(self):
        s = self.login("2025-000123", "student123")
        self.assertEqual(s.get("/api/staff/stats").status_code, 403)
        self.assertEqual(self.post(s, "/api/staff/enrollments/4/decision", decision="approved").status_code, 403)
        self.assertEqual(s.get("/api/admin/users").status_code, 403)
        self.assertEqual(self.post(s, "/api/admin/users", username="x").status_code, 403)

    def test_registrar_is_not_admin_and_admin_cannot_approve(self):
        r = self.login("registrar", "registrar123")
        self.assertEqual(r.get("/api/admin/users").status_code, 403)
        self.assertEqual(r.get("/api/staff/stats").status_code, 200)
        a = self.login("admin", "admin123")
        self.assertEqual(self.post(a, "/api/staff/enrollments/4/decision", decision="approved").status_code, 403)

    def test_role_cannot_be_forged_via_cookie_or_body(self):
        s = self.login("2025-000123", "student123")
        r = s.get("/api/staff/stats", headers={"X-Role": "admin"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(s.get("/api/me").get_json()["user"]["role"], "student")


class TestWorkflow(Base):
    def test_full_flow_and_rules(self):
        s = self.login("2025-000123", "student123")
        secs = self.sections(s)
        self.assertEqual(set(secs), {"GE201", "CS201", "CS202", "CS203"})        # only own program/year/branch
        ids = [v["id"] for v in secs.values()]
        # tampering: a section id from another branch / year is rejected
        import sqlite3
        c = sqlite3.connect(self.app.config["DATABASE"])
        other = c.execute("SELECT sec.id FROM sections sec JOIN branches b ON b.id=sec.branch_id WHERE b.code='MON' LIMIT 1").fetchone()[0]
        self.assertEqual(self.post(s, "/api/student/enrollment", section_ids=[other]).status_code, 422)
        self.assertEqual(self.post(s, "/api/student/enrollment", section_ids=[]).status_code, 422)
        r = self.post(s, "/api/student/enrollment", section_ids=ids)
        self.assertEqual(r.status_code, 201, r.get_json())
        eid = r.get_json()["id"]
        self.assertEqual(self.post(s, "/api/student/enrollment", section_ids=ids).status_code, 409)   # duplicate
        # registrar approves; second decision is blocked
        reg = self.login("registrar", "registrar123")
        self.assertEqual(self.post(reg, f"/api/staff/enrollments/{eid}/decision", decision="rejected").status_code, 422)  # reason needed
        self.assertEqual(self.post(reg, f"/api/staff/enrollments/{eid}/decision", decision="approved").status_code, 200)
        self.assertEqual(self.post(reg, f"/api/staff/enrollments/{eid}/decision", decision="rejected", remarks="x").status_code, 409)
        h = s.get("/api/student/enrollments").get_json()["enrollments"]
        self.assertEqual(h[0]["status"], "approved")
        self.assertEqual(h[0]["total_units"], 12)
        self.assertEqual(len(h), 2)                                                # current + previous term

    def test_schedule_conflict_and_unit_cap(self):
        a = self.login("admin", "admin123")
        # force CS202 to overlap CS201
        secs = self.sections(self.login("2025-000123", "student123"))
        cs201 = a.get("/api/admin/sections?q=CS201&branch_id=1").get_json()["rows"][0]
        r = a.put(f"/api/admin/sections/{[x for x in a.get('/api/admin/sections?q=CS202&branch_id=1').get_json()['rows']][0]['id']}",
                  json={"days": cs201["days"], "time_start": cs201["time_start"], "time_end": cs201["time_end"]},
                  headers={"X-CSRF-Token": a.csrf})
        self.assertEqual(r.status_code, 200)
        s = self.login("2025-000123", "student123")
        secs = self.sections(s)
        r = self.post(s, "/api/student/enrollment", section_ids=[secs["CS201"]["id"], secs["CS202"]["id"]])
        self.assertEqual(r.status_code, 422)
        self.assertIn("conflict", r.get_json()["error"].lower())

    def test_capacity(self):
        a = self.login("admin", "admin123")
        s = self.login("2025-000123", "student123")
        sec = self.sections(s)["CS203"]
        # capacity 1 and one other student already holds it
        import sqlite3
        c = sqlite3.connect(self.app.config["DATABASE"])
        c.execute("UPDATE sections SET capacity=1 WHERE id=?", (sec["id"],))
        c.execute("INSERT INTO enrollment_items SELECT 3, ?", (sec["id"],)); c.commit()
        r = self.post(s, "/api/student/enrollment", section_ids=[sec["id"]])
        self.assertEqual(r.status_code, 409)

    def test_print_idor(self):
        s = self.login("2025-000123", "student123")
        self.assertEqual(s.get("/print/enrollment/2").status_code, 404)          # someone else's record
        reg = self.login("registrar", "registrar123")
        r = reg.get("/print/enrollment/2")
        self.assertEqual(r.status_code, 200)
        self.assertIn(b"ASIAN INSTITUTE OF COMPUTER STUDIES", r.data)
        self.assertEqual(self.app.test_client().get("/print/enrollment/2").status_code, 302)

    def test_sql_injection_is_inert(self):
        reg = self.login("registrar", "registrar123")
        r = reg.get("/api/staff/students?q=' OR 1=1 --")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["students"], [])
        a = self.login("admin", "admin123")
        self.assertEqual(a.get("/api/admin/users?role=admin' OR '1'='1").get_json()["rows"], [])

    def test_admin_crud_and_validation(self):
        a = self.login("admin", "admin123")
        r = self.post(a, "/api/admin/subjects", code="zz 1", title="", units=99)
        self.assertEqual(r.status_code, 422)
        self.assertIn("units", r.get_json()["fields"])
        r = self.post(a, "/api/admin/subjects", code="zz101", title="Test <b>Subject</b>", units=3)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.post(a, "/api/admin/subjects", code="ZZ101", title="Dup", units=3).status_code, 409)
        self.assertEqual(self.post(a, "/api/admin/users", username="newreg", full_name="N R", role="registrar", password="short").status_code, 422)
        self.assertEqual(self.post(a, "/api/admin/users", username="newreg", full_name="N R", role="registrar", password="Passw0rdX").status_code, 201)
        me = a.get("/api/me").get_json()["user"]["id"]
        self.assertEqual(a.put(f"/api/admin/users/{me}", json={"active": False}, headers={"X-CSRF-Token": a.csrf}).status_code, 409)

    def test_register(self):
        c = self.app.test_client()
        r = c.post("/api/register", json={"full_name": "Test Student", "email": "t@example.com", "branch_id": 1, "program_id": 1, "year_level": 1, "password": "abc12345"})
        self.assertEqual(r.status_code, 201)
        sno = r.get_json()["student_no"]
        self.assertEqual(c.post("/api/login", json={"username": sno, "password": "abc12345"}).status_code, 200)
        r = c.post("/api/register", json={"full_name": "<script>", "email": "bad", "branch_id": 99, "program_id": 1, "year_level": 1, "password": "x"})
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()
