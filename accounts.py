"""Aceminder accounts: users, sessions, Google / Apple / email sign-in, XP and leaderboards.

Only the Python standard library is used: SQLite for storage, scrypt for passwords and a
small RS256 verifier for Google and Apple ID tokens. XP is calculated here on the server
from tests the server itself generated, so the leaderboard cannot be faked from the browser.
"""

import base64
import hashlib
import hmac
import json
import os
import random
import re
import secrets
import smtplib
import sqlite3
import ssl
import threading
import time
from collections import defaultdict, deque
from contextlib import contextmanager
from datetime import date, datetime, timezone
from email.message import EmailMessage
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
SESSION_COOKIE = "aceminder_session"
SESSION_SECONDS = 30 * 86400
RESET_SECONDS = 3600
TEST_KEEP_SECONDS = 30 * 86400
USERNAME_PATTERN = re.compile(r"[^\W_][\w.]{2,19}", re.UNICODE)
EMAIL_PATTERN = re.compile(r"[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+")
RESERVED_NAMES = {
    "admin", "administrator", "aceminder", "support", "moderator", "mod", "root", "system",
    "staff", "official", "help", "null", "undefined", "anonymous", "guest", "you", "me",
}
OWL_AVATARS = [
    "owl:classic", "owl:cap", "owl:crown", "owl:cool", "owl:night", "owl:wizard", "owl:party", "owl:heart",
]
AVATARS = OWL_AVATARS + [
    "🦉", "🦊", "🐼", "🐯", "🦁", "🐸", "🐙", "🦄", "🐲", "🐧", "🐨", "🐺",
    "🦅", "🐬", "🚀", "⚡", "🔥", "🌟", "🎯", "🧠", "👑", "💎", "🎮", "📚",
]
PHOTO_MAX_BYTES = 512 * 1024
# id, stat, target, tier, artwork. Shared with the browser through /api/auth/config.
ACHIEVEMENTS = [
    ("first", "tests", 1, "bronze", "owl-hatch"),
    ("warming_up", "tests", 5, "bronze", "owl-book"),
    ("dedicated", "tests", 25, "silver", "owl-stack"),
    ("scholar", "tests", 100, "gold", "owl-cap"),
    ("sharp_mind", "correct", 50, "bronze", "target"),
    ("century", "correct", 100, "silver", "hundred"),
    ("vault", "correct", 500, "gold", "chest"),
    ("perfect", "perfects", 1, "silver", "owl-sparkle"),
    ("perfectionist", "perfects", 10, "gold", "owl-crown"),
    ("hard", "hardWins", 1, "silver", "shield"),
    ("mastermind", "tooHardPerfects", 1, "diamond", "owl-lightning"),
    ("streak3", "bestStreak", 3, "bronze", "flame"),
    ("streak7", "bestStreak", 7, "silver", "owl-flame"),
    ("streak30", "bestStreak", 30, "diamond", "phoenix"),
    ("level5", "level", 5, "bronze", "star"),
    ("level10", "level", 10, "silver", "owl-rocket"),
    ("level20", "level", 20, "gold", "trophy"),
    ("explorer", "topics", 5, "bronze", "owl-compass"),
    ("polymath", "topics", 20, "gold", "globe"),
    ("marathon", "dayTests", 5, "silver", "stopwatch"),
    ("night_owl", "nightTests", 1, "silver", "owl-moon"),
    ("early_bird", "earlyTests", 1, "bronze", "owl-sun"),
    ("weekend", "weekendTests", 3, "bronze", "calendar"),
    ("polyglot", "languages", 3, "gold", "speech"),
    ("big_brain", "bigTests", 1, "silver", "brain"),
    ("bookworm", "fileTests", 1, "bronze", "owl-scroll"),
    ("mix_master", "mixTests", 1, "bronze", "palette"),
    ("comeback", "comebacks", 1, "silver", "owl-rise"),
]
MULTIPLIERS = {
    "Too easy": 0.5, "Easy": 0.75, "Easy-Medium": 0.9, "Medium": 1.0,
    "Medium-Hard": 1.25, "Hard": 1.5, "Too Hard": 2.0,
}
GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
APPLE_JWKS = "https://appleid.apple.com/auth/keys"
APPLE_ISSUERS = {"https://appleid.apple.com"}
SHA256_DIGEST_INFO = bytes.fromhex("3031300d060960864801650304020105000420")

