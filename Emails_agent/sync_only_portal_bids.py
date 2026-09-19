"""
Sync ONLY genuine Portal GeM IDs (Clean up all stub bids and extra records)
1. Deletes any record in PostgreSQL gmd_gem_ids & gmd_gem_files that does NOT belong to the portal's ~300 bids.
2. Scans MySQL threads in ONE fast pass for mentions of portal bids.
3. Strictly populates `order_pdf` ONLY for genuine PO files.
4. Populates attachments with real names.
"""

import os
import re
import json
import logging
import requests
import psycopg2
import mysql.connector

from claude_Oracel_db import get_db_connection as get_mysql_connection, GEM_ID_REGEX

PG_URL = os.environ.get("DATABASE_URL", "postgresql://asmita:asmita@192.168.1.190:5432/gmd_gem_ids")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger("sync_only_portal_bids")

def is_strict_po_order_pdf(filename: str, gem_id: str = "") -> bool:
    if not filename:
        return False
    fn = filename.lower().strip()
    if not fn.endswith(('.pdf', '.doc', '.docx')):
        return False

    disqualify_keywords = [
        'gem-bidding', 'gem_bidding', 'bidding', 'bid_doc', 'bid document', 'bid.pdf',
        'tender', 'nit', 'annexure', 'gtp', 'drawing', 'inspection', 'test certificate',
        'tc_', '_tc.', 'bg format', 'emd', 'boq', 'sub-vendor', 'questionnaire',
        'addendum', 'corrigendum', 'commercial evaluation', 'technical evaluation',
        'pre-bid', 'prebid', 'query', 'clarification', 'credential'
    ]
    if any(dk in fn for dk in disqualify_keywords):
        return False

    if re.search(r'gemc?-?[0-9]{14,16}', fn):
        return True

    clean_gid = re.sub(r'[^a-z0-9]', '', (gem_id or '').lower())
    clean_fn = re.sub(r'[^a-z0-9]', '', fn)
    if clean_gid and clean_gid.startswith('gemc') and clean_gid in clean_fn:
        return True

    if re.search(r'\b(purchase[_\s-]?order|work[_\s-]?order|supply[_\s-]?order|order[_\s-]?copy)\b', fn):
        return True
    if re.search(r'(^|[\s_-])po[\s_-]', fn) or fn.startswith('po_') or fn.startswith('po-'):
        return True

    return False

def is_valid_attachment(filename: str) -> bool:
    """Disqualify initial tender/bid documents and email signature images."""
    if not filename:
        return False
    fn = filename.lower().strip()
    disqualify_bids = [
        'gem-bidding', 'gem_bidding', 'bid.pdf', 'bid_doc', 'bid document', 'tender notice'
    ]
    if any(k in fn for k in disqualify_bids):
        return False
    if re.match(r'^image\d+\.(png|jpg|jpeg|gif|bmp)$', fn):
        return False
    if re.match(r'^screenshot \d+.*?\.(png|jpg|jpeg)$', fn):
        return False
    return True

