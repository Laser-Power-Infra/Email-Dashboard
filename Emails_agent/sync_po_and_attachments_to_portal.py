"""
Strict Sync GeM PO Order PDFs & Separated Attachment Files to External Portal DB
1. STRICTLY identifies only genuine Purchase Orders (PO) / GeM Contract PDFs for `order_pdf`.
2. Any non-PO PDFs (bid.pdf, tender notices, annexures, GTPs, BOQs, etc.) are NEVER put into `order_pdf`.
3. Puts all general attachment files with their real filenames into `gmd_gem_files` and `drive_link`.
"""

import os
import re
import json
import logging
import mysql.connector
import psycopg2
from datetime import datetime

from claude_Oracel_db import (
    get_db_connection as get_mysql_connection,
    GEM_ID_REGEX
)

PG_URL = os.environ.get("DATABASE_URL", "postgresql://asmita:asmita@192.168.1.190:5432/gmd_gem_ids")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger("sync_po_portal_strict")

def is_strict_po_order_pdf(filename: str, gem_id: str = "") -> bool:
    """
    STRICTLY identify if a file is a Purchase Order (PO) or GeM Contract PDF.
    Returns False for all ordinary bid/tender documents, annexures, drawings, GTPs, etc.
    """
    if not filename:
        return False
    fn = filename.lower().strip()
    
    # Must be a document file
    if not fn.endswith(('.pdf', '.doc', '.docx')):
        return False

    # Negative Filters: Explicitly NOT an Order PDF
    disqualify_keywords = [
        'gem-bidding', 'gem_bidding', 'bidding', 'bid_doc', 'bid document', 'bid.pdf',
        'tender', 'nit', 'annexure', 'gtp', 'drawing', 'inspection', 'test certificate',
        'tc_', '_tc.', 'bg format', 'emd', 'boq', 'sub-vendor', 'questionnaire',
        'addendum', 'corrigendum', 'commercial evaluation', 'technical evaluation',
        'pre-bid', 'prebid', 'query', 'clarification', 'credential'
    ]
    if any(dk in fn for dk in disqualify_keywords):
        return False

    # Positive Match 1: GeM Contract Order Number (GEMC-... or GEM-... with 14-16 digits)
    if re.search(r'gemc?-?[0-9]{14,16}', fn):
        return True

    # Positive Match 2: Direct match with GeM Contract ID
    clean_gid = re.sub(r'[^a-z0-9]', '', (gem_id or '').lower())
    clean_fn = re.sub(r'[^a-z0-9]', '', fn)
    if clean_gid and clean_gid.startswith('gemc') and clean_gid in clean_fn:
        return True

    # Positive Match 3: Explicit Purchase Order / Work Order / Supply Order keywords
    if re.search(r'\b(purchase[_\s-]?order|work[_\s-]?order|supply[_\s-]?order|order[_\s-]?copy)\b', fn):
        return True
    if re.search(r'(^|[\s_-])po[\s_-]', fn) or fn.startswith('po_') or fn.startswith('po-'):
        return True

    return False

def sync_all():
    logger.info("Connecting to MySQL and PostgreSQL...")
    conn_mysql = get_mysql_connection()
    cur_mysql = conn_mysql.cursor(dictionary=True)

    conn_pg = psycopg2.connect(PG_URL)
    cur_pg = conn_pg.cursor()

    # Step 1: Clean reset any previously misassigned order_pdf values to NULL
    logger.info("Resetting order_pdf column in PostgreSQL to clean out non-PO false positives...")
    cur_pg.execute("UPDATE gmd_gem_ids SET order_pdf = NULL;")
    conn_pg.commit()

    logger.info("Fetching threads from MySQL...")
    cur_mysql.execute("""
        SELECT thread_id, subject, body, attach_names, attach_links, ocr_text
        FROM threads
        WHERE attach_names LIKE '%.pdf%'
          AND (subject REGEXP 'GEMC|GEM/' 
            OR body REGEXP 'GEMC|GEM/' 
            OR attach_names REGEXP 'GEMC|GEM/'
            OR ocr_text REGEXP 'GEMC|GEM/')
    """)
    threads = cur_mysql.fetchall()
    logger.info(f"Loaded {len(threads)} threads from MySQL.")

    updated_po_count = 0
    updated_gems_total = 0
    total_files_inserted = 0

    for thread in threads:
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

        raw_names = [n.strip() for n in attach_names_raw.split(",") if n.strip()]
        raw_links = [l.strip() for l in attach_links_raw.split(",") if l.strip()]

        attachments = []
        for idx, fname in enumerate(raw_names):
            if fname and fname != "[No Attachments]":
                dlink = raw_links[idx] if idx < len(raw_links) and raw_links[idx] != "[No Links]" else ""
                if dlink:
                    ext = fname.split('.')[-1].lower() if '.' in fname else 'pdf'
                    attachments.append({
                        "name": fname,
                        "url": dlink,
                        "type": ext
                    })

        if not attachments:
            continue

        for gid in gem_ids:
            clean_gid = gid.strip().upper()

            # 1. STRICT PO Order PDF Identification
            po_pdf_link = None
            for att in attachments:
                if is_strict_po_order_pdf(att["name"], clean_gid):
                    po_pdf_link = att["url"]
                    break

            # If this thread does NOT have a strict PO PDF, po_pdf_link remains None!
            if po_pdf_link:
                updated_po_count += 1

            drive_link_json = json.dumps(attachments)

            # 2. Update PostgreSQL gmd_gem_ids table
            # Only update order_pdf if we found a genuine PO PDF!
            if po_pdf_link:
                cur_pg.execute("""
                    INSERT INTO gmd_gem_ids (gem_id, order_pdf, drive_link, updated_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (gem_id) DO UPDATE
                    SET order_pdf = EXCLUDED.order_pdf,
                        drive_link = EXCLUDED.drive_link,
                        updated_at = NOW();
                """, (clean_gid, po_pdf_link, drive_link_json))
            else:
                cur_pg.execute("""
                    INSERT INTO gmd_gem_ids (gem_id, drive_link, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (gem_id) DO UPDATE
                    SET drive_link = EXCLUDED.drive_link,
                        updated_at = NOW();
                """, (clean_gid, drive_link_json))

            # 3. Insert each attachment into gmd_gem_files
            for att in attachments:
                cur_pg.execute("""
                    SELECT id FROM gmd_gem_files 
                    WHERE gem_id = %s AND file_name = %s
                    LIMIT 1;
                """, (clean_gid, att["name"]))
                if not cur_pg.fetchone():
                    cur_pg.execute("""
                        INSERT INTO gmd_gem_files (gem_id, file_name, drive_link, file_type, created_at)
                        VALUES (%s, %s, %s, %s, NOW());
                    """, (clean_gid, att["name"], att["url"], att["type"]))
                    total_files_inserted += 1

            updated_gems_total += 1

    conn_pg.commit()
    cur_pg.close()
    conn_pg.close()

    cur_mysql.close()
    conn_mysql.close()

    logger.info("=" * 60)
    logger.info("STRICT PORTAL SYNC COMPLETED")
    logger.info(f"Total GeM Records Evaluated:         {updated_gems_total}")
    logger.info(f"Records with Genuine PO Order PDFs: {updated_po_count}")
    logger.info(f"Total Files in gmd_gem_files:        {total_files_inserted}")
    logger.info("=" * 60)

if __name__ == "__main__":
    sync_all()
