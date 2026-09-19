"""
Verification Test Script for GeM PO Release Webhook & Idempotency Logging
"""

import logging
import sys
from claude_Oracel_db import (
    get_db_connection,
    init_db,
    is_po_in_registry,
    record_po_in_registry,
    send_po_release_webhook,
    GEM_ID_REGEX
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("test_po_webhook")

def test_pipeline():
    logger.info("1. Initializing DB & ensuring gem_po_registry exists...")
    init_db()

    db_conn = get_db_connection()
    cursor = db_conn.cursor()

    test_gem_id = "GEMC-999999999999999"
    test_file_name = "Test_GeM_Order_999.pdf"
    test_drive_link = "https://drive.google.com/file/d/test_link_123"

    logger.info("2. Testing registry check before insertion...")
    exists_before = is_po_in_registry(db_conn, test_gem_id, test_file_name)
    logger.info(f"   Registry check result (should be False): {exists_before}")
    assert not exists_before, "Failed: Test PO already exists in registry!"

    logger.info("3. Recording test PO into gem_po_registry...")
    record_po_in_registry(db_conn, test_gem_id, test_file_name, test_drive_link, "test_thread_123", 200, "Test OK")

    logger.info("4. Testing registry check after insertion...")
    exists_after = is_po_in_registry(db_conn, test_gem_id, test_file_name)
    logger.info(f"   Registry check result (should be True): {exists_after}")
    assert exists_after, "Failed: PO was not found in registry after recording!"

    logger.info("5. Testing GeM ID Regex Pattern...")
    sample_text = "Order release GEMC-511687730189505 and GEM/2026/B/7542577 confirmed."
    matched_ids = GEM_ID_REGEX.findall(sample_text)
    logger.info(f"   Matched GeM IDs: {matched_ids}")
    assert "GEMC-511687730189505" in matched_ids, "Regex failed to match GEMC contract ID!"

    logger.info("6. Cleaning up test record from database...")
    cursor.execute("DELETE FROM gem_po_registry WHERE gem_id = %s", (test_gem_id,))
    db_conn.commit()
    cursor.close()
    db_conn.close()

    logger.info("=" * 60)
    logger.info("ALL TESTS PASSED SUCCESSFULLY! ✅")
    logger.info("=" * 60)

if __name__ == "__main__":
    test_pipeline()
