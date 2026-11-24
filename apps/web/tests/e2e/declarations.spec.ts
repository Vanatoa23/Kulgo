import { expect, test, type Page } from "@playwright/test";

async function registerWorkspace(
  page: Page,
  email: string,
  orgName: string,
): Promise<void> {
  await page.goto("/");
  await page.getByRole("tab", { name: "Create Workspace" }).click();
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("DeclarationsE2E2026!");
  await page.locator("#auth-org-name").fill(orgName);
  await page.locator("#auth-country").fill("EE");
  await page.locator("#auth-sector").fill("Electronics");
  await page
    .getByRole("button", { name: "Create Private Workspace" })
    .click();
  await expect(page.getByText(orgName)).toBeVisible({ timeout: 15_000 });
}

test.describe("Issue #29 — private company declarations in the Network Hub", () => {
  test("name-only buyer save is listed with Product unknown / Unconfirmed and survives reload", async ({
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await registerWorkspace(
      page,
      `decl-save-${suffix}@estonia-mfg.ee`,
      "Estonia Decl Save OU",
    );

    const section = page.getByTestId("company-declarations-section");
    await expect(section.getByTestId("declarations-empty")).toBeVisible({
      timeout: 15_000,
    });

    // Name-only save: only the company name and the relationship direction.
    await section.getByRole("button", { name: "Add company" }).click();
    await section.getByLabel("Company name").fill("Nordic Alloys Oy");
    await section.getByLabel("Buyer", { exact: true }).check();
    await section.getByRole("button", { name: "Save company" }).click();

    // Visible result: listed as a Buyer with plain unconfirmed wording and
    // Product unknown, and the AJAX result is announced via role="status".
    await expect(section.getByRole("status")).toContainText(
      "Saved Nordic Alloys Oy as buyer",
      { timeout: 10_000 },
    );
    const item = section.getByTestId(/^declaration-item-/).first();
    await expect(item).toBeVisible({ timeout: 10_000 });
    await expect(item).toContainText("Nordic Alloys Oy");
    await expect(item).toContainText("Buyer");
    await expect(item).toContainText("Unconfirmed");
    await expect(item).toContainText("Product unknown");

    // The saved declaration is served by the list endpoint after a reload.
    await page.reload();
    await expect(page.getByText("Estonia Decl Save OU")).toBeVisible({
      timeout: 15_000,
    });
    const reloadedItem = section.getByTestId(/^declaration-item-/).first();
    await expect(reloadedItem).toContainText("Nordic Alloys Oy", {
      timeout: 15_000,
    });
    await expect(reloadedItem).toContainText("Buyer");
    await expect(reloadedItem).toContainText("Unconfirmed");
    await expect(reloadedItem).toContainText("Product unknown");
  });

  test("preserves the form draft when the declaration save request fails", async ({
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await registerWorkspace(
      page,
      `decl-draft-${suffix}@estonia-mfg.ee`,
      "Estonia Decl Draft OU",
    );

    const section = page.getByTestId("company-declarations-section");
    await expect(section.getByTestId("declarations-empty")).toBeVisible({
      timeout: 15_000,
    });

    await section.getByRole("button", { name: "Add company" }).click();
    await section.getByLabel("Company name").fill("Draft Preserved Supplier AS");
    await section.getByLabel("Supplier", { exact: true }).check();
    await section
      .getByLabel("Contact email (optional)")
      .fill("ops@draft-preserved.example.ee");

    // First POST fails with a server error; the list GET passes through.
    let failedOnce = false;
    await page.route(
      "**/api/v1/workspace/relationship-declarations",
      async (route) => {
        if (route.request().method() === "POST" && !failedOnce) {
          failedOnce = true;
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Simulated declaration save failure" }),
          });
          return;
        }
        await route.continue();
      },
    );

    await section.getByRole("button", { name: "Save company" }).click();

    // Retryable error is announced in the form (role="alert") and the draft
    // is preserved untouched; the form stays open with one submission allowed
    // at a time (button re-enabled once the failed request settles).
    await expect(section.getByRole("alert")).toContainText(
      "Simulated declaration save failure",
      { timeout: 10_000 },
    );
    await expect(section.getByLabel("Company name")).toHaveValue(
      "Draft Preserved Supplier AS",
    );
    await expect(section.getByLabel("Contact email (optional)")).toHaveValue(
      "ops@draft-preserved.example.ee",
    );
    await expect(section.getByLabel("Supplier", { exact: true })).toBeChecked();
    await expect(
      section.getByRole("button", { name: "Save company" }),
    ).toBeEnabled();

    // After the route is removed, the preserved draft saves successfully.
    await page.unroute("**/api/v1/workspace/relationship-declarations");
    await section.getByRole("button", { name: "Save company" }).click();
    const item = section.getByTestId(/^declaration-item-/).first();
    await expect(item).toContainText("Draft Preserved Supplier AS", {
      timeout: 10_000,
    });
    await expect(item).toContainText("Supplier");
    await expect(item).toContainText("ops@draft-preserved.example.ee");
  });

  test("keeps the just-saved company visible when a stale list response resolves after the save", async ({
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // Hold the first declarations list GET (issued right after registration)
    // until the save has completed, then answer it with the pre-save list.
    // The POST passes through to the real API, so the save is persisted.
    let releaseHeldGet: (() => void) | null = null;
    let heldGet = false;
    await page.route(
      "**/api/v1/workspace/relationship-declarations",
      async (route) => {
        if (route.request().method() === "GET" && !heldGet) {
          heldGet = true;
          await new Promise<void>((resolve) => {
            releaseHeldGet = resolve;
          });
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ declarations: [] }),
          });
          return;
        }
        await route.continue();
      },
    );

    await registerWorkspace(
      page,
      `decl-race-${suffix}@estonia-mfg.ee`,
      "Estonia Decl Race OU",
    );

    const section = page.getByTestId("company-declarations-section");
    // The list GET is still held in flight; the form can be opened and saved
    // while it is pending.
    await section.getByRole("button", { name: "Add company" }).click();
    await section.getByLabel("Company name").fill("Stale List Survivor SIA");
    await section.getByRole("button", { name: "Save company" }).click();

    // The save (POST) completes first and the saved row renders.
    const item = section.getByTestId(/^declaration-item-/).first();
    await expect(item).toContainText("Stale List Survivor SIA", {
      timeout: 10_000,
    });
    await expect(item).toContainText("Supplier");
    await expect(item).toContainText("Unconfirmed");

    // Now the stale GET resolves with the pre-save (empty) list: the saved
    // row must stay and the section must not flip back to loading/error.
    const staleGet = page.waitForResponse(
      (resp) =>
        resp.request().method() === "GET" &&
        resp.url().includes("/api/v1/workspace/relationship-declarations"),
    );
    releaseHeldGet?.();
    await staleGet;
    await page.waitForTimeout(500);
    await expect(section.getByTestId(/^declaration-item-/)).toHaveCount(1);
    await expect(item).toContainText("Stale List Survivor SIA");
    await expect(section.getByTestId("declarations-list")).toBeVisible();
    await expect(section.getByTestId("declarations-loading")).toHaveCount(0);
    await expect(section.getByTestId("declarations-error")).toHaveCount(0);

    // Reload: the server-backed list still contains the saved declaration.
    await page.reload();
    await expect(page.getByText("Estonia Decl Race OU")).toBeVisible({
      timeout: 15_000,
    });
    const reloadedItem = section.getByTestId(/^declaration-item-/).first();
    await expect(reloadedItem).toContainText("Stale List Survivor SIA", {
      timeout: 15_000,
    });
  });

  test("restores keyboard focus to Add company when the form closes via cancel and via save", async ({
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await registerWorkspace(
      page,
      `decl-focus-${suffix}@estonia-mfg.ee`,
      "Estonia Decl Focus OU",
    );

    const section = page.getByTestId("company-declarations-section");
    await expect(section.getByTestId("declarations-empty")).toBeVisible({
      timeout: 15_000,
    });
    const addButton = section.getByTestId("add-company-btn");

    // Open the form by keyboard; focus moves into the name field.
    await addButton.focus();
    await page.keyboard.press("Enter");
    await expect(section.getByLabel("Company name")).toBeFocused();

    // Close by keyboard (Cancel): focus returns to the Add company button.
    await section.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await expect(addButton).toBeFocused();

    // Re-open by keyboard and save by keyboard: focus returns again.
    await page.keyboard.press("Enter");
    await expect(section.getByLabel("Company name")).toBeFocused();
    await section.getByLabel("Company name").fill("Keyboard Focus Oy");
    await section.getByRole("button", { name: "Save company" }).focus();
    await page.keyboard.press("Enter");
    await expect(section.getByRole("status")).toContainText(
      "Saved Keyboard Focus Oy",
      { timeout: 10_000 },
    );
    await expect(addButton).toBeFocused();
    const item = section.getByTestId(/^declaration-item-/).first();
    await expect(item).toContainText("Keyboard Focus Oy", { timeout: 10_000 });
  });
});
