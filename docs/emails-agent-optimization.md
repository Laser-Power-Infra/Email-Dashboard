# Emails Agent — CPU and Performance Fixes

Changes to `Emails_agent/claude_Oracel_db.py`, `Emails_agent/Dockerfile` and `docker-compose.yml`.

Two passes. Pass 1 stopped the CPU spikes. Pass 2 removed redundant work from the ingest path.

---

## Pass 1 — CPU spikes

**Symptom:** an 8-core host spiked to ~90% CPU roughly every 60 seconds, matching the poll interval.

### 1. Tesseract used every core

**Was bad:** Debian's `tesseract-ocr` is built with OpenMP, so each OCR call fanned out across all
cores. The worker pool was capped at 2 processes, but 2 workers × 8 threads still saturated the box.
Nothing limited the container either.

**Fix:** `ENV OMP_THREAD_LIMIT=1` in the Dockerfile, plus `cpus: 2` on the `emails-agent` service.

**Effect:** OCR concurrency is now actually 2, not 2 × core count. The `cpus` limit is a hard
backstop so no future change can take the host again.

### 2. Failing threads retried forever

**Was bad:** a thread that threw an exception was never written to the database. The agent picks its
work by "thread IDs not already in the database", so the same broken thread came back on every poll —
re-downloading attachments, re-uploading to Drive, re-running OCR, every 60 seconds, forever.

The common trigger: `to_details` and `cc_details` were joined without a limit and written into `TEXT`
columns, which cap at 65535 bytes. A large mailing-list thread raised `Data too long` every time.

**Fix:**
- Cap recipient and attachment strings at `MAX_RECIPIENTS` before the write (the backfill functions
  already did this; the main ingest path did not).
- Track failures per thread ID and stop retrying after 3 attempts.

**Effect:** the root cause is gone, and anything else that throws can no longer become a permanent
CPU drain.

### 3. Dead keyword scan on every email

**Was bad:** `determine_importance` ran about 150 keyword searches across ten categories over a body
of up to 100,000 characters — then threw the result away. The real category comes from
`resolve_company_category`. The `email_categories` table it mirrored is never read by the agent.

**Fix:** deleted the keyword block. Kept the sender-domain check, the attachment check and the
urgency regex pass, which do feed `is_important`.

**Effect:** ~90 lines gone and one large string scan removed per email.

**Note:** the old block also set `is_important = True` for any "high priority" category. That flag is
now driven by sender domain, attachments and the urgency patterns only.

### 4. Full table read every poll

**Was bad:** `load_processed_thread_ids` ran `SELECT DISTINCT thread_id FROM threads` — the entire
table, every 45–60 seconds, growing without limit.

**Fix:** bounded to `date > NOW() - INTERVAL 8 DAY`, matching the 7-day search window. Uses the
existing `idx_date` index.

---

## Pass 2 — Redundant work in the ingest path

### 5. Every message fetched twice

**Was bad, and this was the biggest one:** `get_thread_messages` calls `users.threads.get`, which
returns all of its messages at full content by default — payloads, headers, bodies, labels. The code
then looped over those messages and fetched each one *again* with `users.messages.get(format="full")`.
A 10-message thread cost 11 API calls where 1 was enough.

**Fix:** use the payloads already returned. `format="full"` is now passed explicitly so the behaviour
does not depend on an API default. `get_message_data` was deleted.

**Effect:** Gmail API calls per ingested thread drop from `1 + N` to `1`.

**Bonus fix:** on failure, `get_message_data` returned a fake empty message that passed the validity
check downstream — so a rate-limited message was stored as a blank row that looked like a success.
That silent data loss is gone. A failed thread fetch now skips the thread and retries next poll.

### 6. Drive folder created for every thread

**Was bad:** each thread got a Drive folder lookup and usually a create, even when the thread had no
attachments at all — which is most threads. Two wasted Drive API calls each.

**Fix:** only create the folder when the thread actually has attachments. `drive_folder_id` is
nullable and the blacklist path already wrote `None`, so nothing downstream changed.

### 7. Attachments walked twice

**Was bad:** `get_attachments` recursed the full MIME tree once to collect filenames, then again to
download. Same work, same result, twice per message.

**Fix:** collect the attachment list during the first pass and reuse it. Also dropped the unused
`gmail_service` parameter from `get_attachments`.

### 8. One blocking HTTP call per inserted row

**Was bad:** `upsert_thread` fired a POST to the backend scan endpoint on every insert — 5s timeout
plus a 5s localhost retry — inside the per-thread loop. A 500-row batch meant up to 500 blocking
calls.

**Fix:** `upsert_thread` now returns whether it inserted. The batch counts inserts and fires the scan
trigger once at the end.

**Effect:** up to 500 POSTs per batch becomes 1. The backend still rescans.

### 9. Progress row written per thread

**Was bad:** `update_processing_status` ran a SELECT, an UPDATE and a commit for every single thread.
The batch-end call already writes the final counts.

**Fix:** heartbeat every 50 threads instead. Long batches stay observable; the round-trips mostly go
away.

### 10. Slow PDF parser tried first

**Was bad:** PDF extraction ran pdfplumber, then PyPDF2, then OCR. pdfplumber is the slow one, and
PyPDF2 handles the common case — a PDF with a real text layer — much faster.

**Fix:** reordered to PyPDF2 → pdfplumber → OCR. Both password-protection checks kept. pdfplumber
still runs whenever PyPDF2 finds nothing, so table-heavy PDFs are unaffected.

### 11. No attachment size limit

**Was bad:** a 50MB PDF was downloaded, written to a temp file, and pushed through OCR — usually only
to hit the 60-second worker timeout anyway.

**Fix:** `MAX_EXTRACT_BYTES = 25MB`. Files above it still upload to Drive and stay reachable by link;
only the text extraction is skipped, with a marker stored in place of the text.

---

## Summary of effect

| Metric | Before | After |
| --- | --- | --- |
| Gmail API calls per ingested thread | `1 + N` messages | `1` |
| Drive API calls, thread with no attachments | 2 | 0 |
| Backend POSTs per batch | up to 500 | 1 |
| MySQL round-trips per thread | 3 + 2 commits | 1 + 1 commit |
| OCR threads per worker | all cores | 1 |
| Container CPU ceiling | unlimited | 2 cores |
| MIME tree walks per message | 2 | 1 |
| Attachments sent to OCR | any size | ≤ 25MB |

---

## Known issues, not fixed

These were found during the work and left alone deliberately.

- **Replies on existing threads are never captured.** `run_continuous` filters out every thread ID
  already in the database, so a thread is processed exactly once, ever. This makes the Gmail History
  API skip logic, `load_existing_rows`, and the UPDATE branch of `upsert_thread` all unreachable.
  Fixing it properly means switching to `users.history.list` incremental sync from a stored watermark.
- **Attachment dedup is per-thread only.** The same file appearing in a different thread is
  re-downloaded, re-uploaded and re-OCR'd. A table keyed by SHA-256 would make repeats free.
- **`_shutdown_executor` uses `shutdown(wait=False)`,** which does not terminate a running worker, so
  a hung OCR process survives the pool reset.
- **Threads are processed sequentially.** The work is I/O bound, so a thread pool would cut wall-clock
  time significantly.
- **Secrets are committed** in `docker-compose.yml` (`DB_PASSWORD`). Left in place at the owner's
  request; it should be moved to a `.env` and rotated, since it is already in git history.
