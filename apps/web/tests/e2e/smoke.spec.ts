import { expect, test } from "@playwright/test";

test.describe("Kulgo Browser E2E Smoke Suite", () => {
  test("register → demo → Map/Graph → What-If Simulator → Org ESG & CSRD → OWNER Audit Log → MEMBER read-only RBAC", async ({
    page,
  }) => {
    const suffix = Date.now();
    const ownerEmail = `e2e-owner-${suffix}@estonia-mfg.ee`;
    const memberEmail = `e2e-member-${suffix}@estonia-mfg.ee`;
    const memberPassword = "KulgoMemberTest2026!";

    await page.goto("/");

    // 1. Register a new organization workspace
    await page.getByRole("tab", { name: "Create Workspace" }).click();
    await page.locator("#auth-email").fill(ownerEmail);
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

    // 4. Open What-If Simulator drawer and run a scenario simulation
    await page.getByRole("button", { name: "What-If Simulator" }).click();
    const simulatorDialog = page.getByRole("dialog", {
      name: "What-If Supply Chain Simulator",
    });
    await expect(simulatorDialog).toBeVisible();
    await simulatorDialog
      .getByRole("button", { name: "De-risk RED Lanes" })
      .click();
    await expect(simulatorDialog.getByText("Resilience Score")).toBeVisible({
      timeout: 10_000,
    });
    await expect(simulatorDialog.getByText("Transport Scope 3")).toBeVisible();
    await simulatorDialog
      .getByRole("button", { name: "Close What-If Simulator" })
      .click();
    await expect(simulatorDialog).toHaveCount(0);

    // 5. Open Org ESG Settings, verify Team Members, and update Scope 1 & 2
    await page.getByRole("button", { name: "Org ESG" }).click();
    const orgDialog = page.getByRole("dialog", {
      name: /Org ESG, Directory & Team Settings/i,
    });
    await expect(orgDialog).toBeVisible();
    await expect(
      orgDialog.getByRole("heading", { name: "Team Members" }),
    ).toBeVisible();
    await expect(orgDialog.getByText(ownerEmail)).toBeVisible();

    await orgDialog.getByLabel(/Scope 1 Emissions/i).fill("350");
    await orgDialog.getByLabel(/Scope 2 Emissions/i).fill("125");
    await orgDialog.getByRole("button", { name: "Save Org Settings" }).click();

    await expect(
      orgDialog.getByText(/Organization ESG & directory settings saved/i),
    ).toBeVisible();
    await orgDialog
      .getByRole("button", { name: "Close organization settings" })
      .click();
    await expect(orgDialog).toHaveCount(0);

    // 6. Open Import / Export modal and verify CSRD Executive Report preview
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
    await expect(
      importExportDialog.getByText("REPORTED / REPORTED"),
    ).toBeVisible();
    await importExportDialog
      .getByRole("button", { name: /Close/i })
      .first()
      .click();
    await expect(importExportDialog).toHaveCount(0);

    // 7. Re-open Org Settings as OWNER: verify Audit Log entries & add a MEMBER
    await page.getByRole("button", { name: "Org ESG" }).click();
    await expect(orgDialog).toBeVisible();
    await expect(
      orgDialog.getByRole("heading", { name: "Audit Log" }),
    ).toBeVisible();

    const auditList = orgDialog.getByRole("list", {
      name: "Compliance audit events",
    });
    await expect(auditList).toBeVisible({ timeout: 10_000 });
    await expect(auditList.getByText("ORG_PROFILE_UPDATED")).toBeVisible();
    await expect(auditList.getByText("CSRD_REPORT_EXPORTED")).toBeVisible();

    await orgDialog.getByLabel("New member email").fill(memberEmail);
    await orgDialog.getByLabel("New member password").fill(memberPassword);
    await orgDialog.getByLabel("New member role").selectOption("MEMBER");
    await orgDialog.getByRole("button", { name: "Add Member" }).click();

    await expect(
      orgDialog.getByText(`Added ${memberEmail} as MEMBER.`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(auditList.getByText("MEMBER_ADDED")).toBeVisible({
      timeout: 10_000,
    });

    await orgDialog
      .getByRole("button", { name: "Close organization settings" })
      .click();
    await expect(orgDialog).toHaveCount(0);

    // 8. Log out and sign in as the newly added MEMBER
    await page.getByRole("button", { name: "Logout" }).click();
    await expect(
      page.getByRole("button", { name: "Sign In to Workspace" }),
    ).toBeVisible({ timeout: 10_000 });

    await page.locator("#auth-email").fill(memberEmail);
    await page.locator("#auth-password").fill(memberPassword);
    await page.getByRole("button", { name: "Sign In to Workspace" }).click();

    await expect(page.getByText("Estonia Smoke Mfg AS")).toBeVisible({
      timeout: 10_000,
    });

    // 9. Confirm Org Settings shows read-only MEMBER notice, Save is disabled, and Audit Log is hidden
    await page.getByRole("button", { name: "Org ESG" }).click();
    await expect(orgDialog).toBeVisible();
    await expect(
      orgDialog.getByText(/You are signed in as a MEMBER/i),
    ).toBeVisible();
    await expect(
      orgDialog.getByRole("button", { name: "Save Org Settings" }),
    ).toBeDisabled();
    await expect(
      orgDialog.getByRole("heading", { name: "Audit Log" }),
    ).toHaveCount(0);
  });
});

