"""Aceminder accounts: users, sessions, Google / Apple / email sign-in, XP and leaderboards.

Email sign-ups are confirmed with a six-digit code before the account is created, and forgotten
passwords are reset with a code too (see mailer.py).

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
import sqlite3
import threading
import time
import traceback
from collections import defaultdict, deque
from contextlib import contextmanager
from datetime import date, datetime, timezone
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs
from urllib.request import Request, urlopen

import mailer

ROOT = Path(__file__).resolve().parent
SESSION_COOKIE = "aceminder_session"
SESSION_SECONDS = 30 * 86400
CODE_SECONDS = 600
CODE_RESEND_SECONDS = 45
CODE_MAX_ATTEMPTS = 5
CODE_MAX_SENDS = 4
TEST_KEEP_SECONDS = 30 * 86400
USERNAME_PATTERN = re.compile(r"[^\W_][\w.]{2,19}", re.UNICODE)
EMAIL_PATTERN = re.compile(
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]"
)
COMMON_PASSWORDS = {
    "password", "password1", "password123", "passw0rd", "12345678", "123456789", "1234567890",
    "qwertyuiop", "qwerty123", "qwertyui", "11111111", "00000000", "87654321", "abcd1234", "abc12345",
    "iloveyou", "letmein1", "welcome1", "football", "baseball", "sunshine", "princess", "superman",
    "aceminder", "aceminder1", "1q2w3e4r", "asdfghjk", "asdfghjkl", "computer", "internet",
}
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

    def __init__(self, status, code, message, **extra):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra


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
CREATE TABLE IF NOT EXISTS codes (
    ticket_hash TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    username TEXT COLLATE NOCASE,
    data TEXT,
    language TEXT NOT NULL DEFAULT 'English',
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sends INTEGER NOT NULL DEFAULT 1,
    sent_at INTEGER NOT NULL,
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
            ("users", "email_verified", "INTEGER NOT NULL DEFAULT 0"),
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
        # Reset links were replaced by emailed codes.
        conn.execute("DROP TABLE IF EXISTS resets")
        conn.execute("DELETE FROM codes WHERE expires_at < ?", (now,))
        # Google and Apple already proved these addresses.
        conn.execute(
            "UPDATE users SET email_verified = 1 WHERE email IS NOT NULL AND password_hash IS NULL "
            "AND (google_sub IS NOT NULL OR apple_sub IS NOT NULL)"
        )
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


def clean_password(value, *personal):
    if not isinstance(value, str) or not 8 <= len(value) <= 200:
        raise AccountError(400, "password", "Password must be at least 8 characters.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise AccountError(400, "passwordChars", "That password contains a character that cannot be used.")
    plain = value.casefold()
    obvious = plain in COMMON_PASSWORDS or len(set(plain)) == 1
    if obvious or any(item and plain == item.casefold() for item in personal):
        raise AccountError(400, "passwordWeak", "That password is too easy to guess. Choose another one.")
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
        if len(_attempts) > 5000:
            for stale in [k for k, times in _attempts.items() if not times or now - times[-1] > 3600]:
                del _attempts[stale]
        bucket = _attempts[key]
        while bucket and now - bucket[0] > window:
            bucket.popleft()
        if len(bucket) >= limit:
            wait = max(1, int(window - (now - bucket[0])) + 1)
            raise AccountError(
                429, "rate", "Too many attempts. Wait a few minutes and try again.", retryIn=wait
            )
        bucket.append(now)


def rate_forgive(key):
    """Undo the latest hit, so successful attempts never count towards a lockout."""
    with _attempts_lock:
        bucket = _attempts.get(key)
        if bucket:
            bucket.pop()


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
        "mail": "email" if mailer.configured() else "console",
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
            # The provider proved this person owns the email. If the account never confirmed it,
            # drop its password and sessions in case someone else pre-registered the address.
            if row["email_verified"]:
                conn.execute(f"UPDATE users SET {column} = ? WHERE id = ?", (subject, row["id"]))
            else:
                conn.execute(
                    f"UPDATE users SET {column} = ?, password_hash = NULL, email_verified = 1 WHERE id = ?",
                    (subject, row["id"]),
                )
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
            return conn.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone(), False
    cursor = conn.execute(
        f"INSERT INTO users ({column}, email, email_verified, avatar, created_at) VALUES (?, ?, ?, ?, ?)",
        (subject, email if email_verified else None, 1 if email and email_verified else 0,
         clean_avatar(None), int(time.time())),
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
        "emailVerified": bool(row["email_verified"]),
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


# ---------------------------------------------------------------- emailed six-digit codes

def clean_language(value):
    return value if isinstance(value, str) and value in mailer.TEXTS else "English"


def code_digest(ticket, code):
    """Keyed by the ticket (stored only as a hash), so a leaked database cannot reveal codes."""
    return hmac.new(ticket.encode("utf-8"), code.encode("utf-8"), hashlib.sha256).hexdigest()


def new_code():
    return f"{secrets.randbelow(1_000_000):06d}"


def limit_sends(email, client_ip):
    rate_limit(f"send-ip:{client_ip}", limit=15, window=3600)
    rate_limit(f"send-to:{email.casefold()}", limit=6, window=3600)


def send_code(purpose, email, code, language):
    try:
        mailer.deliver_code(purpose, email, code, language)
    except mailer.MailError:
        raise AccountError(
            502, "mailSend", "The email could not be sent. Check the address or try again in a few minutes."
        )


def send_code_later(purpose, email, code, language):
    """Send without making the visitor wait, so timing cannot reveal which emails have accounts."""
    def work():
        try:
            mailer.deliver_code(purpose, email, code, language)
        except mailer.MailError:
            pass  # mailer already reported the reason in the server window
        except Exception:
            traceback.print_exc()
    threading.Thread(target=work, daemon=True).start()


def create_code(purpose, email, language, user_id=None, username=None, data=None):
    """Store a fresh code and return (ticket, code). The ticket goes to the browser."""
    ticket, code, now = secrets.token_urlsafe(24), new_code(), int(time.time())
    with connect() as conn:
        conn.execute("DELETE FROM codes WHERE expires_at < ?", (now - CODE_SECONDS,))
        conn.execute(
            "INSERT INTO codes (ticket_hash, purpose, user_id, email, username, data, language, code_hash, "
            "sent_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (token_hash(ticket), purpose, user_id, email, username,
             json.dumps(data) if data is not None else None, language, code_digest(ticket, code),
             now, now + CODE_SECONDS),
        )
    return ticket, code


def drop_code(ticket):
    with connect() as conn:
        conn.execute("DELETE FROM codes WHERE ticket_hash = ?", (token_hash(ticket),))


def code_payload(ticket, purpose, email):
    return {
        "ticket": ticket, "purpose": purpose, "email": email,
        "resendIn": CODE_RESEND_SECONDS, "expiresIn": CODE_SECONDS,
        "delivery": "email" if mailer.configured() else "console",
    }


def clean_ticket(value):
    if not isinstance(value, str) or not 20 <= len(value) <= 80 or not value.isascii():
        raise AccountError(400, "codeExpired", "This code has expired. Ask for a new one.")
    return value


def check_code(ticket, code, purposes, client_ip):
    """Return the stored row when the code is right. Every guess is counted before it is checked."""
    rate_limit(f"guess:{client_ip}", limit=40, window=3600)
    ticket = clean_ticket(ticket)
    digits = re.sub(r"\s+", "", code) if isinstance(code, str) else ""
    if not re.fullmatch(r"[0-9]{6}", digits):
        raise AccountError(400, "code", "Enter the 6-digit code.")
    key = token_hash(ticket)
    with connect() as conn:
        counted = conn.execute(
            "UPDATE codes SET attempts = attempts + 1 WHERE ticket_hash = ? AND attempts < ? AND expires_at > ?",
            (key, CODE_MAX_ATTEMPTS, int(time.time())),
        ).rowcount
        row = conn.execute("SELECT * FROM codes WHERE ticket_hash = ?", (key,)).fetchone()
    if not counted or row is None or row["purpose"] not in purposes:
        raise AccountError(400, "codeExpired", "This code has expired. Ask for a new one.")
    if not hmac.compare_digest(code_digest(ticket, digits), row["code_hash"]):
        left = CODE_MAX_ATTEMPTS - row["attempts"]
        if left <= 0:
            raise AccountError(400, "codeExpired", "Too many wrong codes. Ask for a new one.")
        raise AccountError(400, "codeWrong", "That code is not right.", left=left)
    rate_forgive(f"guess:{client_ip}")
    return row


def use_code(conn, row):
    """Spend a code exactly once, inside the caller's transaction."""
    if not conn.execute("DELETE FROM codes WHERE ticket_hash = ?", (row["ticket_hash"],)).rowcount:
        raise AccountError(400, "codeExpired", "This code has expired. Ask for a new one.")