_db_path = ROOT / "aceminder.db"
_attempts = defaultdict(deque)
_attempts_lock = threading.Lock()
_jwks_cache = {}
_jwks_lock = threading.Lock()


class AccountError(Exception):
    """A user-facing problem. `code` lets the browser show a translated message."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def env(name):
    return os.environ.get(name, "").strip()


# ---------------------------------------------------------------- storage

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE COLLATE NOCASE,
    email TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    apple_sub TEXT UNIQUE,
    avatar TEXT NOT NULL DEFAULT '🦉',
    created_at INTEGER NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    tests INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    best INTEGER,
    streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    last_day TEXT NOT NULL DEFAULT '',
    perfects INTEGER NOT NULL DEFAULT 0,
    hard_wins INTEGER NOT NULL DEFAULT 0,
    badges TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tests (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    questions TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    graded_at INTEGER
);
CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    test_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    percent INTEGER NOT NULL,
    xp INTEGER NOT NULL,
    day TEXT NOT NULL,
    week TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS results_week ON results(week, user_id);
CREATE INDEX IF NOT EXISTS results_user ON results(user_id, created_at);
CREATE INDEX IF NOT EXISTS users_xp ON users(xp DESC);
"""


def init(db_path=None):
    global _db_path
    if db_path:
        _db_path = Path(db_path)
    elif env("ACEMINDER_DB"):
        _db_path = Path(env("ACEMINDER_DB"))
    with connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        # Columns added after the first release; older databases get them here.
        for table, column, declaration in (
            ("users", "avatar_image", "BLOB"),
            ("users", "avatar_mime", "TEXT"),
            ("users", "avatar_version", "INTEGER NOT NULL DEFAULT 0"),
            ("tests", "language", "TEXT"),
            ("tests", "files", "INTEGER NOT NULL DEFAULT 0"),
            ("tests", "formats", "INTEGER NOT NULL DEFAULT 1"),
            ("results", "hour", "INTEGER"),
            ("results", "language", "TEXT"),
            ("results", "files", "INTEGER NOT NULL DEFAULT 0"),
            ("results", "formats", "INTEGER NOT NULL DEFAULT 1"),
        ):
            existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
        now = int(time.time())
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        conn.execute("DELETE FROM resets WHERE expires_at < ?", (now,))
        conn.execute("DELETE FROM tests WHERE created_at < ?", (now - TEST_KEEP_SECONDS,))


