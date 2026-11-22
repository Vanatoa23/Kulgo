import { z } from "zod";
import { CompliancePackIdSchema, TargetMarketSchema } from "./esg.js";

export const UserRoleSchema = z.enum(["OWNER", "MEMBER"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const OrganizationSchema = z
  .object({
    orgId: z.string().uuid(),
    name: z.string().min(1).max(160),
    slug: z.string().min(1).max(100),
    countryCode: z.string().length(2),
    sector: z.string().min(1).max(100),
    esgBadges: z.array(z.string()).default([]),
    scope1Tco2e: z.number().nonnegative().nullable().default(null),
    scope2Tco2e: z.number().nonnegative().nullable().default(null),
    scope2MarketTco2e: z.number().nonnegative().nullable().optional(),
    annualRevenueEur: z.number().finite().nonnegative().nullable().optional(),
    targetMarkets: z.array(TargetMarketSchema).optional(),
    enabledCompliancePacks: z.array(CompliancePackIdSchema).optional(),
    openToNewBuyers: z.boolean().default(false),
    capabilities: z.array(z.string()).default([]),
    createdAt: z.string().datetime(),
  })
  .strict();
export type Organization = z.infer<typeof OrganizationSchema>;

export const UserSchema = z
  .object({
    userId: z.string().uuid(),
    orgId: z.string().uuid(),
    email: z.string().email(),
    role: UserRoleSchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type User = z.infer<typeof UserSchema>;

export const RegisterInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(128),
  organizationName: z.string().min(2).max(160),
  countryCode: z.string().length(2).default("EE"),
  sector: z.string().min(2).max(100).default("Manufacturing"),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const AuthMeResponseSchema = z
  .object({
    user: UserSchema,
    organization: OrganizationSchema,
  })
  .strict();
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const UpdateOrganizationProfileInputSchema = z
  .object({
    scope1Tco2e: z.number().finite().nonnegative().nullable().optional(),
    scope2Tco2e: z.number().finite().nonnegative().nullable().optional(),
    scope2MarketTco2e: z.number().finite().nonnegative().nullable().optional(),
    annualRevenueEur: z.number().finite().nonnegative().nullable().optional(),
    targetMarkets: z.array(TargetMarketSchema).max(10).optional(),
    enabledCompliancePacks: z.array(CompliancePackIdSchema).max(10).optional(),
    esgBadges: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    openToNewBuyers: z.boolean().optional(),
    capabilities: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  })
  .strict();
export type UpdateOrganizationProfileInput = z.infer<
  typeof UpdateOrganizationProfileInputSchema
>;

export const UpdateOrganizationProfileResponseSchema = z
  .object({
    organization: OrganizationSchema,
  })
  .strict();
export type UpdateOrganizationProfileResponse = z.infer<
  typeof UpdateOrganizationProfileResponseSchema
>;

export const OrgMemberSchema = UserSchema.strict();
export type OrgMember = z.infer<typeof OrgMemberSchema>;

export const ListOrgMembersResponseSchema = z
  .object({
    members: z.array(OrgMemberSchema),
  })
  .strict();
export type ListOrgMembersResponse = z.infer<
  typeof ListOrgMembersResponseSchema
>;

export const AddOrgMemberInputSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(10).max(128),
    role: UserRoleSchema.default("MEMBER"),
  })
  .strict();
export type AddOrgMemberInput = z.infer<typeof AddOrgMemberInputSchema>;

export const AddOrgMemberResponseSchema = z
  .object({
    member: OrgMemberSchema,
  })
  .strict();
export type AddOrgMemberResponse = z.infer<typeof AddOrgMemberResponseSchema>;

export const RemoveOrgMemberResponseSchema = z
  .object({
    ok: z.literal(true),
    removedUserId: z.string().uuid(),
  })
  .strict();
export type RemoveOrgMemberResponse = z.infer<
  typeof RemoveOrgMemberResponseSchema
>;

export const AuditActionSchema = z.enum([
  "ORG_PROFILE_UPDATED",
  "MEMBER_ADDED",
  "MEMBER_REMOVED",
  "BULK_IMPORT_EXECUTED",
  "INVITE_CREATED",
  "INVITE_ACCEPTED",
  "INVITE_REVOKED",
  "CSRD_REPORT_EXPORTED",
  "ESG_LEDGER_EXPORTED",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditMetadataValueSchema = z.union([
  z.string().max(240),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type AuditMetadataValue = z.infer<typeof AuditMetadataValueSchema>;

export const AuditEventSchema = z
  .object({
    eventId: z.string().uuid(),
    orgId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    actorEmail: z.string().email(),
    action: AuditActionSchema,
    summary: z.string().min(1).max(500),
    metadata: z.record(z.string().min(1).max(64), AuditMetadataValueSchema).default({}),
    createdAt: z.string().datetime(),
  })
  .strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const ListAuditEventsResponseSchema = z
  .object({
    events: z.array(AuditEventSchema),
  })
  .strict();
export type ListAuditEventsResponse = z.infer<
  typeof ListAuditEventsResponseSchema
>;



