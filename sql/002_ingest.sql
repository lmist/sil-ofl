-- 002_ingest.sql — ingest resilience schema (beads epic silofl-qiy)
--
-- ADDITIVE ONLY. Every statement is IF NOT EXISTS; every new column is
-- nullable or defaulted. Applying this changes no existing row and cannot
-- break the read path. Reversible by dropping the added columns and tables.
--
-- Owner: orchestrator. Agents consume this schema; they do not extend it.
-- Extending it is a schema change and therefore an INVARIANTS.md change.

-- Scan bookkeeping and licence evidence -------------------------------------
ALTER TABLE repos
  ADD COLUMN IF NOT EXISTS scan_attempts          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_scan_after        timestamptz,
  ADD COLUMN IF NOT EXISTS license_detected_spdx  text,
  ADD COLUMN IF NOT EXISTS license_evidence_path  text,
  ADD COLUMN IF NOT EXISTS license_detected_at    timestamptz;

COMMENT ON COLUMN repos.scan_attempts         IS 'Consecutive scan attempts since the last success. Reset to 0 on success.';
COMMENT ON COLUMN repos.next_scan_after       IS 'Backoff gate. The queue skips rows until now() >= this value.';
COMMENT ON COLUMN repos.license_detected_spdx IS 'SPDX id recovered by reading licence text, when GitHub reported NULL/NOASSERTION. Never a guess.';
COMMENT ON COLUMN repos.license_evidence_path IS 'Repository path of the file that produced license_detected_spdx.';

-- Tombstones, delivery policy, asset health, metadata provenance -------------
ALTER TABLE font_files
  ADD COLUMN IF NOT EXISTS retired_at       timestamptz,
  ADD COLUMN IF NOT EXISTS retired_reason   text,
  ADD COLUMN IF NOT EXISTS delivery         text,
  ADD COLUMN IF NOT EXISTS delivery_reason  text,
  ADD COLUMN IF NOT EXISTS verified_at      timestamptz,
  ADD COLUMN IF NOT EXISTS verify_status    integer,
  ADD COLUMN IF NOT EXISTS metadata_source  text,
  ADD COLUMN IF NOT EXISTS axes             jsonb;

COMMENT ON COLUMN font_files.retired_at      IS 'Set when a rescan no longer observes this path upstream. Retired rows never appear in the public catalog.';
COMMENT ON COLUMN font_files.delivery        IS 'cdn | raw_fallback | not_renderable — from classifyDelivery in src/ingest/cdn-policy.ts.';
COMMENT ON COLUMN font_files.delivery_reason IS 'Machine-readable reason a row is not CDN-servable. Groupable.';
COMMENT ON COLUMN font_files.verify_status   IS 'HTTP status of the last ranged verification request. NULL means never verified.';
COMMENT ON COLUMN font_files.metadata_source IS 'binary | sibling | filename — provenance of family/weight/style. See src/ingest/font-metadata.ts.';
COMMENT ON COLUMN font_files.axes            IS 'fvar axes as [{tag,min,default,max}] when read from the binary.';

-- Run telemetry --------------------------------------------------------------
ALTER TABLE collection_runs
  ADD COLUMN IF NOT EXISTS kind            text,
  ADD COLUMN IF NOT EXISTS outcome         text,
  ADD COLUMN IF NOT EXISTS repos_queued    integer,
  ADD COLUMN IF NOT EXISTS repos_scanned   integer,
  ADD COLUMN IF NOT EXISTS repos_failed    integer,
  ADD COLUMN IF NOT EXISTS files_added     integer,
  ADD COLUMN IF NOT EXISTS files_retired   integer,
  ADD COLUMN IF NOT EXISTS requests_spent  integer;

COMMENT ON COLUMN collection_runs.kind    IS 'bulk | incremental | rescan | verify | backfill';
COMMENT ON COLUMN collection_runs.outcome IS 'running | completed | failed | aborted. A run with no outcome is a crashed run.';

-- Rollback safety for the URL backfill --------------------------------------
-- The backfill rewrites cdn_url and raw_url in place so the read path benefits
-- immediately. Originals are captured here first, making the migration a
-- single reversible UPDATE ... FROM rather than a one-way door.
CREATE TABLE IF NOT EXISTS font_files_url_backup (
  font_file_id  bigint PRIMARY KEY REFERENCES font_files(id) ON DELETE CASCADE,
  cdn_url       text NOT NULL,
  raw_url       text NOT NULL,
  backed_up_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repos_scan_queue
  ON repos (next_scan_after) WHERE fonts_scanned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_font_files_live
  ON font_files (repo_id) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_font_files_unverified
  ON font_files (verified_at) WHERE retired_at IS NULL;
