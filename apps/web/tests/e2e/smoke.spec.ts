import { expect, test } from "@playwright/test";

test.describe("Kulgo Browser E2E Suite — 4-Page UX Shell (#28) & Reliability (#47)", () => {
  test("4-Page UX flow: Hub 30/70 split → Map [Suppliers|Both|Clients] + Line HUD + Simulator → Dashboard KPIs & Exports → Settings RBAC & Audit Log", async ({
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

    await expect(page.getByText("Estonia Smoke Mfg AS")).toBeVisible({
      timeout: 15_000,
    });

    // 2. Load Estonia Product X Demo on Page 1 (Network Hub)
    await page
      .getByRole("button", { name: "Load Estonia Product X Demo" })
      .first()
      .click();

    await expect(page.getByTestId("hub-column-supplier")).toContainText(
      "Tartu Precision Metalworks",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("hub-column-own")).toContainText(
      "Tallinn HQ & Assembly Plant",
    );
    await expect(page.getByTestId("hub-column-own")).toContainText(
      "Tartu Distribution Warehouse",
    );
    await expect(page.getByTestId("hub-column-client")).toContainText(
      "Helsinki Industrial Systems Oy",
    );

    // 3. Open Tartu Precision Metalworks Inspector Drawer & test 70/30 → 60/40 allocation split
    await page
      .getByRole("button", { name: /Tartu Precision Metalworks/i })
      .click();
    const inspector = page.getByTestId("node-inspector-drawer");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByTestId("allocation-splits-section")).toBeVisible();
    await expect(inspector.getByTestId("split-total-badge")).toContainText(
      "Total: 100%",
    );

    const tallinnSplitInput = inspector.getByLabel(
      /Split percentage for Tallinn HQ/i,
    );
    const tartuSplitInput = inspector.getByLabel(
      /Split percentage for Tartu Distribution Warehouse/i,
    );
    await tallinnSplitInput.fill("60");
    await expect(inspector.getByTestId("split-total-badge")).toContainText(
      "Total: 90%",
    );
    await expect(
      inspector.getByRole("button", { name: "Save Split" }),
    ).toBeDisabled();

    await tartuSplitInput.fill("40");
    await expect(inspector.getByTestId("split-total-badge")).toContainText(
      "Total: 100%",
    );
    await inspector.getByRole("button", { name: "Save Split" }).click();
    await expect(
      inspector.getByText("Destination allocation split updated to 100%."),
    ).toBeVisible({ timeout: 10_000 });

    // 4. Switch to Page 2 — Strategy-Game Supply Map
    await page.getByTestId("nav-map").click();
    await expect(page.getByTestId("map-flow-toggle")).toBeVisible({
      timeout: 10_000,
    });

    // Test [Suppliers | Both | Clients] HUD toggle
    await page.getByTestId("map-flow-clients").click();
    await expect(page.getByLabel("Inspect route on map")).toContainText(
      "Helsinki Industrial Systems Oy",
    );
    await page.getByTestId("map-flow-suppliers").click();
    await expect(page.getByLabel("Inspect route on map")).toContainText(
      "Tartu Precision Metalworks",
    );
    await page.getByTestId("map-flow-both").click();

    // Select a route to open the Click-on-Line Tactical HUD card
    const routeSelect = page.getByLabel("Inspect route on map");
    const firstOptionVal = await routeSelect
      .locator("option")
      .nth(1)
      .getAttribute("value");
    expect(firstOptionVal).toBeTruthy();
    await routeSelect.selectOption(firstOptionVal!);
    await expect(page.getByTestId("map-line-hud-card")).toBeVisible();

    // Toggle Logical Graph and back to Map View
    await page.getByRole("button", { name: "Logical Graph" }).click();
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Map View" }).click();
    await expect(page.locator(".react-flow")).toHaveCount(0);

    // Open What-If Simulator from Map HUD and verify +14d safety stock EAL delta
    await page.getByRole("button", { name: "What-If Simulator" }).click();
    const simulatorDialog = page.getByRole("dialog", {
      name: "What-If Supply Chain Simulator",
    });
    await expect(simulatorDialog).toBeVisible();
    await page.getByTestId("preset-add-14d-stock").click();
    await expect(page.getByTestId("whatif-financial-deltas")).toBeVisible({
      timeout: 10_000,
    });
    await simulatorDialog
      .getByRole("button", { name: "Close What-If Simulator" })
      .click();

    // 5. Switch to Page 3 — Executive Dashboard
    await page.getByTestId("nav-dashboard").click();
    await expect(page.getByTestId("dashboard-kpi-strip")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Resilience Score")).toBeVisible();
    await expect(page.getByText("Expected Annual Loss")).toBeVisible();
    await expect(page.getByText("Total Carbon Footprint")).toBeVisible();

    // Toggle Time View (Current Run-Rate vs Period Window T)
    await page.getByTestId("time-view-period-window").click();
    await page.getByTestId("time-view-run-rate").click();

    // Verify Financial Risk, ESG & Compliance sub-tabs
    await page.getByTestId("dashboard-tab-financial").click();
    await expect(page.getByText("Worst-Case Tail VaR (95%)")).toBeVisible();
    await page.getByTestId("dashboard-tab-esg").click();
    await expect(page.getByText("Scope 3 Cat 1 (Purchased)")).toBeVisible();
    await page.getByTestId("dashboard-tab-compliance").click();
    await expect(
      page.getByText("Regional Compliance Readiness Checklist"),
    ).toBeVisible();

    // Verify Export Reports dropdown (CSV & PDF downloads)
    await page.getByTestId("export-reports-btn").click();
    const csvDownloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /Auditor CSV Ledger/i }).click();
    const csvDownload = await csvDownloadPromise;
    expect(csvDownload.suggestedFilename()).toContain("kulgo-esg-ledger");

    await page.getByTestId("export-reports-btn").click();
    const pdfDownloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /Board \/ Bank-Ready PDF/i }).click();
    const pdfDownload = await pdfDownloadPromise;
    expect(pdfDownload.suggestedFilename()).toContain(".pdf");

    // 6. Switch to Page 4 — Settings (Org ESG, Team RBAC & Audit Log)
    await page.getByTestId("nav-settings").click();
    await page.getByLabel(/Scope 1 Emissions/i).fill("350");
    await page.getByLabel(/Scope 2 Emissions/i).fill("125");
    await page.getByRole("button", { name: "Save Org Settings" }).click();
    await expect(
      page.getByText(/Organization ESG & directory settings saved/i),
    ).toBeVisible({ timeout: 10_000 });

    // Add a MEMBER in Team tab
    await page.getByTestId("settings-tab-team").click();
    await page.getByLabel("New member email").fill(memberEmail);
    await page.getByLabel("New member password").fill(memberPassword);
    await page.getByLabel("New member role").selectOption("MEMBER");
    await page.getByRole("button", { name: "Add Member" }).click();
    await expect(
      page.getByText(`Added ${memberEmail} as MEMBER.`),
    ).toBeVisible({ timeout: 10_000 });

    // Verify Audit Log tab as OWNER
    await page.getByTestId("settings-tab-audit").click();
    const auditList = page.getByRole("list", {
      name: "Compliance audit events",
    });
    await expect(auditList.getByText("ORG_PROFILE_UPDATED")).toBeVisible({
      timeout: 10_000,
    });
    await expect(auditList.getByText("MEMBER_ADDED")).toBeVisible();

    // 7. Log out and sign in as MEMBER -> verify read-only org settings & hidden Audit Log
    await page.getByRole("button", { name: "Logout" }).click();
    await expect(
      page.getByRole("button", { name: "Sign In to Workspace" }),
    ).toBeVisible({ timeout: 10_000 });

    await page.locator("#auth-email").fill(memberEmail);
    await page.locator("#auth-password").fill(memberPassword);
    await page.getByRole("button", { name: "Sign In to Workspace" }).click();
    await expect(
      page.getByText("Estonia Smoke Mfg AS", { exact: true }),
    ).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("nav-settings").click();
    await expect(page.getByTestId("member-readonly-notice")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save Org Settings" }),
    ).toBeDisabled();
    await expect(page.getByTestId("settings-tab-audit")).toHaveCount(0);
  });

  test("Issue #47 regression: preserves form drafts on rejected/network-failed saves and prevents duplicate Base Agreements on contract retry", async ({
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `reg47-${suffix}@estonia-mfg.ee`;

    await page.goto("/");
    await page.getByRole("tab", { name: "Create Workspace" }).click();
    await page.locator("#auth-email").fill(email);
    await page.locator("#auth-password").fill("Regression47Test2026!");
    await page.locator("#auth-org-name").fill("Estonia Reg47 OU");
    await page.locator("#auth-country").fill("EE");
    await page.locator("#auth-sector").fill("Electronics");
    await page
      .getByRole("button", { name: "Create Private Workspace" })
      .click();
    await expect(page.getByText("Estonia Reg47 OU")).toBeVisible({
      timeout: 15_000,
    });

    // Load demo so we have legacy lanes with annualVolume / annualSpendEur
    await page
      .getByRole("button", { name: "Load Estonia Product X Demo" })
      .first()
      .click();
    await expect(page.getByTestId("hub-column-supplier")).toContainText(
      "Riga Baltic Polymers",
      { timeout: 15_000 },
    );

    // --- #47B: Form draft preservation on 400 rejection & network error ---
    await page.getByTestId("add-supplier-btn").click();
    const nameInput = page.getByLabel("SUPPLIER name");
    const sectorInput = page.getByLabel("SUPPLIER sector");
    await nameInput.fill("Resilient Draft Supplier GmbH");
    await sectorInput.fill("Precision Optics");

    let failCount = 0;
    await page.route("**/api/v1/workspace/facilities", async (route) => {
      if (route.request().method() === "POST" && failCount === 0) {
        failCount += 1;
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated server validation error" }),
        });
        return;
      }
      if (route.request().method() === "POST" && failCount === 1) {
        failCount += 1;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    // Attempt 1: 400 rejection -> draft MUST remain intact
    await page
      .getByTestId("hub-column-supplier")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(
      page.getByText("Simulated server validation error"),
    ).toBeVisible();
    await expect(nameInput).toHaveValue("Resilient Draft Supplier GmbH");
    await expect(sectorInput).toHaveValue("Precision Optics");

    // Attempt 2: Network failure -> draft MUST STILL remain intact
    await page
      .getByTestId("hub-column-supplier")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(nameInput).toHaveValue("Resilient Draft Supplier GmbH");
    await expect(sectorInput).toHaveValue("Precision Optics");

    // Attempt 3: Succeeds -> supplier appears in column and form closes
    await page
      .getByTestId("hub-column-supplier")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(page.getByTestId("hub-column-supplier")).toContainText(
      "Resilient Draft Supplier GmbH",
      { timeout: 10_000 },
    );
    await page.unroute("**/api/v1/workspace/facilities");

    // --- #47A: Prevent duplicate Base Agreements on invalid date / failed save + retry ---
    await page.getByTestId("hub-column-supplier").getByRole("button", { name: /Riga Baltic Polymers/i }).click();
    const inspector = page.getByTestId("node-inspector-drawer");
    await expect(inspector).toBeVisible();

    await inspector.getByTestId("add-contract-topup-btn").click();
    const volInput = inspector.getByLabel("Committed volume");
    const spendInput = inspector.getByLabel("Committed spend");
    const startInput = inspector.getByLabel("Contract start date");

    await volInput.fill("25");
    await spendInput.fill("85000");

    // Definitive validation errors permit edits; uncertain outcomes retain the exact
    // request, including after a real commit whose response never reaches the browser.
    const contractRequests: Array<Record<string, unknown>> = [];
    let contractPostFailures = 0;
    let committedContractId = "";
    let committedLineId = "";
    await page.route("**/api/v1/workspace/contracts", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      contractRequests.push(route.request().postDataJSON());
      const attempt = contractPostFailures++;
      if (attempt < 2) {
        await route.fulfill({
          status: attempt === 0 ? 400 : 500,
          contentType: "application/json",
          body: JSON.stringify({ error: attempt === 0
            ? "Simulated contract validation error"
            : "Simulated transient contract failure" }),
        });
        return;
      }
      if (attempt === 4) {
        await route.fulfill({ status: 409, contentType: "application/json",
          body: JSON.stringify({ error: "Idempotency key already belongs to another request" }) });
        return;
      }
      if (attempt === 2) {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        const saved = await response.json();
        committedContractId = saved.contract.contractId;
        committedLineId = saved.lines[0].contractLineId;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await startInput.fill("2026-07-01");
    await inspector.getByRole("button", { name: "Save Contract" }).click();

    await expect(inspector.getByText("Simulated contract validation error")).toBeVisible();
    await expect(volInput).toBeEnabled();
    await volInput.fill("30");
    await inspector.getByRole("button", { name: "Save Contract" }).click();

    // Draft MUST be preserved after an uncertain failure.
    await expect(
      inspector.getByText("Simulated transient contract failure"),
    ).toBeVisible();
    await expect(volInput).toHaveValue("30");
    await expect(spendInput).toHaveValue("85000");

    await expect(volInput).toBeDisabled();
    await expect(inspector.getByLabel("Contract title")).toBeDisabled();
    await inspector.getByRole("button", { name: "Retry Previous Save" }).click();
    // The server committed this retry, but the response was dropped. Refreshing
    // the list alone must not permit editing/resubmitting under a fresh key.
    await expect(inspector.getByRole("button", { name: "Retry Previous Save" })).toBeEnabled();
    await expect(volInput).toBeDisabled();
    await expect(inspector.getByLabel("Contract title")).toBeDisabled();
    const routeToggle = inspector.getByRole("button", { name: /Toggle route Riga Baltic Polymers/ });
    await routeToggle.click();
    await expect(volInput).toHaveCount(0);
    await routeToggle.click();
    await expect(volInput).toHaveValue("30");
    await expect(volInput).toBeDisabled();

    await inspector.getByRole("button", { name: "Close inspector" }).click();
    await page.getByTestId("hub-column-supplier").getByRole("button", { name: /Riga Baltic Polymers/i }).click();
    await expect(volInput).toHaveValue("30");
    await expect(volInput).toBeDisabled();

    await page.getByTestId("nav-dashboard").click();
    await page.getByTestId("nav-hub").click();
    await page.getByTestId("hub-column-supplier").getByRole("button", { name: /Riga Baltic Polymers/i }).click();
    await expect(volInput).toHaveValue("30");
    await expect(volInput).toBeDisabled();
    await expect(spendInput).toHaveValue("85000");

    // Another user can edit the committed records while this client is resolving
    // the original save. Its original replay must still succeed without overwriting edits.
    expect((await page.request.patch(`/api/v1/workspace/contracts/${committedContractId}`, {
      data: { title: "Edited Spot Top-Up" },
    })).status()).toBe(200);
    expect((await page.request.patch(`/api/v1/workspace/contract-lines/${committedLineId}`, {
      data: { committedVolume: 42 },
    })).status()).toBe(200);
    await inspector.getByRole("button", { name: "Retry Previous Save" }).click();
    await expect(
      inspector.getByText("Base Agreement", { exact: true }),
    ).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(
      inspector.getByText("Edited Spot Top-Up", { exact: true }),
    ).toHaveCount(1);
    expect(contractRequests).toHaveLength(4);
    expect(contractRequests[1]).toEqual(contractRequests[2]);
    expect(contractRequests[2]).toEqual(contractRequests[3]);
    expect(contractRequests[0]!.idempotencyKey).not.toBe(contractRequests[1]!.idempotencyKey);
    // A genuine key conflict offers a refresh/review action, rather than an
    // infinite retry loop or an automatic new-key submission.
    await inspector.getByTestId("add-contract-topup-btn").click();
    await volInput.fill("10");
    await inspector.getByRole("button", { name: "Save Contract" }).click();
    await expect(inspector.getByRole("button", { name: "Retry Previous Save" })).toBeDisabled();
    await inspector.getByRole("button", { name: "Review Saved Contracts" }).click();
    await expect(volInput).toHaveCount(0);
    expect(contractRequests).toHaveLength(5);
    await inspector.getByTestId("add-contract-topup-btn").click();
    await expect(volInput).toBeEnabled();
    await expect(volInput).toHaveValue("");
    await expect(inspector.getByText("Edited Spot Top-Up", { exact: true })).toHaveCount(1);
    await page.unroute("**/api/v1/workspace/contracts");
  });
});
