import { expect, test, type Page } from "@playwright/test";

async function registerWorkspace(
  page: Page,
  email: string,
  orgName: string,
  country = "EE",
): Promise<void> {
  await page.goto("/");
  await page.getByRole("tab", { name: "Create Workspace" }).click();
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("Subproject5E2E2026!");
  await page.locator("#auth-org-name").fill(orgName);
  await page.locator("#auth-country").fill(country);
  await page.locator("#auth-sector").fill("Manufacturing");
  await page
    .getByRole("button", { name: "Create Private Workspace" })
    .click();
  await expect(page.getByText(orgName)).toBeVisible({ timeout: 15_000 });
}

test("Sub-Project 5 E2E: supplier catalogue upload → See alternatives (1) → Request Intro → What-If switch preview", async ({
  browser,
}) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const supplierOrgName = `Nordic Optics Supplier ${unique}`;
  const buyerOrgName = `Tallinn Photonics Buyer ${unique}`;

  // 1. Supplier Org opts in & publishes an Optical Components product catalogue item
  const supplierCtx = await browser.newContext();
  const supplierPage = await supplierCtx.newPage();
  await registerWorkspace(
    supplierPage,
    `supplier-${unique}@kulgo.ee`,
    supplierOrgName,
    "FI",
  );

  // Navigate to Settings
  await supplierPage.getByRole("button", { name: /Settings/i }).click();
  await expect(supplierPage.getByTestId("catalogue-section")).toBeVisible({
    timeout: 15_000,
  });

  // Enable "Opt in to Kulgo Alternative Supplier Directory" and save org settings
  const optInCheckbox = supplierPage.getByLabel(
    /Opt in to Kulgo Alternative Supplier Directory/i,
  );
  if (!(await optInCheckbox.isChecked())) {
    await optInCheckbox.check();
  }
  const orgSaveResp = supplierPage.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      r.url().includes("/api/v1/auth/organization") &&
      r.ok(),
  );
  await supplierPage
    .getByRole("button", { name: /Save Org Settings/i })
    .click();
  await orgSaveResp;

  // Add Product Catalogue item for OPTICAL_COMPONENTS (zero seeded overlap → exact count 1)
  const catSection = supplierPage.getByTestId("catalogue-section");
  await catSection.getByLabel(/Standardized Category/i).selectOption("OPTICAL_COMPONENTS");
  await catSection
    .getByLabel(/Product Title/i)
    .fill("Precision Sapphire Optics Lens");
  await catSection.getByLabel(/Lead Time/i).fill("12");
  const createCatResp = supplierPage.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().includes("/api/v1/directory/catalogue") &&
      r.ok(),
  );
  await catSection.getByTestId("catalogue-add-submit").click();
  await createCatResp;

  await expect(
    catSection
      .getByTestId("catalogue-item-row")
      .getByText("Precision Sapphire Optics Lens"),
  ).toBeVisible();
  await supplierCtx.close();

  // 2. Buyer Org creates own HQ + incumbent supplier + Optical Components lane
  const buyerCtx = await browser.newContext();
  const buyerPage = await buyerCtx.newPage();
  await registerWorkspace(
    buyerPage,
    `buyer-${unique}@kulgo.ee`,
    buyerOrgName,
    "EE",
  );

  // Create own facility, incumbent supplier, and lane via authenticated browser fetch
  const setupOk = await buyerPage.evaluate(async () => {
    const post = async (url: string, body: unknown) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    };

    const own = (await post("/api/v1/workspace/facilities", {
      name: "Tallinn Photonics Plant",
      kind: "HQ",
      countryCode: "EE",
      lat: 59.437,
      lng: 24.7536,
      isOwnFacility: true,
      relationshipRole: "OWN",
    })) as { facility: { facilityId: string } };

    const sup = (await post("/api/v1/workspace/facilities", {
      name: "Incumbent Optics Corp",
      kind: "FACTORY",
      countryCode: "DE",
      lat: 52.52,
      lng: 13.405,
      isOwnFacility: false,
      relationshipRole: "SUPPLIER",
      sector: "Optics",
    })) as { facility: { facilityId: string } };

    await post("/api/v1/workspace/lanes", {
      fromFacilityId: sup.facility.facilityId,
      toFacilityId: own.facility.facilityId,
      materialCategory: "Optical Components",
      transportMode: "ROAD",
      volumeSharePct: 100,
      annualVolume: 2000,
      volumeUnit: "UNITS",
    });

    return true;
  });
  expect(setupOk).toBe(true);

  await buyerPage.reload();
  await expect(buyerPage.getByText("Incumbent Optics Corp")).toBeVisible({
    timeout: 15_000,
  });

  // Click the supplier node to open Node Inspector Drawer
  await buyerPage.getByText("Incumbent Optics Corp").first().click();

  // Verify live "See alternatives (1)" badge appears
  const seeAltsBtn = buyerPage.getByTestId("see-alternatives-btn");
  await expect(seeAltsBtn).toHaveText("See alternatives (1)", {
    timeout: 15_000,
  });

  // Open Alternative Suppliers View
  await seeAltsBtn.click();
  const dialog = buyerPage.getByRole("dialog");
  await expect(dialog.getByText(supplierOrgName)).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    dialog.getByText("Precision Sapphire Optics Lens"),
  ).toBeVisible();

  // 1-Click Request Intro / Quote
  await dialog.getByRole("button", { name: "Request Intro / Quote" }).click();
  const introResp = buyerPage.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().includes("/api/v1/directory/request-intro") &&
      r.ok(),
  );
  await dialog.getByRole("button", { name: "Send Intro Request" }).click();
  await introResp;
  await expect(
    dialog.getByText(new RegExp(`Intro .* to ${supplierOrgName}`, "i")),
  ).toBeVisible();

  // 1-Click Test in What-If Simulator
  await dialog
    .getByRole("button", { name: "Test in What-If Simulator" })
    .click();
  await expect(
    buyerPage.getByText(/What-If/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  await buyerCtx.close();
});
