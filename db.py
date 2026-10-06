"""SQLite helpers. Every query in the project uses '?' placeholders (no string-built SQL values)."""
import os, sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from flask import g, current_app

PH = timezone(timedelta(hours=8))   # Philippine time


def now():
    return datetime.now(PH).strftime("%Y-%m-%d %H:%M:%S")


def connect(path):
    c = sqlite3.connect(path, isolation_level=None, timeout=10)  # autocommit; we open transactions explicitly
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"])
    return g.db


def close_db(_e=None):
    d = g.pop("db", None)
    if d is not None:
        d.close()


@contextmanager
def tx(db):
    """BEGIN IMMEDIATE takes the write lock up-front, so two users submitting/approving at once are serialized."""
    db.execute("BEGIN IMMEDIATE")
    try:
        yield db
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise


def init_db(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    c = connect(path)
    with open(os.path.join(os.path.dirname(__file__), "schema.sql")) as f:
        c.executescript(f.read())
    c.close()


def audit(db, user_id, action, detail=""):
    db.execute("INSERT INTO audit_log(user_id,action,detail,at) VALUES(?,?,?,?)", (user_id, action, detail[:300], now()))