@contextmanager
def connect():
    conn = sqlite3.connect(_db_path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------- validation and passwords

def clean_email(value):
    email = value.strip() if isinstance(value, str) else ""
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        raise AccountError(400, "email", "Enter a valid email address.")
    return email


def clean_password(value):
    if not isinstance(value, str) or not 8 <= len(value) <= 200:
        raise AccountError(400, "password", "Password must be at least 8 characters.")
    return value


def clean_username(value):
    name = value.strip() if isinstance(value, str) else ""
    if not USERNAME_PATTERN.fullmatch(name):
        raise AccountError(
            400, "username",
            "Usernames are 3-20 letters, numbers, _ or . and start with a letter or number.",
        )
    if name.casefold() in RESERVED_NAMES:
        raise AccountError(409, "taken", "That username is already taken.")
    return name


def clean_avatar(value, fallback=None):
    if isinstance(value, str) and value in AVATARS:
        return value
    return fallback or random.choice(AVATARS)


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return "scrypt$16384$8$1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password, stored):
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        candidate = hashlib.scrypt(
            password.encode("utf-8"), salt=base64.b64decode(salt),
            n=int(n), r=int(r), p=int(p), dklen=32,
        )
        return hmac.compare_digest(candidate, base64.b64decode(digest))
    except (ValueError, TypeError, AttributeError):
        return False


_DUMMY_HASH = None


def burn_password_check(password):
    """Spend the same time as a real check so missing accounts cannot be detected by timing."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("aceminder-timing-pad")
    verify_password(password or "x", _DUMMY_HASH)


def rate_limit(key, limit=12, window=600):
    now = time.monotonic()
    with _attempts_lock:
        bucket = _attempts[key]
        while bucket and now - bucket[0] > window:
            bucket.popleft()
        if len(bucket) >= limit:
            raise AccountError(429, "rate", "Too many attempts. Wait a few minutes and try again.")
        bucket.append(now)


# ---------------------------------------------------------------- sessions

def token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(conn, user_id):
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token_hash(token), user_id, now, now + SESSION_SECONDS),
    )
    return token


def session_token(cookie_header):
    if not cookie_header:
        return ""
    try:
        cookie = SimpleCookie()
        cookie.load(cookie_header)
    except CookieError:
        return ""
    morsel = cookie.get(SESSION_COOKIE)
    return morsel.value if morsel else ""


def current_user(cookie_header):
    """Return the signed-in user's row, or None."""
    token = session_token(cookie_header)
    if not token or len(token) > 100:
        return None
    with connect() as conn:
        return conn.execute(
            "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
            "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
            (token_hash(token), int(time.time())),
        ).fetchone()


def cookie_header(token, secure, max_age=SESSION_SECONDS):
    parts = [f"{SESSION_COOKIE}={token}", "Path=/", "HttpOnly", "SameSite=Lax", f"Max-Age={max_age}"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


# ---------------------------------------------------------------- Google and Apple ID tokens

def b64url(data):
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def fetch_jwks(url, force=False):
    with _jwks_lock:
        cached = _jwks_cache.get(url)
        if cached and not force and cached[0] > time.time():
            return cached[1]
    try:
        with urlopen(Request(url, headers={"User-Agent": "Aceminder"}), timeout=15) as response:
            keys = json.loads(response.read().decode("utf-8")).get("keys", [])
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        raise AccountError(502, "provider", "Could not reach the sign-in provider. Try again.") from error
    with _jwks_lock:
        _jwks_cache[url] = (time.time() + 3600, keys)
    return keys


def verify_id_token(token, jwks_url, issuers, audience):
    """Check an RS256 JWT signature, issuer, audience and expiry; return its claims."""
    bad = AccountError(401, "provider", "That sign-in did not work. Try again.")
    if not isinstance(token, str) or token.count(".") != 2 or len(token) > 8000:
        raise bad
    head_b64, body_b64, sig_b64 = token.split(".")
    try:
        header = json.loads(b64url(head_b64))
        claims = json.loads(b64url(body_b64))
        signature = b64url(sig_b64)
    except (ValueError, TypeError):
        raise bad
    if header.get("alg") != "RS256":
        raise bad

    key = None
    for force in (False, True):
        key = next((k for k in fetch_jwks(jwks_url, force) if k.get("kid") == header.get("kid")), None)
        if key:
            break
    if not key or key.get("kty") != "RSA":
        raise bad

    modulus = int.from_bytes(b64url(key["n"]), "big")
    exponent = int.from_bytes(b64url(key["e"]), "big")
    size = (modulus.bit_length() + 7) // 8
    if len(signature) != size:
        raise bad
    decoded = pow(int.from_bytes(signature, "big"), exponent, modulus).to_bytes(size, "big")
    digest = hashlib.sha256(f"{head_b64}.{body_b64}".encode("ascii")).digest()
    suffix = SHA256_DIGEST_INFO + digest
    expected = b"\x00\x01" + b"\xff" * (size - len(suffix) - 3) + b"\x00" + suffix
    if not hmac.compare_digest(decoded, expected):
        raise bad

    now = time.time()
    audiences = claims.get("aud") if isinstance(claims.get("aud"), list) else [claims.get("aud")]
    if claims.get("iss") not in issuers or audience not in audiences:
        raise bad
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now - 60:
        raise bad
    return claims


def provider_config():
    google = env("GOOGLE_CLIENT_ID")
    apple = env("APPLE_CLIENT_ID")
    return {
        "google": {"clientId": google} if google else None,
        "apple": {"clientId": apple, "redirectUri": env("APPLE_REDIRECT_URI")} if apple else None,
        "email": True,
        "passwordReset": mail_configured(),
        "avatars": AVATARS,
        "achievements": achievement_config(),
        "photoMaxBytes": PHOTO_MAX_BYTES,
    }


def clean_photo(value):
    """Accept a small JPEG, PNG or WebP (already cropped by the browser) and return (bytes, mime)."""
    bad = AccountError(400, "photo", "That image could not be used. Try a JPG or PNG.")
    if not isinstance(value, str) or len(value) > PHOTO_MAX_BYTES * 4 // 3 + 16:
        raise bad
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError):
        raise bad
    if not 100 <= len(raw) <= PHOTO_MAX_BYTES:
        raise bad
    if raw.startswith(b"\xff\xd8\xff"):
        return raw, "image/jpeg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return raw, "image/png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return raw, "image/webp"
    raise bad


def avatar_file(user_id):
    """Return (bytes, mime) of a user's uploaded profile picture, or None."""
    with connect() as conn:
        row = conn.execute(
            "SELECT avatar_image, avatar_mime FROM users WHERE id = ? AND avatar_version > 0", (user_id,)
        ).fetchone()
    if not row or not row["avatar_image"]:
        return None
    return bytes(row["avatar_image"]), row["avatar_mime"] or "image/jpeg"


def social_user(conn, provider, subject, email, email_verified):
    column = "google_sub" if provider == "google" else "apple_sub"
    row = conn.execute(f"SELECT * FROM users WHERE {column} = ?", (subject,)).fetchone()
    if row:
        return row, False
    if email and email_verified:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if row:
            # The provider proved this person owns the email. Email sign-ups are not verified,
            # so drop any password and old sessions in case someone pre-registered this email.
            conn.execute(
                f"UPDATE users SET {column} = ?, password_hash = NULL WHERE id = ?",
                (subject, row["id"]),
            )
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
            return conn.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone(), False
    cursor = conn.execute(
        f"INSERT INTO users ({column}, email, avatar, created_at) VALUES (?, ?, ?, ?)",
        (subject, email if email_verified else None, clean_avatar(None), int(time.time())),
    )
    return conn.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone(), True


# ---------------------------------------------------------------- XP, levels and badges

def level_info(xp):
    level, floor, cost = 1, 0, 100
    while xp >= floor + cost:
        floor += cost
        level += 1
        cost = 100 + 50 * (level - 1)
    return {"level": level, "into": xp - floor, "cost": cost}


def utc_today():
    return datetime.now(timezone.utc).date()


def client_day(value):
    """Use the browser's local date (for streaks) when it is within a day of UTC."""
    today = utc_today()
    try:
        day = date.fromisoformat(value) if isinstance(value, str) else today
    except ValueError:
        return today
    return day if abs((day - today).days) <= 1 else today


def week_key(day):
    year, week, _ = day.isocalendar()
    return f"{year}-W{week:02d}"


def live_streak(row):
    if not row["last_day"]:
        return 0
    try:
        last = date.fromisoformat(row["last_day"])
    except ValueError:
        return 0
    return row["streak"] if (utc_today() - last).days <= 1 else 0


def stats_for(conn, row):
    """Everything the achievements measure, worked out from the player's marked tests."""
    results = conn.execute(
        "SELECT percent, difficulty, total, topic, day, hour, language, files, formats "
        "FROM results WHERE user_id = ? ORDER BY created_at, id",
        (row["id"],),
    ).fetchall()
    topics, languages, per_day = set(), set(), defaultdict(int)
    night = early = weekend = big = with_files = mixed = too_hard_perfect = comebacks = 0
    previous = None
    for item in results:
        topics.add(item["topic"].strip().casefold())
        per_day[item["day"]] += 1
        hour = item["hour"]
        if isinstance(hour, int):
            night += hour >= 22 or hour < 5
            early += 5 <= hour < 8
        try:
            weekend += date.fromisoformat(item["day"]).weekday() >= 5
        except ValueError:
            pass
        if item["language"]:
            languages.add(item["language"])
        big += item["total"] >= 20
        with_files += (item["files"] or 0) > 0
        mixed += (item["formats"] or 1) >= 3
        too_hard_perfect += item["difficulty"] == "Too Hard" and item["percent"] == 100
        if previous is not None and previous < 50 and item["percent"] >= 90:
            comebacks += 1
        previous = item["percent"]
    return {
        "tests": row["tests"], "correct": row["correct"], "perfects": row["perfects"],
        "hardWins": row["hard_wins"], "tooHardPerfects": too_hard_perfect,
        "bestStreak": row["best_streak"], "level": level_info(row["xp"])["level"],
        "topics": len(topics), "dayTests": max(per_day.values(), default=0),
        "nightTests": night, "earlyTests": early, "weekendTests": weekend,
        "languages": len(languages), "bigTests": big, "fileTests": with_files,
        "mixTests": mixed, "comebacks": comebacks,
    }


def unlocked_achievements(stats):
    return [item[0] for item in ACHIEVEMENTS if stats.get(item[1], 0) >= item[2]]


def achievement_config():
    return [
        {"id": id_, "stat": stat, "target": target, "tier": tier, "art": art}
        for id_, stat, target, tier, art in ACHIEVEMENTS
    ]


def progress(row, stats=None):
    info = level_info(row["xp"])
    data = {
        "xp": row["xp"], "level": info["level"], "into": info["into"], "cost": info["cost"],
        "tests": row["tests"], "correct": row["correct"], "best": row["best"],
        "streak": live_streak(row), "bestStreak": row["best_streak"], "lastDay": row["last_day"],
        "perfects": row["perfects"], "hardWins": row["hard_wins"],
        "badges": json.loads(row["badges"] or "[]"),
    }
    if stats is not None:
        data["stats"] = stats
    return data


def avatar_url(row):
    return f"/api/avatar/{row['id']}?v={row['avatar_version']}" if row["avatar_version"] else None


def user_payload(conn, row):
    return public_user(row, stats_for(conn, row)) if row is not None else None


def public_user(row, stats=None):
    if row is None:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "avatar": row["avatar"],
        "avatarUrl": avatar_url(row),
        "email": row["email"],
        "needsUsername": not row["username"],
        "providers": {
            "password": bool(row["password_hash"]),
            "google": bool(row["google_sub"]),
            "apple": bool(row["apple_sub"]),
        },
        "createdAt": row["created_at"],
        "progress": progress(row, stats),
    }


