import { z } from "zod";

export const InvitationStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
]);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

export const InvitationSchema = z.object({
  inviteId: z.string().uuid(),
  fromOrgId: z.string().uuid(),
  targetFacilityId: z.string().uuid(),
  inviteeEmail: z.string().email(),
  status: InvitationStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const CreateInviteInputSchema = z.object({
  targetFacilityId: z.string().uuid(),
  inviteeEmail: z.string().email(),
  message: z.string().max(500).optional(),
});
export type CreateInviteInput = z.infer<typeof CreateInviteInputSchema>;

export const AcceptInviteInputSchema = z.object({
  openToNewBuyers: z.boolean().default(true),
  capabilities: z.array(z.string().min(1).max(100)).default([]),
  refinedSite: z
    .object({
      kind: z.enum(["HQ", "FACTORY", "WAREHOUSE", "PORT", "HUB"]),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      countryCode: z.string().length(2),
    })
    .optional(),
});
export type AcceptInviteInput = z.infer<typeof AcceptInviteInputSchema>;