def email_taken(conn, email):
    existing = conn.execute("SELECT password_hash FROM users WHERE email = ?", (email,)).fetchone()
    if not existing:
        return
    if existing["password_hash"]:
        raise AccountError(409, "emailUsed", "An account with this email already exists. Log in instead.")
    raise AccountError(409, "socialOnly", "This email uses Google or Apple sign-in. Use that button instead.")


def username_taken(conn, username, email):
    if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        raise AccountError(409, "taken", "That username is already taken.")
    # Someone is confirming their email right now with this name: hold it for them.
    if conn.execute(
        "SELECT 1 FROM codes WHERE purpose = 'signup' AND username = ? AND email <> ? AND expires_at > ?",
        (username, email, int(time.time())),
    ).fetchone():
        raise AccountError(409, "taken", "That username is already taken.")


def insert_user(conn, username, email, password_hash, avatar, verified):
    # If the name was taken in the meantime, create the account and let them pick another.
    if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        username = None
    try:
        return conn.execute(
            "INSERT INTO users (username, email, password_hash, avatar, created_at, email_verified) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (username, email, password_hash, avatar, int(time.time()), 1 if verified else 0),
        ).lastrowid
    except sqlite3.IntegrityError:
        raise AccountError(409, "emailUsed", "An account with this email already exists. Log in instead.")


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
        return respond(error.status, {"error": error.message, "code": error.code, **error.extra})
    except Exception:
        # Always answer: an unhandled error would drop the connection and look like a dead server.
        traceback.print_exc()
        return respond(500, {"error": "Something went wrong on the server. Try again.", "code": "generic"})


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
        # Check everything the person can fix before counting this as an attempt.
        username = clean_username(body.get("username"))
        email = clean_email(body.get("email"))
        password = clean_password(body.get("password"), username, email, email.partition("@")[0])
        avatar = clean_avatar(body.get("avatar"))
        language = clean_language(body.get("language"))
        rate_limit(f"signup:{client_ip}", limit=30, window=3600)
        with connect() as conn:
            email_taken(conn, email)
            username_taken(conn, username, email)
        password_hash = hash_password(password)

        if mailer.configured():
            # The account is only created once the emailed code comes back.
            limit_sends(email, client_ip)
            ticket, code = create_code(
                "signup", email, language, username=username,
                data={"username": username, "passwordHash": password_hash, "avatar": avatar},
            )
            try:
                send_code("signup", email, code, language)
            except AccountError:
                drop_code(ticket)
                raise
            return respond(202, {"verify": code_payload(ticket, "signup", email)})

        # No email service yet: never block sign-up on a message that cannot be delivered.
        with connect() as conn:
            user_id = insert_user(conn, username, email, password_hash, avatar, verified=False)
            result = signed_in(conn, user_id, secure, 201, created=True)
        ticket, code = create_code("verify", email, language, user_id=user_id)
        send_code_later("verify", email, code, language)
        result[1]["verify"] = code_payload(ticket, "verify", email)
        return result

    if path == "/api/auth/verify":
        row = check_code(body.get("ticket"), body.get("code"), ("signup", "verify"), client_ip)
        with connect() as conn:
            use_code(conn, row)
            if row["purpose"] == "signup":
                data = json.loads(row["data"])
                email_taken(conn, row["email"])
                user_id = insert_user(
                    conn, data["username"], row["email"], data["passwordHash"], data["avatar"], verified=True
                )
                return signed_in(conn, user_id, secure, 201, created=True)
            conn.execute(
                "UPDATE users SET email_verified = 1 WHERE id = ? AND email = ?", (row["user_id"], row["email"])
            )
            fresh = None
            if user is not None and user["id"] == row["user_id"]:
                fresh = user_payload(
                    conn, conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
                )
            return respond(200, {"verified": True, "user": fresh})

    if path == "/api/auth/resend":
        ticket = clean_ticket(body.get("ticket"))
        key, now = token_hash(ticket), int(time.time())
        rate_limit(f"resend:{client_ip}", limit=30, window=3600)
        with connect() as conn:
            row = conn.execute("SELECT * FROM codes WHERE ticket_hash = ?", (key,)).fetchone()
        # Keep the ticket alive a little past its code so "send again" works right after it expires.
        if row is None or row["expires_at"] < now - CODE_SECONDS:
            raise AccountError(400, "codeExpired", "This code has expired. Start again.")
        if row["sends"] >= CODE_MAX_SENDS:
            raise AccountError(429, "codeSends", "Too many codes were sent. Start again in a few minutes.")
        wait = row["sent_at"] + CODE_RESEND_SECONDS - now
        if wait > 0:
            raise AccountError(429, "codeWait", "Wait a moment before asking for another code.", retryIn=wait)
        limit_sends(row["email"], client_ip)
        code = new_code()
        with connect() as conn:
            claimed = conn.execute(
                "UPDATE codes SET code_hash = ?, attempts = 0, sends = sends + 1, sent_at = ?, expires_at = ? "
                "WHERE ticket_hash = ? AND sends = ?",
                (code_digest(ticket, code), now, now + CODE_SECONDS, key, row["sends"]),
            ).rowcount
        if not claimed:
            raise AccountError(429, "codeWait", "Wait a moment before asking for another code.",
                               retryIn=CODE_RESEND_SECONDS)
        if row["purpose"] == "reset":
            if row["user_id"] is not None:
                send_code_later("reset", row["email"], code, row["language"])
        else:
            send_code(row["purpose"], row["email"], code, row["language"])
        return respond(200, {"verify": code_payload(ticket, row["purpose"], row["email"])})

    if path == "/api/auth/login":
        identifier = body.get("identifier") if isinstance(body.get("identifier"), str) else ""
        password = body.get("password") if isinstance(body.get("password"), str) else ""
        identifier = identifier.strip()
        wrong = AccountError(401, "wrong", "Wrong email, username or password.")
        if not identifier or not password or len(identifier) > 254 or len(password) > 200:
            raise wrong
        with connect() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE email = ? OR username = ?", (identifier, identifier)
            ).fetchone()
        # Only failures count, so logging in normally can never lock anyone out.
        who = f"id{row['id']}" if row else identifier.casefold()
        keys = ((f"login-ip:{client_ip}", 30, 600), (f"login:{who}:{client_ip}", 8, 900), (f"login:{who}", 40, 900))
        for key, limit, window in keys:
            rate_limit(key, limit, window)
        try:
            password.encode("utf-8")
        except UnicodeEncodeError:
            raise wrong
        if row is None:
            burn_password_check(password)
            raise wrong
        if not row["password_hash"]:
            burn_password_check(password)
            raise AccountError(
                401, "socialOnly", "This account uses Google or Apple sign-in. Use that button instead."
            )
        if not verify_password(password, row["password_hash"]):
            raise wrong
        for key, _limit, _window in keys:
            rate_forgive(key)
        with connect() as conn:
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
        email = clean_email(body.get("email"))
        language = clean_language(body.get("language"))
        limit_sends(email, client_ip)
        with connect() as conn:
            row = conn.execute("SELECT id, email FROM users WHERE email = ?", (email,)).fetchone()
        # Unknown addresses get an identical answer, so this cannot reveal who has an account.
        ticket, code = create_code("reset", email, language, user_id=row["id"] if row else None)
        if row:
            send_code_later("reset", row["email"], code, language)
        return respond(200, {"verify": code_payload(ticket, "reset", email)})

    if path == "/api/auth/reset":
        # Check the new password first so a weak one does not use up a guess.
        password = clean_password(body.get("password"))
        row = check_code(body.get("ticket"), body.get("code"), ("reset",), client_ip)
        password_hash = hash_password(password)
        with connect() as conn:
            use_code(conn, row)
            owner = conn.execute(
                "SELECT id FROM users WHERE id = ? AND email = ?", (row["user_id"], row["email"])
            ).fetchone()
            if owner is None:
                raise AccountError(400, "codeExpired", "This code has expired. Ask for a new one.")
            # Receiving the code proves the email; sign every other device out.
            conn.execute(
                "UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?", (password_hash, owner["id"])
            )
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (owner["id"],))
            conn.execute("DELETE FROM codes WHERE user_id = ? AND purpose = 'reset'", (owner["id"],))
            return signed_in(conn, owner["id"], secure)

    if path == "/api/auth/verify-start" and user is not None:
        if not user["email"] or user["email_verified"]:
            raise AccountError(400, "alreadyVerified", "Your email is already confirmed.")
        language = clean_language(body.get("language"))
        limit_sends(user["email"], client_ip)
        ticket, code = create_code("verify", user["email"], language, user_id=user["id"])
        try:
            send_code("verify", user["email"], code, language)
        except AccountError:
            drop_code(ticket)
            raise
        return respond(200, {"verify": code_payload(ticket, "verify", user["email"])})

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
