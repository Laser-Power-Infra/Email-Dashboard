"""
Old-mail backfill – scans Gmail history OLDER than what the live pipeline
(claude_Oracel_db.py) has stored in `defaultdb`, and stores it in a separate
MySQL database (`old_mails` by default).

Processing logic is 100% the live pipeline's: this file imports
claude_Oracel_db and calls its process_gmail_batch() unchanged. Only these
things are redirected:

  * thread / status writes      -> old_mails DB
  * all_email mapping (read)    -> defaultdb.all_email (same as live)
  * new laserpower emails       -> registered in defaultdb.all_email + MAIL MASTER sheet (same as live)
  * Drive attachments           -> separate "Old_Mails_Attachments" folder
  * PO release webhook          -> OFF
  * backend tender-scan trigger -> OFF

How it walks history:
  Starts just before [old_mails] start_before in config.ini (default 2026-09-01, IST) –
  defaultdb is only complete from Sep 2026, so Jan–Aug 2026 is scanned too.
  Then month by month backwards (IST month boundaries). After each month it probes
  Gmail for anything older; when nothing older exists the backfill is complete.
  Threads already in defaultdb or old_mails are skipped, so it is safe to stop and
  restart at any time – finished months are recorded in `backfill_progress`.

Usage (run from the Emails_agent folder, same as the live script):
  python old_mails_backfill.py --dry-run     # count threads per month, writes nothing
  python old_mails_backfill.py               # run the backfill
"""

import argparse
import configparser
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set, Tuple

import mysql.connector

import claude_Oracel_db as core

logger = logging.getLogger("old_mails_backfill")

IST = timezone(timedelta(hours=5, minutes=30))

_cfg = configparser.ConfigParser()
_cfg.read("config.ini")
OLD_DB_NAME        = _cfg.get("old_mails", "database", fallback="old_mails")
OLD_DRIVE_FOLDER   = _cfg.get("old_mails", "drive_folder_id", fallback="").strip() or None
OLD_DRIVE_NAME     = "Old_Mails_Attachments"
# Scan everything strictly before this date (IST midnight). Threads already in
# defaultdb are skipped, so overlap with the live DB is harmless.
START_BEFORE = datetime.strptime(
    _cfg.get("old_mails", "start_before", fallback="2026-09-01").strip(), "%Y-%m-%d"
).replace(tzinfo=IST)

# Gmail base filter – taken from the live pipeline so exclusions stay identical.
BASE_QUERY = core.get_search_query(0).split(" after:")[0]


# -----------------------------------------------------------------------
# DB connections
# -----------------------------------------------------------------------
live_db_connection = core.get_db_connection            # defaultdb (original)


def old_db_connection():
    return mysql.connector.connect(
        host=core.MYSQL_HOST,
        user=core.MYSQL_USER,
        password=core.MYSQL_PASSWORD,
        database=OLD_DB_NAME,
        port=core.MYSQL_PORT,
        charset="utf8mb4",
        use_unicode=True,
        autocommit=False,
    )


