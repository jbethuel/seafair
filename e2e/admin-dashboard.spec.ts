import { test, expect } from "@playwright/test";
import { createTestFleet, readWorkOrder, emailOf, deleteVesselNamed, type TestFleet } from "./helpers/fleet";
import { actAs, expectToast, dialog, confirmDialog } from "./helpers/app";

/**
 * Requirement 2 — Admin Management Dashboard.
 *
 * Covers user, role, vessel, and assignment management, and in particular the
 * refusals: the brief asks that deactivation be prevented when it would strand
 * work, and those rules live in the database. These tests check the interface
 * surfaces the refusal rather than silently swallowing it.
 */
test.describe("Admin management dashboard", () => {
  let fleet: TestFleet;

  test.beforeEach(async () => { fleet = await createTestFleet("Admiralty"); });
  test.afterEach(async () => { await fleet?.cleanup(); });

  const asAdmin = async (page: import("@playwright/test").Page) =>
    actAs(page, { member: fleet.admin.name, role: "Admin" });

  test("only admins reach the dashboard", async ({ page }) => {
    await actAs(page, { member: fleet.captain.name, vessel: fleet.vessel.name });
    await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Vessels" })).toHaveCount(0);

    // A non-admin is not shown a wall, but returned to the work orders.
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/$/);
    await expectToast(page, /limited to admins/i);

    await asAdmin(page);
    for (const tab of ["Work Orders", "Users", "Vessels", "Assignments"]) {
      await expect(page.getByRole("link", { name: tab })).toBeVisible();
    }
  });

  // --- User management ------------------------------------------------------

  test("an admin creates a user", async ({ page }) => {
    await asAdmin(page);
    await page.getByRole("link", { name: "Users" }).click();
    await page.getByRole("button", { name: "New user" }).click();

    const name = `E2E Newly Hired ${Date.now()}`;
    const email = `newly.${Date.now()}@e2e.test`;
    await dialog(page).getByLabel("Full name").fill(name);
    await dialog(page).getByLabel("Email").fill(email);
    await confirmDialog(page, "Create");

    await expectToast(page, /created/i);
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
  });

  test("required user fields are validated before anything is sent", async ({ page }) => {
    await asAdmin(page);
    await page.goto("/admin/users");
    await page.getByRole("button", { name: "New user" }).click();
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText("A full name is required.")).toBeVisible();
    await expect(page.getByText(/does not look like an email/i)).toBeVisible();
  });

  test("duplicate users are refused, ignoring case", async ({ page }) => {
    await asAdmin(page);
    await page.goto("/admin/users");
    await page.getByRole("button", { name: "New user" }).click();

    // The fleet's captain already holds this address.
    const existing = await emailOf(fleet.captain.id);

    await dialog(page).getByLabel("Full name").fill("Impostor");
    await dialog(page).getByLabel("Email").fill(existing.toUpperCase());
    await confirmDialog(page, "Create");

    await expectToast(page, /already exists|duplicate/i);
  });

  test("deactivation is refused while the crew member holds open work", async ({ page }) => {
    await fleet.givenWorkOrder();
    await asAdmin(page);
    await page.goto("/admin/users");

    const row = page.getByRole("row", { name: new RegExp(fleet.crew.name) });
    await row.getByRole("button", { name: "Deactivate" }).click();

    await expectToast(page, /still has 1 open work order assigned/i);
    await expect(row).toContainText("Active");
  });

  test("deactivation succeeds once the work is reassigned", async ({ page }) => {
    const wo = await fleet.givenWorkOrder();
    await asAdmin(page);

    await page.goto(`/work-orders/${wo.id}`);
    await page.getByRole("button", { name: "Reassign" }).click();
    await dialog(page).getByRole("combobox").click();
    await page.getByRole("option", { name: fleet.otherCrew.name }).click();
    await confirmDialog(page, "Reassign");
    await expectToast(page, /reassigned/i);
    expect((await readWorkOrder(wo.id)).assignee_id).toBe(fleet.otherCrew.id);

    await page.goto("/admin/users");
    const row = page.getByRole("row", { name: new RegExp(fleet.crew.name) });
    await row.getByRole("button", { name: "Deactivate" }).click();
    await expectToast(page, /deactivated/i);
    await expect(row).toContainText("Deactivated");
  });

  test("the last active captain of a busy vessel cannot be deactivated", async ({ page }) => {
    await fleet.givenWorkOrder();
    await asAdmin(page);
    await page.goto("/admin/users");

    // Remove the spare captain first, so the other truly is the last one.
    await page.getByRole("row", { name: new RegExp(fleet.secondCaptain.name) })
      .getByRole("button", { name: "Deactivate" }).click();
    await expectToast(page, /deactivated/i);

    const row = page.getByRole("row", { name: new RegExp(fleet.captain.name) });
    await row.getByRole("button", { name: "Deactivate" }).click();
    await expectToast(page, /only active captain/i);
    await expect(row).toContainText("Active");
  });

  // --- Role management ------------------------------------------------------

  test("an admin changes a role", async ({ page }) => {
    await asAdmin(page);
    await page.goto("/admin/users");

    const row = page.getByRole("row", { name: new RegExp(fleet.otherCrew.name) });
    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: "Captain", exact: true }).click();

    await expectToast(page, /is now Captain/i);
    await expect(row.getByRole("combobox")).toContainText("Captain");
  });

  test("a role change is refused when it would strand open work", async ({ page }) => {
    await fleet.givenWorkOrder();
    await asAdmin(page);
    await page.goto("/admin/users");

    const row = page.getByRole("row", { name: new RegExp(fleet.crew.name) });
    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: "Captain", exact: true }).click();

    await expectToast(page, /still has 1 open work order/i);
    await expect(row.getByRole("combobox")).toContainText("Crew");
  });

  // --- Vessel management ----------------------------------------------------

  test("an admin adds a vessel, and duplicates are refused", async ({ page }) => {
    await asAdmin(page);
    await page.getByRole("link", { name: "Vessels" }).click();

    const name = `E2E Trial Ship ${Date.now()}`;
    await page.getByRole("button", { name: "New vessel" }).click();
    await dialog(page).getByLabel("Name").fill(name);
    await confirmDialog(page, "Add vessel");
    await expectToast(page, /added to the fleet/i);
    await expect(page.getByText(name)).toBeVisible();

    // Same name in a different case is the same vessel.
    await page.getByRole("button", { name: "New vessel" }).click();
    await dialog(page).getByLabel("Name").fill(name.toUpperCase());
    await confirmDialog(page, "Add vessel");
    await expectToast(page, /already exists|duplicate/i);

    await deleteVesselNamed(name);
  });

  test("an IMO number must be seven digits", async ({ page }) => {
    await asAdmin(page);
    await page.goto("/admin/vessels");
    await page.getByRole("button", { name: "New vessel" }).click();
    await dialog(page).getByLabel("Name").fill(`E2E Bad IMO ${Date.now()}`);
    await dialog(page).getByLabel(/IMO number/).fill("12345");
    await confirmDialog(page, "Add vessel");

    await expect(page.getByText("An IMO number is exactly seven digits.")).toBeVisible();
  });

  test("a vessel carrying open work cannot be deactivated", async ({ page }) => {
    await fleet.givenWorkOrder();
    await asAdmin(page);
    await page.goto("/admin/vessels");

    const card = page.getByTestId("vessel-card")
      .filter({ has: page.getByText(fleet.vessel.name, { exact: true }) });
    await card.getByRole("button", { name: "Deactivate" }).click();
    await expectToast(page, /still has open work orders/i);
  });

  // --- Vessel assignment ----------------------------------------------------

  test("an admin assigns someone to a vessel and removes them again", async ({ page }) => {
    await asAdmin(page);
    await page.getByRole("link", { name: "Assignments" }).click();

    const section = page.getByTestId("vessel-assignments")
      .filter({ hasText: fleet.vessel.name });
    await expect(section).toContainText("4 aboard");

    // Someone from outside this fleet.
    await section.getByRole("button", { name: "Assign" }).click();
    await dialog(page).getByRole("combobox").click();
    const candidate = page.getByRole("option").first();
    const candidateName = (await candidate.innerText()).split("\n")[0].trim();
    await candidate.click();
    await confirmDialog(page, "Assign");
    await expectToast(page, /assigned/i);
    await expect(section).toContainText("5 aboard");

    await section.getByRole("listitem").filter({ hasText: candidateName })
      .getByRole("button").click();
    await expectToast(page, /removed from/i);
    await expect(section).toContainText("4 aboard");
  });

  test("removing crew who hold open work aboard that vessel is refused", async ({ page }) => {
    await fleet.givenWorkOrder();
    await asAdmin(page);
    await page.goto("/admin/assignments");

    const section = page.getByTestId("vessel-assignments")
      .filter({ hasText: fleet.vessel.name });
    await section.getByRole("listitem").filter({ hasText: fleet.crew.name })
      .getByRole("button").click();

    await expectToast(page, /still has 1 open work order aboard/i);
    await expect(section).toContainText("4 aboard");
  });
});
