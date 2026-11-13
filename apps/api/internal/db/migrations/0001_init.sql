-- Gelatik HR initial schema.
-- Business dates use `date` (interpreted in Asia/Jakarta); event times use timestamptz (stored UTC).
-- Identifiers (Personnel ID, NIK, rekening, NPWP, BPJS) are always text.

CREATE TABLE areas (
  id          text PRIMARY KEY,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  name_key    text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id          text PRIMARY KEY,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  name_key    text NOT NULL,
  client_name text NOT NULL CHECK (btrim(client_name) <> ''),
  area_id     text NOT NULL REFERENCES areas(id),
  sub_area    text,
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  start_date  date,
  end_date    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  UNIQUE (area_id, name_key)
);

CREATE TABLE users (
  id            text PRIMARY KEY,
  name          text NOT NULL CHECK (btrim(name) <> ''),
  email         text NOT NULL,
  email_key     text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('AREA_SUPPORT', 'HR_HO', 'OPERATIONS_MANAGER', 'MANAGEMENT', 'SUPER_ADMIN')),
  area_id       text REFERENCES areas(id),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_quotas (
  project_id  text NOT NULL REFERENCES projects(id),
  period      text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  quota       integer NOT NULL CHECK (quota >= 0),
  updated_by  text REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, period)
);