def run_sync():
    logger.info("1. Fetching true Portal Bids from http://192.168.1.190:6012/api/bids...")
    res = requests.get('http://192.168.1.190:6012/api/bids', timeout=30)
    all_bids = res.json().get('bids', [])
    
    # Strictly filter for true portal bids (scraped bids that have bid_details)
    portal_bids_dict = {}
    for b in all_bids:
        b_num = b.get('bid_number', '').strip().upper()
        # Must have bid_details or buyer_details (i.e. real scraped bid)
        if b_num and (b.get('bid_details') or b.get('buyer_details')):
            portal_bids_dict[b_num] = b

    logger.info(f"Identified {len(portal_bids_dict)} REAL portal bids.")

    # 2. Connect to PostgreSQL and delete all extra stub bids
    logger.info("2. Cleaning extra stub bids from PostgreSQL gmd_gem_ids & gmd_gem_files...")
    conn_pg = psycopg2.connect(PG_URL)
    cur_pg = conn_pg.cursor()

    valid_keys = set(portal_bids_dict.keys())
    # Also add variations of valid keys
    all_valid_variations = set()
    for k in valid_keys:
        all_valid_variations.add(k)
        all_valid_variations.add(k.replace('/', '_'))
        all_valid_variations.add(k.replace('_', '/'))
        clean = re.sub(r'[^A-Z0-9]', '', k)
        if clean:
            all_valid_variations.add(clean)

    # Delete any row from gmd_gem_ids that does NOT belong to the portal bids
    cur_pg.execute("SELECT id, gem_id FROM gmd_gem_ids;")
    existing_rows = cur_pg.fetchall()
    deleted_count = 0
    for row_id, gid in existing_rows:
        gid_clean = str(gid).strip().upper()
        if gid_clean not in all_valid_variations and re.sub(r'[^A-Z0-9]', '', gid_clean) not in all_valid_variations:
            cur_pg.execute("DELETE FROM gmd_gem_files WHERE gem_id = %s;", (gid,))
            cur_pg.execute("DELETE FROM gmd_gem_ids WHERE id = %s;", (row_id,))
            deleted_count += 1

    conn_pg.commit()
    logger.info(f"Deleted {deleted_count} extra/stub bids from PostgreSQL. Only portal bids remain.")

    # 3. Fast match against MySQL threads
    logger.info("3. Scanning MySQL threads for matching POs and attachments...")
    portal_clean = {re.sub(r'[^A-Z0-9]', '', b): b for b in portal_bids_dict}

    conn_mysql = get_mysql_connection()
    cur_mysql = conn_mysql.cursor(dictionary=True)

    cur_mysql.execute("""
        SELECT thread_id, subject, body, attach_names, attach_links, ocr_text 
        FROM threads 
        WHERE attach_names LIKE '%.pdf%'
    """)
    threads = cur_mysql.fetchall()
    logger.info(f"Scanning {len(threads)} threads from MySQL...")

    # For each portal bid, track found PO link and attachments
    portal_bid_po = {}
    portal_bid_attachments = {}

    for t in threads:
        subj = t.get('subject') or ''
        body = (t.get('body') or '')[:5000]
        att_names_raw = t.get('attach_names') or ''
        att_links_raw = t.get('attach_links') or ''
        ocr_text = (t.get('ocr_text') or '')[:10000]
        full_text = f"{subj} {body} {att_names_raw} {ocr_text}".upper()
        clean_text = re.sub(r'[^A-Z0-9]', '', full_text)

        # Find which portal bids are mentioned in this thread
        matched_bid_nums = set()
        for ext in GEM_ID_REGEX.findall(full_text):
            ext_clean = re.sub(r'[^A-Z0-9]', '', ext.upper())
            if ext_clean in portal_clean:
                matched_bid_nums.add(portal_clean[ext_clean])

        for p_clean, orig_bid in portal_clean.items():
            if orig_bid in full_text or p_clean in clean_text:
                matched_bid_nums.add(orig_bid)

        if not matched_bid_nums:
            continue

        # Parse attachments
        names = [n.strip() for n in att_names_raw.split(',') if n.strip()]
        links = [l.strip() for l in att_links_raw.split(',') if l.strip()]

        atts = []
        for idx, fn in enumerate(names):
            if fn and fn != '[No Attachments]' and idx < len(links) and links[idx] != '[No Links]':
                ext = fn.split('.')[-1].lower() if '.' in fn else 'pdf'
                atts.append({"name": fn, "url": links[idx], "type": ext})

        if not atts:
            continue

        for b_num in matched_bid_nums:
            # Check for strict PO PDF
            for a in atts:
                if is_strict_po_order_pdf(a["name"], b_num):
                    if b_num not in portal_bid_po:
                        portal_bid_po[b_num] = a["url"]
                    break

            # Collect attachments (strictly valid documents only, excluding bid documents & signatures)
            valid_atts = [a for a in atts if is_valid_attachment(a["name"])]
            if valid_atts:
                if b_num not in portal_bid_attachments:
                    portal_bid_attachments[b_num] = []
                
                existing_urls = set(x['url'] for x in portal_bid_attachments[b_num])
                for a in valid_atts:
                    if a['url'] not in existing_urls:
                        existing_urls.add(a['url'])
                        portal_bid_attachments[b_num].append(a)

    cur_mysql.close()
    conn_mysql.close()

    # 4. Clean up invalid files in PostgreSQL and update records
    logger.info("4. Purging invalid bid PDFs and signature images from PostgreSQL...")
    cur_pg.execute("""
        DELETE FROM gmd_gem_files 
        WHERE LOWER(file_name) LIKE '%gem-bidding%' 
           OR LOWER(file_name) LIKE '%gem_bidding%'
           OR LOWER(file_name) LIKE '%bid.pdf%'
           OR LOWER(file_name) LIKE '%bid_doc%'
           OR LOWER(file_name) LIKE '%bid document%'
           OR LOWER(file_name) LIKE 'image00%.%'
           OR LOWER(file_name) LIKE 'screenshot 20%.%';
    """)

    logger.info("5. Updating PostgreSQL records for portal bids...")
    updated_count = 0
    cleared_count = 0
    for b_num in portal_bids_dict:
        po_link = portal_bid_po.get(b_num, None)
        atts = portal_bid_attachments.get(b_num, [])
        drive_link_json = json.dumps(atts) if atts else None

        if po_link or drive_link_json:
            cur_pg.execute("""
                INSERT INTO gmd_gem_ids (gem_id, order_pdf, drive_link, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (gem_id) DO UPDATE
                SET order_pdf = EXCLUDED.order_pdf,
                    drive_link = EXCLUDED.drive_link,
                    updated_at = NOW();
            """, (b_num, po_link, drive_link_json))

            # Insert attachments into gmd_gem_files
            for a in atts:
                cur_pg.execute("""
                    SELECT id FROM gmd_gem_files WHERE gem_id = %s AND file_name = %s LIMIT 1;
                """, (b_num, a["name"]))
                if not cur_pg.fetchone():
                    cur_pg.execute("""
                        INSERT INTO gmd_gem_files (gem_id, file_name, drive_link, file_type, created_at)
                        VALUES (%s, %s, %s, %s, NOW());
                    """, (b_num, a["name"], a["url"], a["type"]))

            updated_count += 1
        else:
            # Clear any previously set invalid attachments or order_pdf
            cur_pg.execute("""
                UPDATE gmd_gem_ids 
                SET order_pdf = NULL, drive_link = NULL, updated_at = NOW()
                WHERE gem_id = %s;
            """, (b_num,))
            cur_pg.execute("DELETE FROM gmd_gem_files WHERE gem_id = %s;", (b_num,))
            cleared_count += 1

    conn_pg.commit()
    cur_pg.close()
    conn_pg.close()

    logger.info("=" * 60)
    logger.info("SYNC FINISHED")
    logger.info(f"Total True Portal Bids:              {len(portal_bids_dict)}")
    logger.info(f"Deleted Extra/Stub Bids:             {deleted_count}")
    logger.info(f"Portal Bids Updated with Attachments:{updated_count}")
    logger.info(f"Portal Bids with Verified PO Orders: {len(portal_bid_po)}")
    logger.info("=" * 60)

if __name__ == "__main__":
    run_sync()
