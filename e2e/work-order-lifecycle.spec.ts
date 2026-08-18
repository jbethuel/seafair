import { test, expect } from "@playwright/test";
import { createTestFleet, readWorkOrder, readEvents, type TestFleet } from "./helpers/fleet";
import { actAs, openWorkOrder, expectToast, detailStatus, workOrderTable, dialog, confirmDialog } from "./helpers/app";

/**
 * Requirement 3 — Work Order Lifecycle & Data Schema.
 *
 * Drives the whole lifecycle through the interface and then asserts against the
 * database, so a test cannot pass on an optimistic UI that never persisted.
 */
test.describe("Work order lifecycle", () => {
  let fleet: TestFleet;

  test.beforeEach(async () => { fleet = await createTestFleet("Lifecycle"); });
  test.afterEach(async () => { await fleet?.cleanup(); });

  test("a captain raises a work order, and it opens assigned to crew", async ({ page }) => {
    await actAs(page, { member: fleet.captain.name, vessel: fleet.vessel.name });

    await page.getByRole("button", { name: "Raise work order" }).click();
    await dialog(page).getByLabel("Title").fill("Starboard davit seized");
    await dialog(page).getByLabel("Issue")
      .fill("Davit will not slew; suspect the pivot bearing has picked up.");
    await dialog(page).getByLabel("Assign to").click();
    await page.getByRole("option", { name: fleet.crew.name }).click();
    await confirmDialog(page, "Raise work order");

    await expectToast(page, /raised/i);
    const row = workOrderTable(page).getByRole("row", { name: /Starboard davit seized/ });
    await expect(row).toContainText("Open");
    await expect(row).toContainText(fleet.crew.name);
  });

  test("the required fields are all present on the record", async ({ page }) => {
    const wo = await fleet.givenWorkOrder({ title: "Schema check" });
    await actAs(page, { member: fleet.captain.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);

    // Work Order ID, Title, Issue, Solution, Status — all five the brief names.
    await expect(page.locator("header").getByText(wo.reference)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Schema check" })).toBeVisible();
    const cardTitles = page.locator('[data-slot="card-title"]');
    await expect(cardTitles.filter({ hasText: /^Issue$/ })).toBeVisible();
    await expect(cardTitles.filter({ hasText: /^Solution$/ })).toBeVisible();
    await expect(page.getByText("Not documented yet.")).toBeVisible();
    await expect(detailStatus(page)).toHaveText("Open");
  });

  test("crew start work, document a solution, and mark it done", async ({ page }) => {
    const wo = await fleet.givenWorkOrder();
    await actAs(page, { member: fleet.crew.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);

    await page.getByRole("button", { name: "Start work" }).click();
    await expectToast(page, /started/i);
    expect((await readWorkOrder(wo.id)).status).toBe("in_progress");

    await page.getByLabel("Solution").fill("Freed the spindle, repacked the gland, and eased the valve.");
    await page.getByRole("button", { name: "Mark as done" }).click();
    await expectToast(page, /done/i);

    const after = await readWorkOrder(wo.id);
    expect(after.status).toBe("done");
    expect(after.solution).toContain("repacked the gland");
    // Done is not the same as closed: the captain has not attested yet.
    expect(after.attested_at).toBeNull();
    expect(after.is_closed).toBe(false);
  });

  test("crew cannot mark work done without documenting a solution", async ({ page }) => {
    const wo = await fleet.givenWorkOrder();
    await actAs(page, { member: fleet.crew.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);
    await page.getByRole("button", { name: "Start work" }).click();
    await expectToast(page, /started/i);

    await expect(page.getByRole("button", { name: "Mark as done" })).toBeDisabled();
    expect((await readWorkOrder(wo.id)).status).toBe("in_progress");
  });

  test("a captain attests done work, which closes it permanently", async ({ page }) => {
    const wo = await fleet.givenWorkOrder();
    await actAs(page, { member: fleet.crew.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);
    await page.getByRole("button", { name: "Start work" }).click();
    await expectToast(page, /started/i);
    await page.getByLabel("Solution").fill("Replaced the valve seat and pressure tested.");
    await page.getByRole("button", { name: "Mark as done" }).click();
    await expectToast(page, /done/i);

    await actAs(page, { member: fleet.captain.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);
    await expect(detailStatus(page)).toHaveText("Awaiting attestation");
    await page.getByRole("button", { name: "Attest" }).click();
    await expectToast(page, /attested/i);

    const closed = await readWorkOrder(wo.id);
    expect(closed.status).toBe("done");
    expect(closed.attested_by).toBe(fleet.captain.id);
    expect(closed.is_closed).toBe(true);

    await expect(page.getByText(/closed. Attested records are permanent/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Attest" })).toHaveCount(0);
  });

  test("a captain rejects with a reason, and it returns to the crew", async ({ page }) => {
    const wo = await fleet.givenWorkOrder();
    await actAs(page, { member: fleet.crew.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);
    await page.getByRole("button", { name: "Start work" }).click();
    await expectToast(page, /started/i);
    await page.getByLabel("Solution").fill("Tightened the gland nut.");
    await page.getByRole("button", { name: "Mark as done" }).click();
    await expectToast(page, /done/i);

    await actAs(page, { member: fleet.captain.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);
    await page.getByRole("button", { name: "Reject" }).click();

    // The reason is mandatory, and the control says so by staying disabled.
    const confirm = dialog(page).getByRole("button", { name: "Reject", exact: true });
    await expect(confirm).toBeDisabled();

    const reason = "Gland is a stopgap. Renew the packing properly.";
    await dialog(page).getByLabel("Reason").fill(reason);
    await confirm.click();
    await expectToast(page, /sent back/i);

    const after = await readWorkOrder(wo.id);
    expect(after.status).toBe("in_progress");
    expect(after.attested_at).toBeNull();

    const rejection = (await readEvents(wo.id)).find((e) => e.type === "rejected");
    expect(rejection?.comment).toBe(reason);
    await expect(page.getByText(reason)).toBeVisible();
  });

  test("the timeline records every step in order", async ({ page }) => {
    const wo = await fleet.givenWorkOrder();
    await actAs(page, { member: fleet.crew.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);
    await page.getByRole("button", { name: "Start work" }).click();
    await expectToast(page, /started/i);
    await page.getByLabel("Solution").fill("Renewed the packing and tested under pressure.");
    await page.getByRole("button", { name: "Mark as done" }).click();
    await expectToast(page, /done/i);

    await actAs(page, { member: fleet.captain.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);
    await page.getByRole("button", { name: "Attest" }).click();
    await expectToast(page, /attested/i);

    expect((await readEvents(wo.id)).map((e) => e.type))
      .toEqual(["status_changed", "submitted_for_review", "attested"]);

    await expect(page.getByText("started work")).toBeVisible();
    await expect(page.getByText("marked it done")).toBeVisible();
    await expect(page.getByText("attested it")).toBeVisible();
  });

  test("crew see only their own work, not a shipmate's", async ({ page }) => {
    const mine = await fleet.givenWorkOrder({ title: "Mine to fix" });
    await fleet.givenWorkOrder({ title: "Not mine", assignee: fleet.otherCrew.id });

    await actAs(page, { member: fleet.crew.name, vessel: fleet.vessel.name });
    await expect(workOrderTable(page).getByRole("link", { name: mine.reference })).toBeVisible();
    await expect(page.getByText("Not mine")).toHaveCount(0);
    await expect(page.getByText("Showing 1 work order")).toBeVisible();
  });

  test("crew cannot attest their own work", async ({ page }) => {
    const wo = await fleet.givenWorkOrder();
    await actAs(page, { member: fleet.crew.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);
    await page.getByRole("button", { name: "Start work" }).click();
    await expectToast(page, /started/i);
    await page.getByLabel("Solution").fill("Done and tested.");
    await page.getByRole("button", { name: "Mark as done" }).click();
    await expectToast(page, /done/i);

    await expect(page.getByRole("button", { name: "Attest" })).toHaveCount(0);
    await expect(page.getByText(/with the captain for review/i)).toBeVisible();
  });

  test("an admin may not attest, and the control explains why", async ({ page }) => {
    const wo = await fleet.givenWorkOrder();
    await actAs(page, { member: fleet.crew.name, vessel: fleet.vessel.name });
    await openWorkOrder(page, wo.reference);
    await page.getByRole("button", { name: "Start work" }).click();
    await expectToast(page, /started/i);
    await page.getByLabel("Solution").fill("Ready for review.");
    await page.getByRole("button", { name: "Mark as done" }).click();
    await expectToast(page, /done/i);

    await actAs(page, { member: fleet.admin.name, role: "Admin" });
    await page.goto(`/work-orders/${wo.id}`);
    await expect(page.getByText("Attestation is reserved for captains")).toBeVisible();
    await expect(page.getByRole("button", { name: "Attest" })).toHaveCount(0);
    // Reassignment is the one lifecycle verb admins hold.
    await expect(page.getByRole("button", { name: "Reassign" })).toBeVisible();
  });

  test("statuses are strictly Open, In Progress and Done", async ({ page }) => {
    await fleet.givenWorkOrder();
    await actAs(page, { member: fleet.captain.name, vessel: fleet.vessel.name });

    const labels = await page.getByTestId("status-filters").getByRole("button").allInnerTexts();
    const statuses = labels.map((l) => l.split("\n")[0].trim());
    expect(statuses).toEqual(["All", "Open", "In Progress", "Awaiting attestation", "Done"]);
    // "Awaiting attestation" is a review state layered on Done, never a status.
    expect(statuses).not.toContain("Attested");
    expect(statuses).not.toContain("Rejected");
  });
});
