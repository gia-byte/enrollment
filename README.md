# AICS Enrollment System (Software Engineering 2)

Public AICS website + secure enrollment system with three roles (Student, Registrar, Admin).
Stack: **Python / Flask**, **SQLite**, vanilla **JavaScript + AJAX (fetch)**. No build step.

## Run (Windows / macOS / Linux)
```
pip install -r requirements.txt
python run.py            # first run creates instance/aics.db with demo data
```
Open http://127.0.0.1:5000  — reset demo data any time with `python seed.py --reset`.

| Role | Username | Password |
|---|---|---|
| Student | 2025-000123 | student123 |
| Registrar | registrar | registrar123 |
| Admin | admin | admin123 |

Demo passwords are for local demonstration only (`DEMO_MODE=0` hides them from the login page).

## Tests
`python -m unittest discover -s tests -v` — 15 tests: role isolation, CSRF, throttling, IDOR, SQL-injection, enrollment rules.

## Structure
```
app.py          routes: public pages, auth, student API, staff API, print page, security headers
admin_api.py    admin-only CRUD engine (users, students, branches, programs, subjects, sections, periods)
db.py           SQLite helpers + transactions      schema.sql   database schema
seed.py         demo data (7 branches, 3 programs, sample subjects/sections/students)
templates/      Jinja pages (home, login, register, app shell, print record)
static/         css/, js/app.js (the AJAX single-page app), img/
legacy/         the original localStorage prototype (kept for reference, not used)
tests/          automated tests
```
Sample subjects, schedules and students are placeholder data, not AICS's official curriculum. Edit them in the Admin pages.