def store_test(user_id, topic, difficulty, questions, language="English", files=0, formats=1):
    test_id = secrets.token_urlsafe(12)
    with connect() as conn:
        conn.execute(
            "INSERT INTO tests (id, user_id, topic, difficulty, questions, created_at, language, files, formats) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (test_id, user_id, topic[:120], difficulty, json.dumps(questions, ensure_ascii=False),
             int(time.time()), language, int(files), int(formats)),
        )
    return test_id


def load_test(user_id, test_id):
    if not isinstance(test_id, str) or len(test_id) > 40:
        return None
    with connect() as conn:
        row = conn.execute("SELECT * FROM tests WHERE id = ? AND user_id = ?", (test_id, user_id)).fetchone()
    if not row:
        return None
    return {
        "id": row["id"], "topic": row["topic"], "difficulty": row["difficulty"],
        "questions": json.loads(row["questions"]), "graded": row["graded_at"] is not None,
        "language": row["language"], "files": row["files"] or 0, "formats": row["formats"] or 1,
    }


def record_result(user_id, test, correct, total, percent, day_value, hour=None):
    """Award XP once per server-generated test. Returns the award and the new progress."""
    day = client_day(day_value)
    with connect() as conn:
        claimed = conn.execute(
            "UPDATE tests SET graded_at = ? WHERE id = ? AND user_id = ? AND graded_at IS NULL",
            (int(time.time()), test["id"], user_id),
        ).rowcount
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not claimed:
            return {"repeat": True, "xp": 0}, progress(row, stats_for(conn, row))

        before = level_info(row["xp"])["level"]
        last = None
        try:
            last = date.fromisoformat(row["last_day"]) if row["last_day"] else None
        except ValueError:
            last = None
        if last and day < last:
            day = last
        gap = (day - last).days if last else None
        first_today = gap != 0

        xp = round(correct * 10 * MULTIPLIERS.get(test["difficulty"], 1.0))
        if total and correct == total:
            xp += 50
        if first_today:
            xp += 20
        xp = max(5, xp)

        streak = row["streak"] + 1 if gap == 1 else (row["streak"] if gap == 0 else 1)
        best_streak = max(row["best_streak"], streak)
        perfects = row["perfects"] + (1 if percent == 100 else 0)
        hard_win = percent >= 75 and test["difficulty"] in ("Hard", "Too Hard")
        hard_wins = row["hard_wins"] + (1 if hard_win else 0)
        tests_done = row["tests"] + 1
        correct_total = row["correct"] + correct
        best = percent if row["best"] is None else max(row["best"], percent)

        conn.execute(
            "UPDATE users SET xp = xp + ?, tests = ?, correct = ?, best = ?, streak = ?, best_streak = ?, "
            "last_day = ?, perfects = ?, hard_wins = ? WHERE id = ?",
            (xp, tests_done, correct_total, best, streak, best_streak, day.isoformat(),
             perfects, hard_wins, user_id),
        )
        hour = hour if isinstance(hour, int) and not isinstance(hour, bool) and 0 <= hour <= 23 else None
        conn.execute(
            "INSERT INTO results (user_id, test_id, topic, difficulty, correct, total, percent, xp, day, week, "
            "created_at, hour, language, files, formats) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, test["id"], test["topic"], test["difficulty"], correct, total, percent, xp,
             day.isoformat(), week_key(day), int(time.time()), hour, test.get("language"),
             test.get("files", 0), test.get("formats", 1)),
        )
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        stats = stats_for(conn, row)
        owned = json.loads(row["badges"] or "[]")
        new_badges = [badge for badge in unlocked_achievements(stats) if badge not in owned]
        if new_badges:
            conn.execute("UPDATE users SET badges = ? WHERE id = ?", (json.dumps(owned + new_badges), user_id))
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    after = level_info(row["xp"])["level"]
    award = {
        "repeat": False, "xp": xp, "levelBefore": before, "levelAfter": after,
        "streak": streak, "firstToday": first_today, "newBadges": new_badges,
    }
    return award, progress(row, stats)


