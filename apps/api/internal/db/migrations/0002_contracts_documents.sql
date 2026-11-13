-- 2026-11-10 requirements: configurable contract monitoring and required documents
-- for validation. Purely additive: no existing column is changed or dropped.

-- Contract monitoring configuration. Scope is explicitly company-wide (exactly one
-- row); there are no per-area or per-project overrides.
CREATE TABLE contract_monitoring_settings (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  reminder_days integer[] NOT NULL CHECK (
    cardinality(reminder_days) BETWEEN 1 AND 5 AND 1 <= ALL (reminder_days) AND 366 >= ALL (reminder_days)),
  updated_by    text REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Same thresholds the prototype hard-coded (D-30 / D-14 / D-7); configurable from now on.
INSERT INTO contract_monitoring_settings (id, reminder_days) VALUES (1, '{30,14,7}');

-- Document types and which transaction types require them. No requirement is
-- seeded: the list of mandatory documents is a business decision (TBC).
CREATE TABLE document_types (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  description text,
  active      boolean NOT NULL DEFAULT true,
  updated_by  text REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- A row means: this document type is mandatory before final validation of that transaction type.
CREATE TABLE document_requirements (
  transaction_type   text NOT NULL CHECK (transaction_type IN ('EMPLOYEE_ENTRY', 'EMPLOYEE_BASIC_EDIT', 'EMPLOYEE_PLACEMENT_CHANGE', 'EMPLOYEE_EXIT')),
  document_type_code text NOT NULL REFERENCES document_types(code),
  updated_by         text REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_type, document_type_code)
);

-- Every uploaded file is one immutable version. The file itself lives in private
-- storage under a server-generated key; only metadata is stored here.
-- Replacing a document adds a new version (PENDING_REVIEW) and marks the previous one
-- superseded; its review decision stays on its own row as history.
CREATE TABLE document_versions (
  id                 text PRIMARY KEY,
  subject_type       text NOT NULL CHECK (subject_type IN ('PERSONNEL_ENTRY', 'CHANGE_REQUEST')),
  subject_id         text NOT NULL,
  transaction_type   text NOT NULL CHECK (transaction_type IN ('EMPLOYEE_ENTRY', 'EMPLOYEE_BASIC_EDIT', 'EMPLOYEE_PLACEMENT_CHANGE', 'EMPLOYEE_EXIT')),
  personnel_id       text NOT NULL REFERENCES personnel(id),
  document_type_code text NOT NULL REFERENCES document_types(code),
  version            integer NOT NULL CHECK (version >= 1),
  storage_key        text NOT NULL UNIQUE,
  original_name      text NOT NULL,
  content_type       text NOT NULL,
  size_bytes         bigint NOT NULL CHECK (size_bytes > 0),
  sha256             text NOT NULL,
  uploaded_by        text NOT NULL REFERENCES users(id),
  uploaded_at        timestamptz NOT NULL,
  review_status      text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (review_status IN ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED')),
  review_note        text,
  reviewed_by        text REFERENCES users(id),
  reviewed_at        timestamptz,
  superseded_at      timestamptz,
  superseded_by      text REFERENCES document_versions(id),
  CHECK (review_status <> 'REJECTED' OR btrim(coalesce(review_note, '')) <> ''),
  CHECK (review_status = 'PENDING_REVIEW' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  UNIQUE (subject_type, subject_id, document_type_code, version)
);
-- Exactly one current (non-superseded) version per subject + document type.
CREATE UNIQUE INDEX document_versions_current ON document_versions (subject_type, subject_id, document_type_code) WHERE superseded_at IS NULL;
CREATE INDEX document_versions_personnel_idx ON document_versions (personnel_id);
CREATE INDEX document_versions_review_idx ON document_versions (review_status) WHERE superseded_at IS NULL;

-- New permissions. Existing role configuration is kept; only the new keys are added
-- (Super Admin: all; Area Support: upload; HR HO: upload + review). Configuration
-- permissions start with Super Admin only and can be granted from Access Settings.
UPDATE role_configs SET permissions = array_cat(permissions, ARRAY['upload_documents', 'review_documents', 'manage_document_requirements', 'manage_contract_monitoring'])
  WHERE role = 'SUPER_ADMIN' AND NOT ('upload_documents' = ANY (permissions));
UPDATE role_configs SET permissions = array_append(permissions, 'upload_documents')
  WHERE role IN ('AREA_SUPPORT', 'HR_HO') AND NOT ('upload_documents' = ANY (permissions));
UPDATE role_configs SET permissions = array_append(permissions, 'review_documents')
  WHERE role = 'HR_HO' AND NOT ('review_documents' = ANY (permissions));
