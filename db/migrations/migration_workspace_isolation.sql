-- Migration: isolate records per workspace
-- Changes UNIQUE(external_id) → UNIQUE(external_id, workspace_id)
-- so records from different workspaces with the same external_id coexist safely.
-- workspace_id is made NOT NULL (default '') so the composite key works correctly.

DO $$
DECLARE
  tbl TEXT;
  old_con TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'c21_agents','c21_contacts','c21_assets','c21_owners','c21_buyers',
    'c21_transactions','c21_referrals','c21_visits','c21_proposals',
    'c21_documents','c21_awards','c21_workspaces','c21_leads','c21_calendar'
  ] LOOP
    -- Skip if table does not exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
      RAISE NOTICE 'Table % does not exist — skipping', tbl;
      CONTINUE;
    END IF;

    -- Normalise NULL workspace_id to empty string so composite key is deterministic
    EXECUTE format('UPDATE %I SET workspace_id = '''' WHERE workspace_id IS NULL', tbl);

    -- Make workspace_id NOT NULL with default empty string
    EXECUTE format('ALTER TABLE %I ALTER COLUMN workspace_id SET DEFAULT ''''', tbl);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN workspace_id SET NOT NULL', tbl);

    -- Find and drop old single-column unique constraint on external_id (if any)
    SELECT conname INTO old_con
      FROM pg_constraint
     WHERE conrelid = tbl::regclass
       AND contype = 'u'
       AND array_length(conkey, 1) = 1
       AND conkey[1] = (SELECT attnum FROM pg_attribute
                         WHERE attrelid = tbl::regclass AND attname = 'external_id');
    IF old_con IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, old_con);
      RAISE NOTICE 'Dropped % on %', old_con, tbl;
    END IF;

    -- Drop composite constraint if it already exists (idempotent re-run)
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      tbl, tbl || '_external_workspace_uq'
    );

    -- Add composite unique constraint
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (external_id, workspace_id)',
      tbl, tbl || '_external_workspace_uq'
    );

    RAISE NOTICE 'UNIQUE(external_id, workspace_id) set on %', tbl;
  END LOOP;
END $$;
