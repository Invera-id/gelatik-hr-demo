-- Employee documents (Dokumen karyawan): files kept on the personnel record itself, uploadable
-- at any time (also after validation). Requirements for them (transaction type EMPLOYEE_FILE)
-- only produce a warning on the employee; they never gate validation.

ALTER TABLE document_requirements DROP CONSTRAINT document_requirements_transaction_type_check;
ALTER TABLE document_requirements ADD CONSTRAINT document_requirements_transaction_type_check
  CHECK (transaction_type IN ('EMPLOYEE_ENTRY', 'EMPLOYEE_BASIC_EDIT', 'EMPLOYEE_PLACEMENT_CHANGE', 'EMPLOYEE_EXIT', 'EMPLOYEE_FILE'));

ALTER TABLE document_versions DROP CONSTRAINT document_versions_subject_type_check;
ALTER TABLE document_versions ADD CONSTRAINT document_versions_subject_type_check
  CHECK (subject_type IN ('PERSONNEL_ENTRY', 'CHANGE_REQUEST', 'PERSONNEL'));

ALTER TABLE document_versions DROP CONSTRAINT document_versions_transaction_type_check;
ALTER TABLE document_versions ADD CONSTRAINT document_versions_transaction_type_check
  CHECK (transaction_type IN ('EMPLOYEE_ENTRY', 'EMPLOYEE_BASIC_EDIT', 'EMPLOYEE_PLACEMENT_CHANGE', 'EMPLOYEE_EXIT', 'EMPLOYEE_FILE'));
