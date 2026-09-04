You are assisting me in building a functional demonstration prototype for an internal HR web application called:

HR Workforce Monitoring System
Client: PT Gelatik Supra
Development Team: Invera

IMPORTANT:
This is a DEMO / requirement-validation prototype, not the final production system.

Do not overengineer.
Do not implement production infrastructure, external APIs, email notifications, BPJS integration, payroll, attendance, AI/ML, or document storage.

I have already initialized the project environment myself.

TECH STACK

Use the existing project stack:

- Laravel
- Inertia.js
- React
- TypeScript
- Tailwind CSS
- SQLite for demo database

Follow the existing project structure and coding conventions.

OBJECTIVE

Build a functional demo that demonstrates this business flow:

Area Input
→ Employee Exit
→ Replacement Need
→ Matching
→ Employee Entry
→ HR HO Validation
→ Fulfillment
→ Working-Day Gap Calculation
→ Dashboard Monitoring

The primary purpose of the demo is to clearly show:

1. Gelatik owns and supplies the employee raw/master data.
2. The system processes employee movement based on the available raw data.
3. Employee replacement must be connected to the correct Area, Project, and Position.
4. HR Head Office validates submitted employee data.
5. Management can monitor turnover and fulfillment through a dashboard.
6. The system cannot infer missing source data. Missing critical data should be visibly flagged.

DO NOT attempt to recreate every field from the existing Excel database.

==================================================
USER ROLES
==================================================

Create three demo roles:

1. AREA_SUPPORT
   Label: Area Supporting / Data Input

   Permissions:
   - view employees from own area
   - create employee entry
   - create employee exit
   - edit records they submitted
   - submit records for HR validation
   - view replacement needs from own area

2. HR_HO
   Label: HR Head Office

   Permissions:
   - view all areas
   - validate submitted records
   - mark record as VALIDATED or REVISION_REQUIRED
   - view all fulfillment records
   - view dashboard

3. MANAGEMENT
   Label: BoD / GM

   Permissions:
   - read-only
   - view dashboard
   - view consolidated employee movement
   - cannot create, edit, or validate records

Use simple demo authentication.

Seed demo users:

bandung@demo.test
role AREA_SUPPORT
area Bandung
password password

hr@demo.test
role HR_HO
password password

management@demo.test
role MANAGEMENT
password password

==================================================
DATA MODEL
==================================================

Create only the minimum entities needed for this demo.

AREA

- id
- name

PROJECT

- id
- name
- client_name
- area_id

EMPLOYEE

- id
- personnel_id
- name
- area_id
- sub_area nullable
- project_id
- position
- employment_status
- join_date nullable
- contract_start_date nullable
- contract_end_date nullable
- contract_status
- bpjs_status nullable
- created_by
- validation_status
- validated_by nullable
- validated_at nullable
- created_at
- updated_at

Suggested employment_status values:

ACTIVE
INACTIVE

Suggested contract_status:

NOT_AVAILABLE
DRAFT
SIGNED

Suggested validation_status:

DRAFT
SUBMITTED
VALIDATED
REVISION_REQUIRED

EMPLOYEE_EXIT

- id
- employee_id
- exit_date
- exit_reason
- replacement_required boolean
- created_by
- validation_status
- validated_by nullable
- validated_at nullable
- created_at
- updated_at

REPLACEMENT_NEED

- id
- employee_exit_id
- area_id
- project_id
- position
- replacement_employee_id nullable
- status
- fulfilled_at nullable
- gap_working_days nullable
- created_at
- updated_at

Replacement status:

OPEN
MATCHED
FULFILLED
OVER_TARGET

==================================================
IMPORTANT BUSINESS LOGIC
==================================================

1. EMPLOYEE EXIT

When a validated employee exit has replacement_required = true:

create a Replacement Need containing:

- same Area
- same Project
- same Position
- original employee exit date

Do not create it before HR validation.

2. MATCHING

Candidates are eligible only when:

candidate.area_id == replacement_need.area_id
AND candidate.project_id == replacement_need.project_id
AND candidate.position == replacement_need.position

For this DEMO treat this as a proposed rule.

