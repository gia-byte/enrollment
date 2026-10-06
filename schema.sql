PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
-- Credentials + role live here. Staff accounts have NO students row.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','registrar','admin')),
  full_name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
-- Academic profile of a student; 1:1 with a student-role user.
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  student_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  program_id INTEGER NOT NULL REFERENCES programs(id),
  year_level INTEGER NOT NULL CHECK (year_level BETWEEN 1 AND 4),
  contact TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY, school_year TEXT NOT NULL, semester TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0, enrollment_open INTEGER NOT NULL DEFAULT 0,
  UNIQUE (school_year, semester)
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units BETWEEN 1 AND 6),
  program_id INTEGER REFERENCES programs(id),          -- NULL = common to all programs
  year_level INTEGER CHECK (year_level BETWEEN 1 AND 4),
  active INTEGER NOT NULL DEFAULT 1
);
-- A section = a subject offered in one branch, in one period, with a schedule.
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  period_id INTEGER NOT NULL REFERENCES periods(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL, days TEXT NOT NULL,
  time_start TEXT NOT NULL, time_end TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 200),
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (subject_id, period_id, branch_id, name)
);
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  period_id INTEGER NOT NULL REFERENCES periods(id),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  submitted_at TEXT NOT NULL,
  reviewed_by INTEGER REFERENCES users(id), reviewed_at TEXT,
  remarks TEXT NOT NULL DEFAULT '',
  UNIQUE (student_id, period_id)            -- one enrollment per student per term
);
CREATE TABLE IF NOT EXISTS enrollment_items (
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  PRIMARY KEY (enrollment_id, section_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_students_branch ON students(branch_id, program_id);
CREATE INDEX IF NOT EXISTS ix_sections_lookup ON sections(period_id, branch_id);
CREATE INDEX IF NOT EXISTS ix_items_section ON enrollment_items(section_id);
CREATE INDEX IF NOT EXISTS ix_enroll_status ON enrollments(period_id, status);
