import { expect, type Page } from "@playwright/test";

/**
 * Impersonates a member through the utility bar — the same three dropdowns a
 * reviewer uses. There is no login to script around, which is the whole point
 * of the mock authentication.
 */
export async function actAs(
  page: Page,
  who: { member: string; vessel?: string; role?: "Admin" | "Captain" | "Crew" },
) {
  await page.goto("/");
  await expect(page.getByLabel("Active member")).toBeVisible();

  if (who.vessel) {
    await page.getByLabel("Active vessel").click();
    await page.getByRole("option", { name: who.vessel, exact: true }).click();
  }
  if (who.role) {
    await page.getByLabel("Filter by role").click();
    await page.getByRole("option", { name: who.role, exact: true }).click();
  }

  await page.getByLabel("Active member").click();
  await page.getByRole("option", { name: who.member }).first().click();
  await expect(page.getByLabel("Active member")).toContainText(who.member);
}

/** Selects a vessel in the utility bar once a session is already active. */
export async function selectVessel(page: Page, vessel: string) {
  await page.getByLabel("Active vessel").click();
  await page.getByRole("option", { name: vessel, exact: true }).click();
  await expect(page.getByLabel("Active vessel")).toContainText(vessel);
}

/**
 * The list renders twice — a table for desktop and cards for mobile, one hidden
 * by CSS — so every list locator must say which it means, or Playwright's strict
 * mode rightly objects.
 */
export const workOrderTable = (page: Page) => page.getByRole("table");

export async function openWorkOrder(page: Page, reference: string) {
  await workOrderTable(page).getByRole("link", { name: reference, exact: true }).click();
  // Waiting on an h1 is not enough: the list page has one too, so the assertion
  // passed instantly and the test then examined the wrong page.
  await page.waitForURL(/\/work-orders\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** The status badge in the detail page header, not the one in a list row. */
export const detailStatus = (page: Page) =>
  page.locator("header").filter({ hasText: /^WO-/ }).locator('[data-slot="badge"]');

/** The toast text, whether it reports success or a refusal from the database. */
export function toast(page: Page) {
  return page.locator("[data-sonner-toast]");
}

export async function expectToast(page: Page, pattern: RegExp | string) {
  await expect(toast(page).filter({ hasText: pattern })).toBeVisible();
}

/**
 * Scope to the open dialog rather than reaching for `.last()`.
 *
 * A trigger and its confirm button routinely share a name ("Reject", "Assign",
 * "Reassign"), so ordinal selectors pass or fail depending on render timing —
 * which is exactly how a test becomes flaky rather than wrong.
 */
export function dialog(page: Page) {
  return page.getByRole("dialog");
}

export async function confirmDialog(page: Page, button: string) {
  const d = dialog(page);
  await expect(d).toBeVisible();
  await d.getByRole("button", { name: button, exact: true }).click();
}