def ensure_old_database():
    conn = mysql.connector.connect(
        host=core.MYSQL_HOST, user=core.MYSQL_USER, password=core.MYSQL_PASSWORD,
        port=core.MYSQL_PORT, charset="utf8mb4",
    )
    cur = conn.cursor()
    cur.execute(
        f"CREATE DATABASE IF NOT EXISTS `{OLD_DB_NAME}` "
        "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    )
    conn.commit()
    cur.close()
    conn.close()

    # Same schema as live (threads, processing_status, email_categories, gem_po_registry).
    # init_db() uses core.get_db_connection, so point it at old_mails for this call.
    saved_conn = core.get_db_connection
    core.get_db_connection = old_db_connection
    try:
        core.init_db()
    finally:
        core.get_db_connection = saved_conn

    conn = old_db_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backfill_meta (
            k VARCHAR(100) PRIMARY KEY,
            v VARCHAR(1024)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backfill_progress (
            month_start    DATE PRIMARY KEY,
            window_after   BIGINT,
            window_before  BIGINT,
            threads_found  INT DEFAULT 0,
            threads_new    INT DEFAULT 0,
            threads_failed INT DEFAULT 0,
            status         VARCHAR(20) DEFAULT 'running',
            started_at     TIMESTAMP NULL,
            finished_at    TIMESTAMP NULL
        )
    """)
    conn.commit()
    cur.close()
    conn.close()


def meta_get(key: str) -> Optional[str]:
    conn = old_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT v FROM backfill_meta WHERE k=%s", (key,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row[0] if row else None


def meta_set(key: str, value: str):
    conn = old_db_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO backfill_meta (k, v) VALUES (%s, %s) ON DUPLICATE KEY UPDATE v=VALUES(v)",
        (key, value),
    )
    conn.commit()
    cur.close()
    conn.close()


# -----------------------------------------------------------------------
# Redirect the live pipeline's side effects
# -----------------------------------------------------------------------
_orig_auto_register = core.auto_register_laserpower_emails


def _auto_register_into_live_db(db_conn, email_map, emails, gmail_service=None):
    """process_gmail_batch passes the old_mails connection; all_email lives in defaultdb."""
    pending = [
        e for e in (emails or [])
        if e and "@" in e
        and ("laserpower" in e.lower() or "laserpowerinfra" in e.lower())
        and e.lower().strip() not in email_map
    ]
    if not pending:
        return
    conn = live_db_connection()
    try:
        _orig_auto_register(conn, email_map, pending, gmail_service=gmail_service)
    finally:
        conn.close()


def _disabled_po_webhook(gem_id, po_files, thread_id=""):
    logger.info(f"  [Old-mail mode] PO webhook skipped for {gem_id} (thread {thread_id})")
    return False


def patch_core(drive_folder_id: str):
    core.get_db_connection               = old_db_connection
    core.auto_register_laserpower_emails = _auto_register_into_live_db
    core.send_po_release_webhook         = _disabled_po_webhook
    core.trigger_backend_tender_scan     = lambda: None
    core.WEBHOOK_ENABLED                 = False
    core.DRIVE_FOLDER_ID                 = drive_folder_id


def get_or_create_old_drive_folder(drive_service) -> str:
    if OLD_DRIVE_FOLDER:
        return OLD_DRIVE_FOLDER
    saved = meta_get("drive_folder_id")
    if saved:
        return saved
    folder_id = core.create_drive_folder(drive_service, OLD_DRIVE_NAME)
    if not folder_id:
        raise RuntimeError("Could not create the Old_Mails_Attachments Drive folder")
    meta_set("drive_folder_id", folder_id)
    logger.info(f"Created Drive folder {OLD_DRIVE_NAME} id={folder_id}")
    return folder_id


# -----------------------------------------------------------------------
# History windows
# -----------------------------------------------------------------------
def month_start_ist(dt: datetime) -> datetime:
    d = dt.astimezone(IST)
    return datetime(d.year, d.month, 1, tzinfo=IST)


def prev_month(dt: datetime) -> datetime:
    return month_start_ist(dt - timedelta(days=1))


def window_query(after: datetime, before: datetime) -> str:
    return f"{BASE_QUERY} after:{int(after.timestamp())} before:{int(before.timestamp())}"


def anything_older_than(gmail_service, ts: datetime) -> bool:
    resp = gmail_service.users().threads().list(
        userId="me", q=f"{BASE_QUERY} before:{int(ts.timestamp())}", maxResults=1
    ).execute()
    return bool(resp.get("threads"))


def load_ids(conn_factory, ids: List[str]) -> Set[str]:
    found: Set[str] = set()
    if not ids:
        return found
    conn = conn_factory()
    cur = conn.cursor()
    for i in range(0, len(ids), 1000):
        chunk = ids[i:i + 1000]
        cur.execute(
            f"SELECT thread_id FROM threads WHERE thread_id IN ({','.join(['%s'] * len(chunk))})",
            chunk,
        )
        found.update(r[0] for r in cur.fetchall())
    cur.close()
    conn.close()
    return found


def done_months() -> Set[str]:
    conn = old_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT month_start FROM backfill_progress WHERE status='done'")
    out = {str(r[0]) for r in cur.fetchall()}
    cur.close()
    conn.close()
    return out


def record_month(month: datetime, after: datetime, before: datetime, **fields):
    conn = old_db_connection()
    cur = conn.cursor()
    cols = {"month_start": month.date(), "window_after": int(after.timestamp()),
             "window_before": int(before.timestamp()), **fields}
    names = ", ".join(cols)
    ph = ", ".join(["%s"] * len(cols))
    upd = ", ".join(f"{k}=VALUES({k})" for k in cols if k != "month_start")
    cur.execute(
        f"INSERT INTO backfill_progress ({names}) VALUES ({ph}) ON DUPLICATE KEY UPDATE {upd}",
        list(cols.values()),
    )
    conn.commit()
    cur.close()
    conn.close()


# -----------------------------------------------------------------------
# Main loop
# -----------------------------------------------------------------------
def process_window(gmail_service, drive_service, email_map, threads: List[dict]) -> Tuple[int, int]:
    """Run the live pipeline's process_gmail_batch until every thread is stored or given up."""
    all_ids = [t["id"] for t in threads]
    in_live = load_ids(live_db_connection, all_ids)
    by_id = {t["id"]: t for t in threads if t["id"] not in in_live}
    new_total = 0
    last_remaining = None

    while True:
        in_old = load_ids(old_db_connection, list(by_id))
        remaining = [
            t for tid, t in by_id.items()
            if tid not in in_old and core._THREAD_FAILURES.get(tid, 0) < core.MAX_THREAD_FAILURES
        ]
        if last_remaining is not None:
            new_total += last_remaining - len(remaining)
        if not remaining:
            break
        if last_remaining is not None and len(remaining) == last_remaining:
            # No progress in a full pass (e.g. threads Gmail returns empty) – give up on them.
            for t in remaining:
                core._THREAD_FAILURES[t["id"]] = core.MAX_THREAD_FAILURES
            logger.warning(f"No progress on {len(remaining)} thread(s); marking them failed and moving on.")
            break
        last_remaining = len(remaining)
        logger.info(f"Window: {len(remaining)} thread(s) left to store (skipped {len(in_live)} already in defaultdb)")
        core.process_gmail_batch(
            gmail_service, drive_service, remaining, email_map,
            start_index=0, batch_size=len(remaining),
        )

    failed = sum(
        1 for tid in by_id if core._THREAD_FAILURES.get(tid, 0) >= core.MAX_THREAD_FAILURES
    )
    return new_total, failed


def run(dry_run: bool):
    upper = START_BEFORE
    logger.info(f"Scanning all mail before {upper:%Y-%m-%d %H:%M} IST "
                "(threads already in defaultdb are skipped)")

    gmail_service, drive_service = core.get_google_services()

    if not dry_run:
        ensure_old_database()
        meta_set("start_before", f"{upper:%Y-%m-%d}")
        folder_id = get_or_create_old_drive_folder(drive_service)
        patch_core(folder_id)
        logger.info(f"Writing to DB `{OLD_DB_NAME}`, Drive folder {folder_id}; PO webhook OFF")

    finished = set() if dry_run else done_months()
    before = upper
    month = month_start_ist(upper - timedelta(seconds=1))
    grand_total = grand_new = 0
    services_age = 0

    while True:
        after = month
        key = str(month.date())
        label = f"{month:%Y-%m}"

        if services_age >= 5:                 # refresh sockets/token periodically
            gmail_service, drive_service = core.get_google_services()
            services_age = 0
        services_age += 1

        if key in finished:
            logger.info(f"[{label}] already done – skipping")
        else:
            q = window_query(after, before)
            threads = core.search_threads(gmail_service, q)
            grand_total += len(threads)

            if dry_run:
                in_live = load_ids(live_db_connection, [t["id"] for t in threads])
                logger.info(f"[{label}] {len(threads)} threads ({len(in_live)} already in defaultdb, "
                            f"{len(threads) - len(in_live)} to store)")
                grand_new += len(threads) - len(in_live)
            else:
                logger.info(f"\n{'#' * 70}\n[{label}] {len(threads)} threads in window\n{'#' * 70}")
                record_month(month, after, before, threads_found=len(threads),
                             status="running", started_at=datetime.now())
                new, failed = process_window(gmail_service, drive_service, email_map_cache(), threads)
                grand_new += new
                record_month(month, after, before, threads_found=len(threads), threads_new=new,
                             threads_failed=failed, status="done", finished_at=datetime.now())
                logger.info(f"[{label}] done: stored {new}, failed {failed}")

        if not anything_older_than(gmail_service, after):
            logger.info(f"No mail older than {after:%Y-%m-%d}. Backfill complete.")
            break
        before = after
        month = prev_month(after)

    logger.info(f"TOTAL threads seen: {grand_total}; "
                f"{'to store' if dry_run else 'stored this run'}: {grand_new}")


_EMAIL_MAP: Optional[Dict] = None


def email_map_cache() -> Dict:
    """all_email mapping from defaultdb, refreshed per month; shared dict so new registrations stick."""
    global _EMAIL_MAP
    conn = live_db_connection()
    try:
        fresh = core.load_all_email_mapping(conn)
    finally:
        conn.close()
    if _EMAIL_MAP is None:
        _EMAIL_MAP = fresh
    else:
        _EMAIL_MAP.update(fresh)
    return _EMAIL_MAP


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill Gmail history older than defaultdb into old_mails")
    parser.add_argument("--dry-run", action="store_true", help="only count threads per month; write nothing")
    args = parser.parse_args()
    try:
        run(dry_run=args.dry_run)
    except KeyboardInterrupt:
        logger.info("Interrupted – rerun to resume.")
        sys.exit(0)
