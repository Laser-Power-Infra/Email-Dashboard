"""
GeM Purchase Order (PO) Webhook Backfill Script
Scans existing threads table in MySQL defaultdb for historical GeM PO PDFs
and dispatches webhooks for all un-sent PO orders.
"""

import sys
import logging
import re
import mysql.connector

from claude_Oracel_db import (
    get_db_connection,
    init_db,
    send_po_release_webhook,
    is_po_in_registry,
    GEM_ID_REGEX,
    PO_WEBHOOK_URL,
    WEBHOOK_ENABLED
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger("backfill_po_webhooks")

def run_backfill(limit: int = None, dry_run: bool = False):
    logger.info("Initializing database tables...")
    init_db()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    logger.info("Querying threads table for historical GeM PO PDFs...")
    query = """
        SELECT thread_id, subject, body, attach_names, attach_links, ocr_text
        FROM threads
        WHERE attach_names LIKE '%.pdf%'
          AND (subject REGEXP 'GEMC|GEM/' 
            OR body REGEXP 'GEMC|GEM/' 
            OR attach_names REGEXP 'GEMC|GEM/'
            OR ocr_text REGEXP 'GEMC|GEM/')
    """
    if limit:
        query += f" LIMIT {limit}"

    cursor.execute(query)
    threads = cursor.fetchall()
    logger.info(f"Found {len(threads)} potential GeM PO threads.")

    total_gems = 0
    total_files_sent = 0
    total_skipped = 0
    total_failed = 0

    for i, thread in enumerate(threads, 1):
        thread_id = thread["thread_id"]
        subject = thread["subject"] or ""
        body = thread["body"] or ""
        attach_names_raw = thread["attach_names"] or ""
        attach_links_raw = thread["attach_links"] or ""
        ocr_text = thread["ocr_text"] or ""

        combined_text = f"{subject} {body[:5000]} {attach_names_raw} {ocr_text[:5000]}"
        gem_ids = set(GEM_ID_REGEX.findall(combined_text))

        if not gem_ids:
            continue

        names = [n.strip() for n in attach_names_raw.split(",") if n.strip()]
        links = [l.strip() for l in attach_links_raw.split(",") if l.strip()]

        attachment_files = []
        for idx, fname in enumerate(names):
            if fname and fname != "[No Attachments]":
                dlink = links[idx] if idx < len(links) and links[idx] != "[No Links]" else ""
                if dlink:
                    attachment_files.append({"name": fname, "drive_link": dlink})

        if not attachment_files:
            continue

        for gid in gem_ids:
            total_gems += 1
            if dry_run:
                logger.info(f"[DRY-RUN] GeM ID: {gid} -> {len(attachment_files)} file(s) ({', '.join([f['name'] for f in attachment_files])})")
                continue

            success = send_po_release_webhook(gid, attachment_files, thread_id)
            if success:
                total_files_sent += len(attachment_files)
            else:
                total_failed += 1

        if i % 100 == 0:
            logger.info(f"Processed {i}/{len(threads)} threads...")

    cursor.close()
    conn.close()

    logger.info("=" * 60)
    logger.info("BACKFILL EVALUATION COMPLETED")
    logger.info(f"Total GeM IDs evaluated: {total_gems}")
    if not dry_run:
        logger.info(f"Total PO files sent:     {total_files_sent}")
        logger.info(f"Total failed/skipped:   {total_failed}")
    logger.info("=" * 60)

if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    limit = None
    for arg in sys.argv:
        if arg.startswith("--limit="):
            limit = int(arg.split("=")[1])

    logger.info(f"Starting PO Webfill Backfill (dry_run={dry_run}, limit={limit})...")
    run_backfill(limit=limit, dry_run=dry_run)