-- Role-level permission and area scope. Resolved on every request, so changes
-- apply to active sessions immediately.
CREATE TABLE role_configs (
  role              text PRIMARY KEY CHECK (role IN ('AREA_SUPPORT', 'HR_HO', 'OPERATIONS_MANAGER', 'MANAGEMENT', 'SUPER_ADMIN')),
  scope             text NOT NULL CHECK (scope IN ('OWN_AREA', 'SELECTED_AREAS', 'ALL_AREAS')),
  selected_area_ids text[] NOT NULL DEFAULT '{}',
  permissions       text[] NOT NULL DEFAULT '{}',
  updated_by        text REFERENCES users(id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE validation_policy (
  transaction_type text PRIMARY KEY CHECK (transaction_type IN ('EMPLOYEE_ENTRY', 'EMPLOYEE_BASIC_EDIT', 'EMPLOYEE_PLACEMENT_CHANGE', 'EMPLOYEE_EXIT')),
  authority        text NOT NULL CHECK (authority IN ('AREA_ADMIN', 'HR_HO', 'BOTH')),
  updated_by       text REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Opaque server-side sessions. Only the SHA-256 of the cookie token is stored.
CREATE TABLE sessions (
  token_hash   bytea PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id),
  csrf_token   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE login_attempts (
  id           bigserial PRIMARY KEY,
  email_key    text NOT NULL,
  ip           text NOT NULL,
  succeeded    boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (email_key, attempted_at);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, attempted_at);

-- Personnel identity plus a projection of the current effective condition.
-- The projection is maintained only by workflow transactions; history lives in
-- employment_periods, placements and career_events.
CREATE TABLE personnel (
  id                  text PRIMARY KEY,
  personnel_id        text NOT NULL CHECK (btrim(personnel_id) <> ''),
  business_key        text NOT NULL UNIQUE,
  name                text NOT NULL CHECK (btrim(name) <> ''),
  national_id         text,
  profile             jsonb NOT NULL DEFAULT '{}'::jsonb,
  area_id             text REFERENCES areas(id),
  sub_area            text,
  project_id          text REFERENCES projects(id),
  position            text,
  employment_status   text NOT NULL CHECK (employment_status IN ('ACTIVE', 'INACTIVE')),
  condition_status    text NOT NULL DEFAULT 'CONFIRMED' CHECK (condition_status IN ('CONFIRMED', 'NEEDS_REVIEW')),
  join_date           date,
  contract_start_date date,
  contract_end_date   date,
  contract_status     text NOT NULL DEFAULT 'NOT_AVAILABLE' CHECK (contract_status IN ('NOT_AVAILABLE', 'DRAFT', 'SIGNED')),
  bpjs_status         text,
  -- Validation status of the entry (identity record) itself.
  record_status       text NOT NULL CHECK (record_status IN ('DRAFT', 'SUBMITTED', 'VALIDATED', 'REVISION_REQUIRED')),
  submitted_at        timestamptz,
  revision_note       text,
  validated_by        text REFERENCES users(id),
  validated_at        timestamptz,
  source              text NOT NULL CHECK (source IN ('MANUAL', 'IMPORT')),
  import_batch_id     text,
  import_fingerprint  text,
  created_by          text NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1
);
CREATE INDEX personnel_area_idx ON personnel (area_id);
CREATE INDEX personnel_project_idx ON personnel (project_id);
CREATE INDEX personnel_national_id_idx ON personnel (national_id);
CREATE INDEX personnel_name_idx ON personnel (lower(name));

CREATE TABLE employment_periods (
  id            text PRIMARY KEY,
  personnel_id  text NOT NULL REFERENCES personnel(id),
  start_date    date,
  end_date      date,
  end_reason    text,
  start_kind    text NOT NULL CHECK (start_kind IN ('ENTRY', 'IMPORT', 'REENTRY')),
  end_ref       text,
  created_by    text NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed        boolean NOT NULL DEFAULT false,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK (closed OR end_date IS NULL)
);
CREATE UNIQUE INDEX employment_periods_one_open ON employment_periods (personnel_id) WHERE NOT closed;

CREATE TABLE placements (
  id             text PRIMARY KEY,
  personnel_id   text NOT NULL REFERENCES personnel(id),
  period_id      text NOT NULL REFERENCES employment_periods(id),
  area_id        text REFERENCES areas(id),
  project_id     text REFERENCES projects(id),
  position       text,
  sub_area       text,
  effective_from date,
  effective_to   date,
  closed         boolean NOT NULL DEFAULT false,
  source         text NOT NULL,
  source_ref     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX placements_one_open ON placements (personnel_id) WHERE NOT closed;

-- Requested changes on an existing personnel record. The proposed values live in
-- payload and never touch the effective projection until validation.
CREATE TABLE change_requests (
  id                   text PRIMARY KEY,
  personnel_id         text NOT NULL REFERENCES personnel(id),
  transaction_type     text NOT NULL CHECK (transaction_type IN ('EMPLOYEE_BASIC_EDIT', 'EMPLOYEE_PLACEMENT_CHANGE', 'EMPLOYEE_EXIT')),
  status               text NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'VALIDATED', 'REVISION_REQUIRED')),
  payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin_area_id       text REFERENCES areas(id),
  target_area_id       text REFERENCES areas(id),
  movement_type        text CHECK (movement_type IN ('PROMOTION', 'MUTATION', 'AREA_CHANGE', 'PROJECT_CHANGE', 'POSITION_CHANGE')),
  effective_date       date,
  exit_date            date,
  exit_reason          text,
  replacement_required boolean,
  base_version         integer NOT NULL,
  base_period_id       text REFERENCES employment_periods(id),
  created_by           text NOT NULL REFERENCES users(id),
  submitted_at         timestamptz,
  revision_note        text,
  validated_by         text REFERENCES users(id),
  validated_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  CHECK (transaction_type <> 'EMPLOYEE_EXIT' OR (exit_date IS NOT NULL AND replacement_required IS NOT NULL)),
  CHECK (transaction_type <> 'EMPLOYEE_PLACEMENT_CHANGE' OR (movement_type IS NOT NULL AND effective_date IS NOT NULL))
);
-- At most one open request per personnel and transaction type (blocks double submit).
CREATE UNIQUE INDEX change_requests_one_open ON change_requests (personnel_id, transaction_type) WHERE status <> 'VALIDATED';
CREATE INDEX change_requests_status_idx ON change_requests (status);

-- Append-only validation decisions for entries and change requests.
CREATE TABLE validation_decisions (
  id               bigserial PRIMARY KEY,
  subject_type     text NOT NULL CHECK (subject_type IN ('PERSONNEL_ENTRY', 'CHANGE_REQUEST')),
  subject_id       text NOT NULL,
  transaction_type text NOT NULL,
  decision         text NOT NULL CHECK (decision IN ('VALIDATED', 'REVISION_REQUIRED')),
  note             text,
  subject_version  integer NOT NULL,
  decided_by       text NOT NULL REFERENCES users(id),
  decided_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, subject_version)
);

-- Career timeline. source_ref is the idempotency key of the business fact that produced it.
CREATE TABLE career_events (
  id                  text PRIMARY KEY,
  personnel_id        text NOT NULL REFERENCES personnel(id),
  movement_type       text NOT NULL CHECK (movement_type IN ('JOIN', 'PROMOTION', 'MUTATION', 'AREA_CHANGE', 'PROJECT_CHANGE', 'POSITION_CHANGE', 'REPLACEMENT', 'EXIT', 'REENTRY', 'OTHER')),
  effective_date      date NOT NULL,
  previous_area_id    text,
  new_area_id         text,
  previous_project_id text,
  new_project_id      text,
  previous_position   text,
  new_position        text,
  notes               text NOT NULL DEFAULT '',
  source              text NOT NULL,
  source_ref          text NOT NULL UNIQUE,
  created_by          text NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX career_events_personnel_idx ON career_events (personnel_id, effective_date);
CREATE INDEX career_events_date_idx ON career_events (effective_date);

CREATE TABLE replacement_needs (
  id                       text PRIMARY KEY,
  exit_request_id          text NOT NULL UNIQUE REFERENCES change_requests(id),
  original_personnel_id    text NOT NULL REFERENCES personnel(id),
  area_id                  text REFERENCES areas(id),
  project_id               text REFERENCES projects(id),
  position                 text,
  exit_date                date NOT NULL,
  replacement_personnel_id text REFERENCES personnel(id),
  replacement_join_date    date,
  previous_need_id         text REFERENCES replacement_needs(id),
  lifecycle_status         text NOT NULL CHECK (lifecycle_status IN ('OPEN', 'MATCHED', 'FULFILLED')),
  sla_status               text CHECK (sla_status IN ('WITHIN_TARGET', 'OVER_TARGET')),
  gap_working_days         integer CHECK (gap_working_days >= 0),
  matched_by               text REFERENCES users(id),
  matched_at               timestamptz,
  fulfilled_by             text REFERENCES users(id),
  fulfilled_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer NOT NULL DEFAULT 1,
  CHECK ((lifecycle_status = 'OPEN') = (replacement_personnel_id IS NULL)),
  CHECK (lifecycle_status <> 'FULFILLED' OR (gap_working_days IS NOT NULL AND sla_status IS NOT NULL AND replacement_join_date IS NOT NULL)),
  CHECK (lifecycle_status = 'FULFILLED' OR sla_status IS NULL)
);
-- A candidate is allocated to at most one matched (not yet fulfilled) need.
CREATE UNIQUE INDEX replacement_needs_one_allocation ON replacement_needs (replacement_personnel_id) WHERE lifecycle_status = 'MATCHED';
CREATE INDEX replacement_needs_area_idx ON replacement_needs (area_id);

CREATE TABLE employee_notes (
  id           text PRIMARY KEY,
  personnel_id text NOT NULL REFERENCES personnel(id),
  notes        text NOT NULL CHECK (btrim(notes) <> ''),
  client_ref   uuid UNIQUE,
  created_by   text NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_notes_personnel_idx ON employee_notes (personnel_id);

CREATE TABLE employee_flags (
  id           text PRIMARY KEY,
  personnel_id text NOT NULL REFERENCES personnel(id),
  status       text NOT NULL CHECK (status IN ('NORMAL', 'REVIEW_REQUIRED', 'FLAGGED')),
  reason       text NOT NULL DEFAULT '',
  notes        text NOT NULL DEFAULT '',
  client_ref   uuid UNIQUE,
  created_by   text NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_flags_personnel_idx ON employee_flags (personnel_id);

-- Import staging. The workbook itself is never stored; only the server-built plan,
-- compressed, bound to its owner, and expiring.
CREATE TABLE import_previews (
  id                 text PRIMARY KEY,
  user_id            text NOT NULL REFERENCES users(id),
  file_name          text NOT NULL,
  file_sha256        text NOT NULL,
  scope_signature    text NOT NULL,
  data_signature     text NOT NULL,
  plan_gz            bytea NOT NULL,
  expires_at         timestamptz NOT NULL,
  committed_batch_id text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_previews_expiry_idx ON import_previews (expires_at);

CREATE TABLE import_batches (
  id          text PRIMARY KEY,
  preview_id  text UNIQUE,
  file_name   text NOT NULL,
  sheet_name  text NOT NULL,
  status      text NOT NULL CHECK (status IN ('COMPLETED', 'COMPLETED_WITH_REVIEW', 'COMPLETED_WITH_WARNINGS', 'COMPLETED_WITH_EXCEPTIONS', 'FAILED')),
  summary     jsonb NOT NULL,
  scope_area_ids text[],
  created_by  text NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_source_records (
  id                    text PRIMARY KEY,
  business_key          text NOT NULL,
  personnel_id          text NOT NULL,
  name                  text NOT NULL,
  batch_id              text NOT NULL REFERENCES import_batches(id),
  file_name             text NOT NULL,
  sheet_name            text NOT NULL,
  row_number            integer NOT NULL,
  raw                   jsonb NOT NULL,
  fields                jsonb NOT NULL,
  structured            jsonb NOT NULL,
  fingerprint           text NOT NULL,
  fingerprint_version   integer NOT NULL,
  warnings              jsonb NOT NULL DEFAULT '[]'::jsonb,
  reconciliation_status text NOT NULL CHECK (reconciliation_status IN ('IDENTICAL', 'LINKED', 'PENDING_REVIEW', 'CONFIRMED')),
  area_id               text REFERENCES areas(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_source_records_key_idx ON import_source_records (business_key);
CREATE INDEX import_source_records_batch_idx ON import_source_records (batch_id);

CREATE TABLE import_exceptions (
  id          text PRIMARY KEY,
  batch_id    text NOT NULL REFERENCES import_batches(id),
  row_number  integer NOT NULL,
  reason      text NOT NULL,
  raw_values  jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_exceptions_batch_idx ON import_exceptions (batch_id);

CREATE TABLE import_review_items (
  id                    text PRIMARY KEY,
  business_key          text NOT NULL,
  personnel_id          text NOT NULL,
  personnel_name        text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('IDENTICAL_DUPLICATE', 'PROFILE_VARIATION', 'PLACEMENT_CHANGE', 'EXIT', 'REENTRY', 'IDENTITY_CONFLICT', 'UNDETERMINED')),
  aspects               text[] NOT NULL DEFAULT '{}',
  area_id               text REFERENCES areas(id),
  record_ids            text[] NOT NULL,
  current_master_fields jsonb,
  diff_fields           text[] NOT NULL DEFAULT '{}',
  dates                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_numbers           integer[] NOT NULL DEFAULT '{}',
  reason                text NOT NULL,
  candidate             jsonb,
  status                text NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'DISMISSED', 'KEPT_PENDING')),
  resolution            jsonb,
  decision_version      integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_review_items_key_idx ON import_review_items (business_key);
CREATE INDEX import_review_items_status_idx ON import_review_items (status);

CREATE TABLE import_review_decisions (
  review_item_id   text NOT NULL REFERENCES import_review_items(id),
  decision_version integer NOT NULL,
  decision         jsonb NOT NULL,
  decided_by       text NOT NULL REFERENCES users(id),
  decided_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_item_id, decision_version)
);

-- Per-recipient in-app notifications. dedupe_key makes emission idempotent.
CREATE TABLE notifications (
  id                text PRIMARY KEY,
  dedupe_key        text NOT NULL UNIQUE,
  recipient_user_id text NOT NULL REFERENCES users(id),
  category          text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('info', 'success', 'warning', 'error')),
  title             text NOT NULL,
  message           text NOT NULL,
  actor_user_id     text REFERENCES users(id),
  entity_type       text NOT NULL,
  entity_id         text,
  area_id           text,
  target            jsonb,
  requires_action   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  read_at           timestamptz,
  archived_at       timestamptz,
  resolved_at       timestamptz
);
CREATE INDEX notifications_recipient_idx ON notifications (recipient_user_id, created_at DESC);

-- Audit trail of important changes. details holds minimal change info; no full profile copies.
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id text REFERENCES users(id),
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text,
  personnel_id  text REFERENCES personnel(id),
  area_id       text,
  request_id    text,
  activity_type text CHECK (activity_type IN ('ENTRY', 'EXIT', 'VALIDATION', 'MATCHING', 'FULFILLMENT')),
  title         text,
  description   text,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_personnel_idx ON audit_log (personnel_id, occurred_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
