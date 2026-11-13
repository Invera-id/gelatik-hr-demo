-- Employee documents are a single, fixed document: the PKWT (employment contract). Every
-- active employee without an accepted PKWT gets a warning; it never blocks validation.
INSERT INTO document_types (code, name, description, active)
VALUES ('PKWT', 'PKWT (Kontrak Kerja)', 'Perjanjian Kerja Waktu Tertentu milik karyawan.', true)
ON CONFLICT (code) DO UPDATE SET active = true;

INSERT INTO document_requirements (transaction_type, document_type_code)
VALUES ('EMPLOYEE_FILE', 'PKWT')
ON CONFLICT DO NOTHING;
