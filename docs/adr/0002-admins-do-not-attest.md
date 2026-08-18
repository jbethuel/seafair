# Admins manage the fleet but take no part in the Work Order lifecycle

Admins may not create, attest, or reject Work Orders. They may reassign one, and they
may edit Assignments; that is the whole of their reach into the work.

Two readings of the assessment were available. Treating Admin as a superuser is the
obvious one, but it quietly voids the deactivation guard we were asked to build: the
requirement to "prevent deactivation when it would leave an active work order without
an authorized owner" has no referent if every Admin is implicitly an authorized owner
of everything. Excluding Admins keeps that rule load-bearing, and matches the closer
reading of the brief, which states that *Captains* review and attest and scopes the
Admin dashboard to Users, Roles, Vessels, and Assignments.

The underlying principle is separation of duties: whoever controls the roster should
not also be signing off the work performed by it.

## Consequences

- Deactivating the last active Captain of a Vessel that has Open Work is blocked, and
  the block is real rather than ceremonial.
- Nothing can become permanently stuck, because Admins retain Reassignment and can
  appoint another Captain.
- A reviewer exploring as an Admin will meet a disabled Attest control. It carries an
  inline explanation, and the README states the reasoning, so the constraint reads as
  deliberate rather than broken.
