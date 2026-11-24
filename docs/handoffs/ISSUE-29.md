# Issue #29 handoff

Checkpoint dated 2026-11-24. This branch is a handoff for [issue #29](https://github.com/Vanatoa23/Kulgo/issues/29). The approved product decisions are reproduced below. The feature code lives on the linked pull requests.

## Code and review status

| Work | GitHub state | Verified checkpoint and next action |
| --- | --- | --- |
| Baseline privacy-test repair | [PR #75](https://github.com/Vanatoa23/Kulgo/pull/75) merged | Main `5aaef134d142bb59372893abadc46d9688b73ad8`, all four main CI jobs passed. |
| Private name-only supplier and buyer declarations API | [PR #76](https://github.com/Vanatoa23/Kulgo/pull/76) merged | Main `82908f8c3b81f47d8cbf77b2f30a145f1cc1b1d8`. Mistral high, Neon medium, independent privacy validation and [four main CI jobs](https://github.com/Vanatoa23/Kulgo/actions/runs/45468128374) passed. |
| Estonian registry search | [PR #77](https://github.com/Vanatoa23/Kulgo/pull/77), draft `feat/29-estonia-registry-search` | Published head `16c47d0a30066a8d217f001108f75ef6cc30ca85`. Mistral high approved after two rejections. All [four CI jobs](https://github.com/Vanatoa23/Kulgo/actions/runs/45478589262) passed. PM also ran 19 registry and 29 privacy tests and separately matched a public company record on the official snapshot. **Neon medium final review is running.** Read its report, then independently validate this exact commit and merge only when gates pass. |
| Network Hub supplier and buyer form | [PR #78](https://github.com/Vanatoa23/Kulgo/pull/78), draft `feat/29-company-onboarding-ui` | Last reviewed published head `3d1d9dc715861738a5f8a59c108040d44960496d`. [CI passed](https://github.com/Vanatoa23/Kulgo/actions/runs/45475987244), but Mistral reproduced a blocking UI race. Two implementations have been returned. **Mistral TASK-030-R2 is fixing it and will push the same branch.** Read the new report and review the latest exact head. |

The #77 corrections reduced valid registry requests to one session lookup and propagated 401 responses for anonymous or invalid sessions in standalone mounts. These are covered by regressions. #77 reads a local copy of the official Estonian basic-data snapshot, searches it without sending tenants’ search terms outside Kulgo, and distinguishes a conclusive match, options, no result, unsupported country, and unavailable data. Registry choice and persistence, contact enrichment, and outreach are later slices.

The first #78 code showed and saved a name-only entry, but a pre-save list request could erase the new row from the display. The first correction kept the new row and restored keyboard focus, but dropped the entire late list response. Signing back into a workspace with an existing company, holding the GET, and saving a second company reproduces the failure. The old company appears only after reload, even when the delayed server response contains both entries. The fix needs to show both company records without reload, without duplicates, while guarding stale sessions. Keep usable rows visible on a list error and preserve recovery. The server writes persisted in every probe.

## Resume the active workers

The scoped connector currently runs Neon final review of #77 and Mistral implementation of the #78 follow-up. Let them finish in their own slots. Read these workspace reports if the original workspace is available.

- `workers/review/outbox/REVIEW-77.md` for the pending Neon verdict. The Mistral approval is Round 3 in `workers/mistral-review/outbox/REVIEW-77.md`.
- `workers/w2/outbox/REPORT-TASK-030-R2.md` for the form fix and new SHA. Round 2 in `workers/mistral-review/outbox/REVIEW-78.md` describes the blocking race.
- `workers/validate/inbox/VALIDATE-77.md` holds the prepared exact-head validation. Start it after Neon approves.
- `pm/STATUS.md` and `pm/LEDGER.md` hold local context. Scoped workers hand off via outbox files. PM owns merge decisions.

Check GitHub for the latest head before every review and merge. Mistral implements, independent Mistral reviews, and Gemini 4 Neon medium performs final review through Antigravity. After three rejected code submissions on a task, Gemini 4 Hydrogen high takes over implementation. Provider and environment errors do not count. Each draft is currently at two rejections. Retain independent privacy validation on sensitive work and green CI at the reviewed head. The PM marks the draft ready and uses a merge commit with the expected head SHA. Verify merged `main` and its CI. Keep references as `Refs #29` until the whole issue is delivered.

## Remaining delivery

1. Finish and merge #77 and #78 through the gates above.
2. Handle unknown product data in supply lanes, map views, forms, CSV/JSON, and calculations. Existing lane schemas require a category and group some unlinked lanes by category. Preserve known categories and adequate network results, and avoid grouping unrelated unknowns. Add Excel and CSV company onboarding under the same minimal rules. The workspace has TASK-032 prepared for supply lanes.
3. Connect registry results to declarations. Persist the entered name separately from verified public identity, apply only conclusive matches automatically, support candidate choice and **None of these**, and allow adding or correcting missing contact email. TASK-033 is prepared.
4. Implement invitation scheduling and cancellation, Tallinn calendar-year deduplication, cross-sender opt-out, and safe eligibility checks. Continue with explicit external confirmation without signup, verified membership claims, in-app confirmation and one seven-day reminder, reciprocal relationships, and facility trust provenance. TASK-034 is prepared for the scheduling slice. Test with a simulated clock and provider. Enable live sends only after regional eligibility and provider readiness are verified.
5. Implement catalogue publishing, eligible selected-product matching and distinct company counts, alternative comparison, What-If preview, and explicit introduction sharing. TASK-035 is prepared for catalogue publication. Verify privacy and both known-zero and unknown-product behavior.
6. Close [issue #29](https://github.com/Vanatoa23/Kulgo/issues/29) only after all agreed acceptance cases are merged and verified.

## Agreed product specs

## Company onboarding and relationship confirmation

Draft for [GitHub issue #29](https://github.com/Vanatoa23/Kulgo/issues/29). This is the first release. A client can add a supplier or buyer by name, build out the network over time, and ask the other company to confirm a declared relationship.

## Add a company and find its registry record

A company name is enough to save a supplier or buyer. Country, registry ID, contact email, sites, products, volume, and spend are optional. The quick form and Excel or CSV import follow the same rules. The relationship appears in the client's private network as soon as it is saved.

Search the company registry by name using the country when available. Use an optional registry ID to narrow the search. Start with Estonia's business registry. An unambiguous match can be applied automatically. When the evidence is uncertain, show candidates with details that help the client choose, such as country, legal name, and registry ID. **None of these** keeps the client-entered company in their network without a verified registry match.

Use a suitable business contact from the confirmed registry match when available. If the registry provides no usable email or the company has no confirmed match, ask the client for an email. A client-provided address allows outreach where eligible without upgrading the registry match status. A company can exist in the workspace while outreach is waiting for a contact.

## Invite a company outside Kulgo

Start a one-hour timer once the declaration has an eligible email address, either from a confirmed registry match or supplied by the client. Show the pending invitation, its scheduled send time, and **Cancel invitation**. Cancellation stops that send and preserves the client's network entry. Check recipient eligibility again at send time.

The message identifies the declaring company and the direction of the relationship. It asks the recipient to confirm the declaration and offers the option to join Kulgo. Limit the message to the two parties and the declaration. Keep products, prices, volumes, other partners, and facility details private.

Send at most one invitation email per declaring company and recipient company per calendar year. Use the confirmed registry identity where available and the normalized contact address as the fallback for an unmatched company. Changes to spelling, contact address for a known company, or repeated imports should avoid duplicate sends. Treat supplier and buyer declarations as distinct relationships under the same email limit. If the limit prevents a new email, the private declaration stays unconfirmed.

Two different companies may each invite the same company in the same year. A new declaration in a later calendar year can trigger another email if the earlier relationship is still unconfirmed, the recipient remains outside Kulgo, and the address is eligible. Include a one-click **Stop Kulgo invitations** option that stops future invitation emails to that address across declaring companies. Send a single external email with no follow-up reminders.

## Confirm or decline a relationship

An email recipient can confirm or decline on a page opened from the invitation, without joining Kulgo. Opening the page leaves the decision pending. An explicit response applies to that declaration and must be safe to repeat.

Existing members receive an in-app request with **Confirm** and **Decline**. Keep one pending request per relationship and send one in-app reminder after seven days if it is still pending. Declining closes the request and stops its reminder. The original company keeps its unverified entry.

Confirmation marks the original declaration as confirmed. For an existing member, it also adds the reciprocal relationship to their own map without requiring additional details. If there is no location, keep it visible in the map's network list until the member supplies one. A non-member's confirmation is available to their organization when it joins and proves that it is the intended recipient. Registry matching, relationship confirmation, and facility verification are distinct facts.

The recipient can add local product, volume, and facility details later. Each workspace shows only its own operational details and the confirmed relationship. Shared analytics continue to follow Kulgo's [privacy contract](https://github.com/Vanatoa23/Kulgo/blob/main/docs/PRIVACY_CONTRACT.md).

## Record facilities and product information

Track the source of each site detail. Rank sources from highest to lowest trust.

1. Supplier-provided information.
2. Buyer-declared information.
3. Public web or internal information.
4. Estimates.

Show missing details as unknown. Apply the same ranking to factories, warehouses, and other sites. Choosing a specific supplying site is optional at confirmation and can be done later.

Reuse the existing supply lane, product, and commercial fields when the client adds more detail. Keep a declared relationship usable without a product, volume, or price. If the exact product is missing, show **Product unknown** and retain any material category the client did provide. Support the same missing state in the map, forms, CSV and JSON import and export, and reports. Saving and re-importing this state preserves the missing product.

With enough location or activity data, keep the eligible map, alerts, network risk, and ESG results available. Label estimates and show coverage gaps. Exclude unknown product records from named product calculations and avoid grouping unrelated unknowns as one material. Where a calculation lacks adequate inputs, show the result as unavailable. Adding product, volume, or other activity data enables the applicable features and improves estimates where the model supports it. [Existing financial risk methodology](https://github.com/Vanatoa23/Kulgo/blob/main/docs/research/FINANCIAL_RISK_METHODOLOGY.md) · [Existing ESG methodology](https://github.com/Vanatoa23/Kulgo/blob/main/docs/research/ESG_FACTOR_MATRIX_AND_COMPLIANCE.md)

## Acceptance examples

- A client selects **None of these** in registry results and later adds an email. The original company stays in their network and the one-hour clock starts when the address is eligible. Canceling leaves the entry in place.
- A and B both add C in 2026. C can receive one invitation from each. Adding C again from B in 2026 produces no additional email. A new declaration from B in 2027 may send if the conditions still hold. An opt-out takes precedence over a new year.
- C confirms through the invitation without creating an account. B sees the confirmation. If C later joins and verifies its identity, the confirmed relationship appears in C's workspace. A signed-in member who confirms sees the reciprocal relationship immediately.
- A business adds a lane with no product. The map shows **Product unknown**, imports and exports preserve the missing field, and a usable network-level estimate carries its coverage or confidence label. A category or product added later restores only the features supported by that data.

## Draft defaults

Use Tallinn time to determine the calendar year. Deliver the initial in-app request when the declaration is saved. If the recipient joins before the scheduled email, send the in-app request instead. Check registry source terms and outbound email eligibility for each launch region before enabling live sends.


## Product catalogues and supplier alternatives

Draft for [GitHub issue #29](https://github.com/Vanatoa23/Kulgo/issues/29). This is the release after [company onboarding and relationship confirmation](#company-onboarding-and-relationship-confirmation). Companies can publish a catalogue and price ranges so a signed-in buyer looking at a matching product can find alternatives.

## Publish offers

A company chooses which items to publish. Each offer identifies the product, its standardized category, and the unit used for sale. A published price range includes the low and high prices, currency, and unit. A company can leave the range blank and publish the item as **Price on request**. Optional product details can include specifications, lead time, minimum order quantity, and certifications. Catalogue details come from the publishing company.

Show offers and price ranges only to signed-in users looking at a matching product. Enforce visibility for search results, counts, offer details, and direct links. Show the supplier's approved catalogue and profile fields while keeping its customers, contracts, and private network details out of the offer. Publishing an offer is independent of confirming a relationship. [Directory privacy contract](https://github.com/Vanatoa23/Kulgo/blob/main/docs/PRIVACY_CONTRACT.md)

## Find alternatives for a selected product

On a supplier node, use the product selected from its recorded supply lanes. If several products are available, let the user choose one and refresh the alternatives for that product. Use the saved product identity and standardized category when matching, and check unit compatibility where it affects whether an offer can meet the need.

**See alternatives (x)** counts distinct eligible companies with at least one published match for the selected product. Count each company once, even if it has several offers. Exclude the current supplier and the viewing company. Use the same eligibility rules for the count and the list.

For **Product unknown**, show that product information is needed for alternatives. Show **0** only when a known, selected product has no eligible matches. Adding the product enables matching without requiring price, volume, or margin. When only a broad category is known, preserve the category and ask for a product before showing a product-specific count.

## Compare offers

Show the matching product, supplier, and published price range with its unit and currency. Keep ranges as published so buyers can see the basis for comparison. Clear or refresh a result when the supplier unpublishes the item or the buyer changes the selected product.

The existing issue also proposes a What-If preview and a request for an introduction. The preview can use the buyer's existing lane data when sufficient and show missing inputs otherwise. The introduction uses details the buyer explicitly chooses to share. [Original comparison and simulator scope](https://github.com/Vanatoa23/Kulgo/issues/29)

## Acceptance examples

- A node handles aluminium extrusions and circuit boards. Selecting aluminium counts only aluminium matches. Two matching offers from one supplier count as one alternative. Switching products updates the count and list.
- A buyer has recorded a supplier without a product. The node stays usable and matching is unavailable. Adding a product enables matching. A known product with no offers shows zero.
- A signed-in buyer looking at a matching product can see the published range. Anonymous visitors and signed-in viewers without that match cannot retrieve the offer or its price range. Unpublishing an offer removes it from results and counts.

## Draft defaults

Allow publication without a price range. Confirm the initial product taxonomy and matching rules with representative catalogue examples before enabling matching.

