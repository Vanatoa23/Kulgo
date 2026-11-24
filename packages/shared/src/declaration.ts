import { z } from "zod";

import { CountryCodeInputSchema } from "./network.js";

/**
 * Private supplier/buyer declarations (GitHub issue #29, first slice).
 *
 * A workspace member saves the name of a supplier or buyer; the declaration
 * lives only inside the declaring organization's private workspace. The
 * owner organization is always taken from the authenticated session and
 * never from client input (the input schema is `.strict()`).
 */

export const RelationshipDeclarationRoleSchema = z.enum([
  "SUPPLIER",
  "CLIENT",
]);

export type RelationshipDeclarationRole = z.infer<
  typeof RelationshipDeclarationRoleSchema
>;

/**
 * A declaration starts as DECLARED. A supplied registry ID is still only a
 * client declaration at this stage — registry matching and confirmation are
 * distinct facts handled by later slices.
 */
export const RelationshipDeclarationStatusSchema = z.enum([
  "DECLARED",
  "CONFIRMED",
  "DECLINED",
]);

export type RelationshipDeclarationStatus = z.infer<
  typeof RelationshipDeclarationStatusSchema
>;

export const RelationshipDeclarationSchema = z
  .object({
    declarationId: z.string().uuid(),
    ownerOrgId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    role: RelationshipDeclarationRoleSchema,
    countryCode: z.string().length(2).nullable(),
    registryId: z.string().trim().min(1).max(64).nullable(),
    contactEmail: z.string().email().nullable(),
    status: RelationshipDeclarationStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type RelationshipDeclaration = z.infer<
  typeof RelationshipDeclarationSchema
>;

export const CreateRelationshipDeclarationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    role: RelationshipDeclarationRoleSchema,
    countryCode: CountryCodeInputSchema.nullable().optional(),
    registryId: z.string().trim().min(1).max(64).nullable().optional(),
    contactEmail: z.string().trim().email().max(254).nullable().optional(),
  })
  .strict();

export type CreateRelationshipDeclarationInput = z.infer<
  typeof CreateRelationshipDeclarationInputSchema
>;

export const CreateRelationshipDeclarationResponseSchema = z
  .object({
    declaration: RelationshipDeclarationSchema,
  })
  .strict();

export type CreateRelationshipDeclarationResponse = z.infer<
  typeof CreateRelationshipDeclarationResponseSchema
>;

export const ListRelationshipDeclarationsResponseSchema = z
  .object({
    declarations: z.array(RelationshipDeclarationSchema),
  })
  .strict();

export type ListRelationshipDeclarationsResponse = z.infer<
  typeof ListRelationshipDeclarationsResponseSchema
>;
