# Seafair

Vessel-scoped work order management for a marine fleet. Captains raise work orders
against a vessel and assign them to crew; crew document and complete them; captains
attest or reject the completed work. Admins manage the fleet, its people, and who
sails on what — but never the work itself.

## Language

### People and access

**User**:
A person in the system, with exactly one Role and an active/inactive state.
_Avoid_: Account, member record, profile

**Role**:
A User's single, global capability level — `Admin`, `Captain`, or `Crew`. A property
of the person, not of any one posting.
_Avoid_: Permission, user type, access level

**Assignment**:
A link placing a Captain or Crew User aboard a Vessel. Always means the
User-to-Vessel relationship, never the User-to-Work-Order one — see Assignee.
Admins hold no Assignments; their reach is global.
_Avoid_: Posting, membership, crew list entry

**Active Member**:
The User the reviewer is currently impersonating via the utility bar. Determines the
entire UI and every permission for the duration of the session.
_Avoid_: Current user, logged-in user, session user

**Selected Vessel**:
The Vessel currently chosen in the utility bar. Purely a UI filter — it narrows what
the Active Member sees, and never widens what they may access.
_Avoid_: Active vessel, current ship, scope

### Fleet

**Vessel**:
A ship in the fleet, with an active/inactive state. The unit of scoping for both
Assignments and Work Orders.
_Avoid_: Ship, boat, craft, asset

**IMO Number**:
A vessel's permanent seven-digit international registration identifier. Optional, but
unique across the fleet when present.
_Avoid_: Registration number, hull number, vessel code

### Work

**Work Order**:
A unit of maintenance work raised by a Captain against one Vessel and assigned to one
Crew User.
_Avoid_: Ticket, task, job, WO record

**Reference**:
A Work Order's human-facing identifier, such as `WO-000123`. Distinct from its
internal primary key; this is the one people say out loud.
_Avoid_: Work order number, ID, code

**Assignee**:
The single Crew User responsible for carrying out a Work Order. Only Crew may be an
Assignee. Distinct from Assignment, which concerns Vessels.
_Avoid_: Owner, assigned user, responsible party

**Reassignment**:
Moving a Work Order from one Assignee to another. Available to the raising Captain and
to Admins, the latter being the remedy when an Assignee is deactivated.
_Avoid_: Transfer, handover, reallocation

**Status**:
Where a Work Order sits in its lifecycle — strictly `Open`, `In Progress`, or `Done`.
Never carries review state.
_Avoid_: State, stage, phase

**Issue**:
The problem the Work Order exists to solve, written by the Captain at creation.
_Avoid_: Description, problem statement, details

**Solution**:
The account of the work performed, written by the Assignee. Required before a Work
Order may reach `Done`.
_Avoid_: Resolution, fix, notes, remarks

**Attestation**:
A Captain's approval of a `Done` Work Order, closing it. Reserved to Captains; Admins
may not attest. Recorded alongside Status, never as a Status of its own.
_Avoid_: Approval, sign-off, verification, closure

**Rejection**:
A Captain's refusal of a `Done` Work Order, returning it to `In Progress` with a
mandatory reason. A Work Order may be rejected any number of times.
_Avoid_: Denial, bounce-back, reopen

**Closed**:
A Work Order that is `Done` and Attested. The only terminal condition.
_Avoid_: Complete, finished, archived

**Open Work**:
Any Work Order that is not Closed. The predicate every deactivation and unassignment
guard is written against.
_Avoid_: Active work order, outstanding, pending