def leaderboard(period, me):
    period = "all" if period == "all" else "week"
    week = week_key(utc_today())
    with connect() as conn:
        if period == "all":
            rows = conn.execute(
                "SELECT id, username, avatar, avatar_version, xp, xp AS score, streak, last_day FROM users "
                "WHERE username IS NOT NULL AND xp > 0 ORDER BY xp DESC, id ASC LIMIT 50"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT users.id, users.username, users.avatar, users.avatar_version, users.xp, users.streak, users.last_day, "
                "SUM(results.xp) AS score FROM results JOIN users ON users.id = results.user_id "
                "WHERE results.week = ? AND users.username IS NOT NULL "
                "GROUP BY users.id ORDER BY score DESC, users.id ASC LIMIT 50",
                (week,),
            ).fetchall()

        mine = None
        if me is not None:
            if period == "all":
                score = me["xp"]
                ahead = conn.execute(
                    "SELECT COUNT(*) FROM users WHERE username IS NOT NULL AND (xp > ? OR (xp = ? AND id < ?))",
                    (score, score, me["id"]),
                ).fetchone()[0]
            else:
                score = conn.execute(
                    "SELECT COALESCE(SUM(xp), 0) FROM results WHERE week = ? AND user_id = ?", (week, me["id"])
                ).fetchone()[0]
                ahead = conn.execute(
                    "SELECT COUNT(*) FROM (SELECT results.user_id AS uid, SUM(results.xp) AS s FROM results "
                    "JOIN users ON users.id = results.user_id "
                    "WHERE results.week = ? AND users.username IS NOT NULL GROUP BY results.user_id "
                    "HAVING s > ? OR (s = ? AND uid < ?))",
                    (week, score, score, me["id"]),
                ).fetchone()[0]
            mine = {"rank": ahead + 1 if score > 0 and me["username"] else None, "score": score}

    entries = []
    for index, row in enumerate(rows, start=1):
        entries.append({
            "rank": index,
            "username": row["username"],
            "avatar": row["avatar"],
            "avatarUrl": avatar_url(row),
            "level": level_info(row["xp"])["level"],
            "score": row["score"],
            "streak": live_streak(row),
            "isMe": bool(me is not None and row["id"] == me["id"]),
        })
    return {"period": period, "week": week, "entries": entries, "me": mine}


