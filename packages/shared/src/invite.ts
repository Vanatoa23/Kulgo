import { z } from "zod";

export const InvitationStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
]);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

export const InvitationSchema = z
  .object({
    inviteId: z.string().uuid(),
    fromOrgId: z.string().uuid(),
    targetFacilityId: z.string().uuid(),
    inviteeEmail: z.string().email(),
    status: InvitationStatusSchema,
    expiresAt: z.string().datetime(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type Invitation = z.infer<typeof InvitationSchema>;

export const CreateInviteInputSchema = z.object({
  targetFacilityId: z.string().uuid(),
  inviteeEmail: z.string().email(),
  message: z.string().max(500).optional(),
});
export type CreateInviteInput = z.infer<typeof CreateInviteInputSchema>;

export const AcceptInviteInputSchema = z.object({
  openToNewBuyers: z.boolean().optional(),
  capabilities: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  fulfilledByFacilityId: z.string().uuid().optional(),
  refinedSite: z
    .object({
      kind: z.enum(["HQ", "FACTORY", "WAREHOUSE", "PORT", "HUB"]),
      lat: z.number().finite().min(-90).max(90),
      lng: z.number().finite().min(-180).max(180),
      countryCode: z
        .string()
        .trim()
        .length(2)
        .transform((value) => value.toUpperCase())
        .refine(
          (value) => /^[A-Z]{2}$/.test(value),
          "countryCode must be a 2-letter ISO code",
        ),
    })
    .optional(),
});
export type AcceptInviteInput = z.infer<typeof AcceptInviteInputSchema>;

export const CreateInviteResponseSchema = z
  .object({
    invitation: InvitationSchema,
    inviteToken: z.string().min(1),
    inviteLink: z.string().min(1),
  })
  .strict();
export type CreateInviteResponse = z.infer<typeof CreateInviteResponseSchema>;

export const ListInvitesResponseSchema = z
  .object({
    invitations: z.array(InvitationSchema),
  })
  .strict();
export type ListInvitesResponse = z.infer<typeof ListInvitesResponseSchema>;

export const AcceptInviteResponseSchema = z
  .object({
    invitation: InvitationSchema,
    verifiedPartnerLink: z
      .object({
        inviteId: z.string().uuid(),
        linkedAt: z.string().datetime(),
      })
      .strict(),
    organization: z
      .object({
        orgId: z.string().uuid(),
        openToNewBuyers: z.boolean(),
        capabilities: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;

export const RevokeInviteResponseSchema = z
  .object({
    ok: z.literal(true),
    invitation: InvitationSchema,
  })
  .strict();
export type RevokeInviteResponse = z.infer<typeof RevokeInviteResponseSchema>;
