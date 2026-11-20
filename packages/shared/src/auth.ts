import { z } from "zod";

export const UserRoleSchema = z.enum(["OWNER", "MEMBER"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const OrganizationSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(100),
  countryCode: z.string().length(2),
  sector: z.string().min(1).max(100),
  esgBadges: z.array(z.string()).default([]),
  scope1Tco2e: z.number().nonnegative().nullable().default(null),
  scope2Tco2e: z.number().nonnegative().nullable().default(null),
  openToNewBuyers: z.boolean().default(false),
  capabilities: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const UserSchema = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.string().email(),
  role: UserRoleSchema,
  createdAt: z.string().datetime(),
});
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

export const AuthMeResponseSchema = z.object({
  user: UserSchema,
  organization: OrganizationSchema,
});
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;
