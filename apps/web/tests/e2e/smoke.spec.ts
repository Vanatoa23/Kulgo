import { expect, test } from "@playwright/test";

test.describe("Kulgo Browser E2E Smoke Suite", () => {
  test("register → load Estonia Product X demo → switch Map/Graph → update Org ESG Scope 1/2 → verify CSRD report preview", async ({
    page,
  }) => {
    const uniqueEmail = `e2e-${Date.now()}@estonia-mfg.ee`;

    await page.goto("/");

    // 1. Register a new organization workspace
    await page.getByRole("tab", { name: "Create Workspace" }).click();
    await page.locator("#auth-email").fill(uniqueEmail);
    await page.locator("#auth-password").fill("KulgoSmokeTest2026!");
    await page.locator("#auth-org-name").fill("Estonia Smoke Mfg AS");
    await page.locator("#auth-country").fill("EE");
    await page.locator("#auth-sector").fill("Electronics");
    await page
      .getByRole("button", { name: "Create Private Workspace" })
      .click();

    // Verify authenticated workspace header
    await expect(page.getByText("Estonia Smoke Mfg AS")).toBeVisible();

    // 2. Load Estonia Product X Demo
    await page
      .getByRole("button", { name: "Load Estonia Product X Demo" })
      .click();
    await expect(
      page.getByRole("button", { name: "Product X", exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Resilience:/)).toBeVisible();

    // 3. Switch between Map View and Logical Graph
    await page.getByRole("button", { name: "Logical Graph" }).click();
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Map View" }).click();
    await expect(page.locator(".react-flow")).toHaveCount(0);

    // 4. Open Org ESG Settings, verify Team Members, and update Scope 1 & 2
    await page.getByRole("button", { name: "Org ESG" }).click();
    const orgDialog = page.getByRole("dialog", {
      name: /Org ESG, Directory & Team Settings/i,
    });
    await expect(orgDialog).toBeVisible();
    await expect(
      orgDialog.getByRole("heading", { name: "Team Members" }),
    ).toBeVisible();
    await expect(orgDialog.getByText(uniqueEmail)).toBeVisible();

    await orgDialog
      .getByLabel(/Scope 1 Emissions/i)
      .fill("350");
    await orgDialog
      .getByLabel(/Scope 2 Emissions/i)
      .fill("125");
    await orgDialog.getByRole("button", { name: "Save Org Settings" }).click();

    await expect(
      orgDialog.getByText(/Organization ESG & directory settings saved/i),
    ).toBeVisible();
    await orgDialog
      .getByRole("button", { name: "Close organization settings" })
      .click();
    await expect(orgDialog).toHaveCount(0);

    // 5. Open Import / Export modal and verify CSRD Executive Report preview
    await page.getByRole("button", { name: "Import / Export" }).click();
    const importExportDialog = page.getByRole("dialog", {
      name: /Import, Export & CSRD Report/i,
    });
    await expect(importExportDialog).toBeVisible();

    await importExportDialog
      .getByRole("button", { name: /Export & CSRD Report/i })
      .click();
    await importExportDialog
      .getByRole("button", { name: "Download CSRD Report" })
      .click();

    await expect(
      importExportDialog.getByText("CSRD Executive Summary Preview"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(importExportDialog.getByText("REPORTED / REPORTED")).toBeVisible();
  });
});