Clearly show why an employee is or is not eligible.

Example:

Nanda:
Area Bandung
Project Alpha
Position Sales

Replacement need must not accept:

Andi:
Area Semarang
Project Alpha
Position Sales

Show:
"Area tidak sesuai"

3. CONTRACT

For the demo, a replacement can only be marked FULFILLED when:

employee.validation_status == VALIDATED
AND contract_status == SIGNED

This is a DEMO ASSUMPTION.
Add a small UI note:
"Business rule final terkait kontrak akan dikonfirmasi pada requirement."

4. GAP CALCULATION

Calculate gap using working days Monday-Friday.

Exclude Saturday and Sunday.

For the demo:

gap_working_days =
working days between employee exit date and replacement employee join date.

SLA target:
<= 3 working days = FULFILLED
> 3 working days = OVER_TARGET

Add note:
"Working-day calculation is a demo assumption and subject to final confirmation."

Create a reusable service/helper for this calculation.

5. RAW DATA DEPENDENCY

The UI should clearly flag missing critical employee data.

Critical fields:

- Area
- Project
- Position

If any are missing:

disable replacement matching and display:

"Data sumber belum lengkap. Area, Project, dan Posisi harus dilengkapi oleh pihak pemilik data sebelum proses fulfillment dapat dilakukan."

This is important.

The demo must communicate that source-data quality is Gelatik's responsibility and the application processes the data that is provided.

==================================================
SEED DATA
==================================================

Seed approximately 20-30 employees.

Use fictional names.

Areas:

Bandung
Semarang
Jakarta

Projects:

Project Alpha Bandung
Project Beta Bandung
Project Alpha Semarang
Project Gamma Jakarta

Positions:

Sales
Team Leader
Promotor
Admin

Create demo scenarios.

SCENARIO A - SUCCESS

Employee:
Nanda Pratama
Bandung
Project Alpha Bandung
Sales
exit date Monday

Replacement:
Dony Saputra
Bandung
Project Alpha Bandung
Sales
join date within 2 working days
contract SIGNED
VALIDATED

Expected:
FULFILLED
gap <= 3

SCENARIO B - WRONG AREA

Replacement candidate:
Andi
Semarang
Project Alpha Semarang
Sales

Attempt to match to Nanda replacement need.

Expected:
blocked
reason: Area tidak sesuai

SCENARIO C - OVER SLA

Create an exit in Semarang with replacement join date > 3 working days.

Expected:
OVER_TARGET

SCENARIO D - RAW DATA INCOMPLETE

Create employee with:
area Bandung
project null
position Sales

When exiting employee:
show warning that replacement cannot be processed until Project is provided.

==================================================
PAGES
==================================================

Build these pages only.

1. LOGIN

Simple professional login screen.

After login redirect based on role to Dashboard.

2. DASHBOARD

Dashboard filters:

- Date Range
- Area
- Project

Management/HR can select all areas.
Area Supporting automatically restricted to own area.

KPI cards:

- Active Employees
- Employee Exits
- Replacement Needs
- Fulfilled
- Open
- Over SLA
- Fulfillment Rate
- Average Working-Day Gap

Add simple charts using an existing lightweight chart library only if already available.

If none is available, do not add a new heavy dependency.

Charts/data tables should include:

Turnover by Area
Turnover by Project
Fulfillment by Project
Average Gap by Area

Also create Recent Employee Movement table.

3. MASTER EMPLOYEE

Data table columns:

Personnel ID
Name
Area
Project
Position
Employment Status
Contract Status
Validation Status

Features:

search
area filter
project filter
status filter

Area Supporting only sees own area.

Click employee to open Employee Detail.

4. EMPLOYEE DETAIL

Display grouped information:

Basic
- Personnel ID
- Name

Placement
- Area
- Sub Area
- Client
- Project
- Position

Employment
- Status
- Join Date
- Contract Start
- Contract End
- Contract Status

Other Demo Information
- BPJS status

Movement history section.

Buttons according to permissions:

Edit
Employee Exit

5. EMPLOYEE ENTRY

Create a simplified entry form:

Personnel ID
Name
Area
Project
Position
Join Date
Contract Status
Contract Start Date
Contract End Date
BPJS Status

Area user cannot choose another area.

On save:
status DRAFT.

Provide:
Save Draft
Submit for Validation

6. EMPLOYEE EXIT

Employee is selected from Master Employee.

Auto-populate:

Name
Area
Project
Position

Form fields:

Exit Date
Exit Reason
Replacement Required yes/no

Buttons:
Save Draft
Submit for Validation

7. HR VALIDATION

HR page showing submitted:

Employee Entry
Employee Exit

Columns:

Type
Employee
Area
Project
Submitted By
Submitted Date
Status

Actions:

Validate
Request Revision

When Employee Exit is validated and replacement required:
create Replacement Need.

8. REPLACEMENT / FULFILLMENT

List Replacement Needs.

Columns:

Need ID
Employee Exit
Area
Project
Position
Exit Date
Replacement
Gap
Status

Filter:
Area
Project
Status

Click Replacement Need.

Detail page must show:

Original Employee
Area
Project
Position
Exit Date

Eligible candidates.

For each candidate show:

Name
Area
Project
Position
Contract Status
Validation Status

Show badge:
Eligible
or
Not Eligible

If not eligible show reason.

Matching should require explicit user action.

Do not automatically assign candidates.

==================================================
UI / DESIGN
==================================================

This is not the final UI.

Prioritize:

- clarity
- business workflow
- clean tables
- readable dashboards
- professional corporate appearance

Use:

- left sidebar
- top header
- cards
- badges
- tables
- forms

Responsive desktop-first design.

The demo is primarily presented on laptop.

Avoid:

- excessive animations
- marketing landing pages
- complex design systems
- excessive gradients
- unnecessary modals

Navigation:

Dashboard
Employees
Employee Entry
Validation
Replacement & Fulfillment

Show current role and area in header.

==================================================
DEMO DISCLAIMER
==================================================

Create a small persistent banner or information card:

"Demo Environment — Seluruh data yang ditampilkan merupakan data dummy untuk simulasi requirement dan bukan data aktual PT Gelatik Supra."

On pages related to matching/raw data add:

"System output depends on the completeness and validity of source data."

==================================================
TESTING
==================================================

Add automated tests for at least:

1. Area user cannot access employees from another area.

2. HR user can view all areas.

3. Management cannot edit employees.

4. Validated employee exit with replacement_required creates Replacement Need.

5. Wrong-area candidate cannot be matched.

6. Wrong-project candidate cannot be matched.

7. Wrong-position candidate cannot be matched.

8. Correct area/project/position candidate can be matched.

9. Unsigned contract cannot mark fulfillment complete.

10. Working-day gap calculation excludes Saturday and Sunday.

11. Gap <= 3 is FULFILLED.

12. Gap > 3 is OVER_TARGET.

13. Missing Area/Project/Position prevents fulfillment matching.

==================================================
DELIVERY ORDER
==================================================

Work incrementally.

PHASE 1
Inspect project structure and existing dependencies.
Do not modify anything yet.
Explain the implementation plan briefly.

PHASE 2
Create database migrations, enums/constants, models, relationships, factories, and seeders.

PHASE 3
Implement authorization and role-area restrictions.

PHASE 4
Implement employee master and employee detail.

PHASE 5
Implement employee entry and exit workflows.

PHASE 6
Implement HR validation.

PHASE 7
Implement Replacement Need, matching rules, and gap calculation.

PHASE 8
Implement dashboard metrics and filters.

PHASE 9
Improve demo UI consistency and demo disclaimers.

PHASE 10
Create automated tests and fix failures.

PHASE 11
Provide final documentation:

- how to seed demo
- demo user credentials
- pages/routes
- business rules implemented
- assumptions/TBC items
- recommended demo presentation flow

Before each major destructive change, inspect existing files.

Do not delete or refactor unrelated existing project code.

At the end run all tests and report:

- tests passed
- tests failed
- known limitations
- TBC business rules

START WITH PHASE 1 ONLY.
Do not implement anything until you have inspected the existing codebase and explained the proposed implementation plan.