def history(user_id):
    with connect() as conn:
        rows = conn.execute(
            "SELECT topic, difficulty, correct, total, percent, xp, created_at FROM results "
            "WHERE user_id = ? ORDER BY created_at DESC LIMIT 12",
            (user_id,),
        ).fetchall()
    return [dict(row) for row in rows]


# ---------------------------------------------------------------- password reset email

def mail_configured():
    return bool(env("SMTP_HOST") and env("SMTP_FROM"))


def send_mail(to, subject, body):
    message = EmailMessage()
    message["From"] = env("SMTP_FROM")
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    port = int(env("SMTP_PORT") or "587")
    context = ssl.create_default_context()
    if port == 465:
        server = smtplib.SMTP_SSL(env("SMTP_HOST"), port, timeout=20, context=context)
    else:
        server = smtplib.SMTP(env("SMTP_HOST"), port, timeout=20)
        server.starttls(context=context)
    with server:
        if env("SMTP_USER"):
            server.login(env("SMTP_USER"), env("SMTP_PASSWORD"))
        server.send_message(message)


# ---------------------------------------------------------------- HTTP routes

def respond(status, payload, cookie=None):
    return status, payload, cookie


def signed_in(conn, user_id, secure, status=200, created=False):
    token = create_session(conn, user_id)
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return respond(status, {"user": user_payload(conn, row), "created": created}, cookie_header(token, secure))


