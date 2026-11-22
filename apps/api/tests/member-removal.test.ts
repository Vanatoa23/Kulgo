import { describe, it } from "vitest";
import { createTestApp } from "../src/app.js";
import { InMemoryAuthRepository } from "../src/auth/repository.js";
import { verifyConcurrentOwnerRemoval } from "./helpers/member-removal.js";
import { memberRemovalCases } from "./helpers/member-removal-cases.js";

describe("In-memory atomic member removal", () => {
  memberRemovalCases(() => {
    const repo = new InMemoryAuthRepository();
    return [repo, repo];
  });
});

it("preserves an owner, its session, and exactly one removal audit during cross-removal", async () => {
  await verifyConcurrentOwnerRemoval(createTestApp());
});