def route(method, path, query, body, cookie, client_ip, secure, base_url):
    """Handle /api/auth/*, /api/account/* and /api/leaderboard. Returns (status, payload, set_cookie)."""
    try:
        return _route(method, path, query, body if isinstance(body, dict) else {}, cookie, client_ip, secure, base_url)
    except AccountError as error:
        return respond(error.status, {"error": error.message, "code": error.code})
    except sqlite3.Error:
        import traceback
        traceback.print_exc()
        return respond(500, {"error": "The account database had a problem. Try again.", "code": "generic"})


def _route(method, path, query, body, cookie, client_ip, secure, base_url):
    user = current_user(cookie)

    if method == "GET":
        if path == "/api/auth/config":
            return respond(200, provider_config())
        if path == "/api/auth/me":
            if user is None:
                return respond(200, {"user": None})
            with connect() as conn:
                # Achievements added after a player earned them are awarded (and celebrated) on return.
                stats = stats_for(conn, user)
                owned = json.loads(user["badges"] or "[]")
                fresh = [badge for badge in unlocked_achievements(stats) if badge not in owned]
                if fresh:
                    conn.execute("UPDATE users SET badges = ? WHERE id = ?", (json.dumps(owned + fresh), user["id"]))
                    user = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
                payload = public_user(user, stats)
                payload["newBadges"] = fresh
                return respond(200, {"user": payload})
        if path == "/api/leaderboard":
            period = (parse_qs(query).get("period") or ["week"])[0]
            return respond(200, leaderboard(period, user))
        if path == "/api/account/username-check":
            name = (parse_qs(query).get("name") or [""])[0]
            try:
                name = clean_username(name)
            except AccountError as error:
                return respond(200, {"available": False, "code": error.code})
            with connect() as conn:
                row = conn.execute("SELECT id FROM users WHERE username = ?", (name,)).fetchone()
            available = row is None or (user is not None and row["id"] == user["id"])
            return respond(200, {"available": available, "code": None if available else "taken"})
        if path == "/api/account/history":
            if user is None:
                raise AccountError(401, "required", "Sign in first.")
            return respond(200, {"history": history(user["id"])})
        raise AccountError(404, "generic", "Endpoint not found.")

    if path == "/api/auth/signup":
        rate_limit(f"auth:{client_ip}")
        email = clean_email(body.get("email"))
        password = clean_password(body.get("password"))
        username = clean_username(body.get("username"))
        avatar = clean_avatar(body.get("avatar"))
        with connect() as conn:
            existing = conn.execute("SELECT password_hash FROM users WHERE email = ?", (email,)).fetchone()
            if existing:
                if existing["password_hash"]:
                    raise AccountError(409, "emailUsed", "An account with this email already exists. Log in instead.")
                raise AccountError(409, "socialOnly", "This email uses Google or Apple sign-in. Use that button instead.")
            if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
                raise AccountError(409, "taken", "That username is already taken.")
            cursor = conn.execute(
                "INSERT INTO users (username, email, password_hash, avatar, created_at) VALUES (?, ?, ?, ?, ?)",
                (username, email, hash_password(password), avatar, int(time.time())),
            )
            return signed_in(conn, cursor.lastrowid, secure, 201, created=True)

    if path == "/api/auth/login":
        rate_limit(f"auth:{client_ip}")
        identifier = body.get("identifier") if isinstance(body.get("identifier"), str) else ""
        password = body.get("password") if isinstance(body.get("password"), str) else ""
        identifier = identifier.strip()
        if not identifier or not password or len(identifier) > 254 or len(password) > 200:
            raise AccountError(401, "wrong", "Wrong email or password.")
        rate_limit(f"login:{identifier.casefold()}", limit=8, window=900)
        with connect() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE email = ? OR username = ?", (identifier, identifier)
            ).fetchone()
            if row is None:
                burn_password_check(password)
                raise AccountError(401, "wrong", "Wrong email or password.")
            if not row["password_hash"]:
                burn_password_check(password)
                raise AccountError(401, "socialOnly", "This account uses Google or Apple sign-in. Use that button instead.")
            if not verify_password(password, row["password_hash"]):
                raise AccountError(401, "wrong", "Wrong email or password.")
            return signed_in(conn, row["id"], secure)

    if path in ("/api/auth/google", "/api/auth/apple"):
        rate_limit(f"auth:{client_ip}", limit=30)
        provider = "google" if path.endswith("google") else "apple"
        config = provider_config()[provider]
        if not config:
            raise AccountError(503, "notConfigured", "This sign-in method is not set up on this server yet.")
        if provider == "google":
            claims = verify_id_token(body.get("credential"), GOOGLE_JWKS, GOOGLE_ISSUERS, config["clientId"])
        else:
            claims = verify_id_token(body.get("idToken"), APPLE_JWKS, APPLE_ISSUERS, config["clientId"])
        subject = str(claims.get("sub") or "")
        if not subject:
            raise AccountError(401, "provider", "That sign-in did not work. Try again.")
        email = claims.get("email") if isinstance(claims.get("email"), str) else None
        verified = claims.get("email_verified") in (True, "true")
        with connect() as conn:
            row, created = social_user(conn, provider, subject, email, verified)
            return signed_in(conn, row["id"], secure, 200, created=created)

    if path == "/api/auth/logout":
        token = session_token(cookie)
        if token:
            with connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
        return respond(200, {"ok": True}, cookie_header("", secure, max_age=0))

    if path == "/api/auth/forgot":
        rate_limit(f"forgot:{client_ip}", limit=5, window=900)
        if not mail_configured():
            raise AccountError(503, "mail", "Password reset by email is not set up on this server yet.")
        email = clean_email(body.get("email"))
        with connect() as conn:
            row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if row:
                token = secrets.token_urlsafe(32)
                conn.execute(
                    "INSERT INTO resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                    (token_hash(token), row["id"], int(time.time()) + RESET_SECONDS),
                )
        if row:
            link = f"{base_url.rstrip('/')}/#reset={token}"
            try:
                send_mail(
                    email,
                    "Reset your Aceminder password",
                    "Someone asked to reset the password for your Aceminder account.\n\n"
                    f"Open this link within one hour to choose a new password:\n{link}\n\n"
                    "If this was not you, ignore this email. Your password stays the same.",
                )
            except (OSError, smtplib.SMTPException):
                import traceback
                traceback.print_exc()
                raise AccountError(502, "generic", "The reset email could not be sent. Try again later.")
        return respond(200, {"ok": True})

    if path == "/api/auth/reset":
        rate_limit(f"reset:{client_ip}", limit=10)
        token = body.get("token") if isinstance(body.get("token"), str) else ""
        password = clean_password(body.get("password"))
        with connect() as conn:
            row = conn.execute(
                "SELECT user_id FROM resets WHERE token_hash = ? AND expires_at > ?",
                (token_hash(token), int(time.time())),
            ).fetchone()
            if not token or not row:
                raise AccountError(400, "reset", "This reset link is invalid or has expired.")
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), row["user_id"]))
            conn.execute("DELETE FROM resets WHERE user_id = ?", (row["user_id"],))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["user_id"],))
            return signed_in(conn, row["user_id"], secure)

    if user is None:
        raise AccountError(401, "required", "Sign in first.")

    if path == "/api/account/profile":
        updates, values = [], []
        if "username" in body:
            updates.append("username = ?")
            values.append(clean_username(body.get("username")))
        if "avatar" in body:
            updates.append("avatar = ?")
            values.append(clean_avatar(body.get("avatar"), user["avatar"]))
        if not updates:
            raise AccountError(400, "generic", "Nothing to change.")
        with connect() as conn:
            try:
                conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", (*values, user["id"]))
            except sqlite3.IntegrityError:
                raise AccountError(409, "taken", "That username is already taken.")
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
            return respond(200, {"user": user_payload(conn, row)})

    if path in ("/api/account/photo", "/api/account/photo-remove"):
        rate_limit(f"photo:{user['id']}", limit=20, window=3600)
        with connect() as conn:
            if path.endswith("remove"):
                conn.execute(
                    "UPDATE users SET avatar_image = NULL, avatar_mime = NULL, avatar_version = 0 WHERE id = ?",
                    (user["id"],),
                )
            else:
                raw, mime = clean_photo(body.get("image"))
                conn.execute(
                    "UPDATE users SET avatar_image = ?, avatar_mime = ?, avatar_version = avatar_version + 1 "
                    "WHERE id = ?",
                    (sqlite3.Binary(raw), mime, user["id"]),
                )
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
            return respond(200, {"user": user_payload(conn, row)})

    if path == "/api/account/delete":
        if body.get("confirm") != "DELETE":
            raise AccountError(400, "generic", "Confirm the deletion first.")
        with connect() as conn:
            conn.execute("DELETE FROM users WHERE id = ?", (user["id"],))
        return respond(200, {"ok": True}, cookie_header("", secure, max_age=0))

    raise AccountError(404, "generic", "Endpoint not found.")
