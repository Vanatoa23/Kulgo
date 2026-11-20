import {
  AcceptInviteResponseSchema,
  AddOrgMemberResponseSchema,
  AnalyticsSummarySchema,
  AuthMeResponseSchema,
  BulkImportSummarySchema,
  CreateInviteResponseSchema,
  DirectoryAlternativesResponseSchema,
  ExecutiveReportSchema,
  FacilitySchema,
  HealthResponseSchema,
  ListAuditEventsResponseSchema,
  ListInvitesResponseSchema,
  ListOrgMembersResponseSchema,
  ProductSchema,
  RemoveOrgMemberResponseSchema,
  RevokeInviteResponseSchema,
  SimulateAnalyticsResponseSchema,
  SupplyInputSchema,
  SupplyLaneSchema,
  UpdateOrganizationProfileResponseSchema,
  WorkspaceExportJsonSchema,
  WorkspaceNetworkResponseSchema,
  type AcceptInviteInput,
  type AcceptInviteResponse,
  type AddOrgMemberInput,
  type AlternativeCandidate,
  type AnalyticsSummary,
  type AuditEvent,
  type AuthMeResponse,
  type BulkImportJsonRequest,
  type BulkImportSummary,
  type CreateFacilityInput,
  type CreateInviteInput,
  type CreateInviteResponse,
  type CreateProductInput,
  type CreateSupplyInputInput,
  type CreateSupplyLaneInput,
  type ExecutiveReport,
  type Facility,
  type HealthResponse,
  type Invitation,
  type LoginInput,
  type Organization,
  type OrgMember,
  type Product,
  type RegisterInput,
  type RemoveOrgMemberResponse,
  type RevokeInviteResponse,
  type SimulateAnalyticsRequest,
  type SimulateAnalyticsResponse,
  type SupplyInput,
  type SupplyLane,
  type UpdateFacilityInput,
  type UpdateOrganizationProfileInput,
  type UpdateProductInput,
  type UpdateSupplyInputInput,
  type UpdateSupplyLaneInput,
  type WorkspaceExportJson,
  type WorkspaceNetworkResponse,
} from "@kulgo/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

interface SafeParseSchema<T> {
  safeParse: (
    data: unknown,
  ) =>
    | { success: true; data: T }
    | { success: false; error: { flatten: () => unknown; message: string } };
}

function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL ?? "";
  return raw.trim().replace(/\/+$/, "");
}

function parseWithSchema<T>(schema: SafeParseSchema<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(
      500,
      "Unexpected API response format",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

function parseWrappedField<T>(
  payload: unknown,
  key: string,
  schema: SafeParseSchema<T>,
): T {
  if (typeof payload !== "object" || payload === null || !(key in payload)) {
    throw new ApiError(500, `Missing "${key}" in API response`, payload);
  }
  const record = payload as Record<string, unknown>;
  return parseWithSchema(schema, record[key]);
}

function parseOkResponse(payload: unknown): { ok: true } {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "ok" in payload &&
    (payload as { ok: unknown }).ok === true
  ) {
    return { ok: true };
  }
  throw new ApiError(500, "Unexpected API acknowledgement response", payload);
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
  },
  parser: (payload: unknown) => T,
): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method: options.method ?? "GET",
    credentials: "include",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let rawBody: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      rawBody = JSON.parse(text) as unknown;
    } catch {
      rawBody = { error: text };
    }
  }

  if (!response.ok) {
    const errorRecord =
      typeof rawBody === "object" && rawBody !== null
        ? (rawBody as Record<string, unknown>)
        : {};
    const message =
      typeof errorRecord.error === "string" && errorRecord.error.length > 0
        ? errorRecord.error
        : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, errorRecord.details);
  }

  return parser(rawBody);
}

// --- Health ---

export async function getHealth(): Promise<HealthResponse> {
  return apiRequest("/api/v1/health", { method: "GET" }, (payload) =>
    parseWithSchema(HealthResponseSchema, payload),
  );
}

// --- Auth ---

export async function getMe(): Promise<AuthMeResponse> {
  return apiRequest("/api/v1/auth/me", { method: "GET" }, (payload) =>
    parseWithSchema(AuthMeResponseSchema, payload),
  );
}

export async function register(input: RegisterInput): Promise<AuthMeResponse> {
  return apiRequest(
    "/api/v1/auth/register",
    { method: "POST", body: input },
    (payload) => parseWithSchema(AuthMeResponseSchema, payload),
  );
}

export async function login(input: LoginInput): Promise<AuthMeResponse> {
  return apiRequest(
    "/api/v1/auth/login",
    { method: "POST", body: input },
    (payload) => parseWithSchema(AuthMeResponseSchema, payload),
  );
}

export async function logout(): Promise<{ ok: true }> {
  return apiRequest(
    "/api/v1/auth/logout",
    { method: "POST" },
    parseOkResponse,
  );
}

// --- Workspace ---

export interface NetworkQueryFilters {
  productId?: string;
  inputId?: string;
}

export async function getNetwork(
  filters?: NetworkQueryFilters,
): Promise<WorkspaceNetworkResponse> {
  const params = new URLSearchParams();
  if (filters?.productId) {
    params.set("productId", filters.productId);
  }
  if (filters?.inputId) {
    params.set("inputId", filters.inputId);
  }
  const query = params.toString();
  const path = query
    ? `/api/v1/workspace/network?${query}`
    : "/api/v1/workspace/network";
  return apiRequest(path, { method: "GET" }, (payload) =>
    parseWithSchema(WorkspaceNetworkResponseSchema, payload),
  );
}

export async function seedDemo(): Promise<WorkspaceNetworkResponse> {
  return apiRequest(
    "/api/v1/workspace/seed-demo",
    { method: "POST" },
    (payload) => parseWithSchema(WorkspaceNetworkResponseSchema, payload),
  );
}

// --- Products ---

export async function createProduct(
  input: CreateProductInput,
): Promise<Product> {
  return apiRequest(
    "/api/v1/workspace/products",
    { method: "POST", body: input },
    (payload) => parseWrappedField(payload, "product", ProductSchema),
  );
}

export async function updateProduct(
  productId: string,
  input: UpdateProductInput,
): Promise<Product> {
  return apiRequest(
    `/api/v1/workspace/products/${encodeURIComponent(productId)}`,
    { method: "PATCH", body: input },
    (payload) => parseWrappedField(payload, "product", ProductSchema),
  );
}

export async function deleteProduct(productId: string): Promise<{ ok: true }> {
  return apiRequest(
    `/api/v1/workspace/products/${encodeURIComponent(productId)}`,
    { method: "DELETE" },
    parseOkResponse,
  );
}

// --- Supply Inputs (Materials) ---

export async function createSupplyInput(
  input: CreateSupplyInputInput,
): Promise<SupplyInput> {
  return apiRequest(
    "/api/v1/workspace/inputs",
    { method: "POST", body: input },
    (payload) => parseWrappedField(payload, "input", SupplyInputSchema),
  );
}

export async function updateSupplyInput(
  inputId: string,
  input: UpdateSupplyInputInput,
): Promise<SupplyInput> {
  return apiRequest(
    `/api/v1/workspace/inputs/${encodeURIComponent(inputId)}`,
    { method: "PATCH", body: input },
    (payload) => parseWrappedField(payload, "input", SupplyInputSchema),
  );
}

export async function deleteSupplyInput(
  inputId: string,
): Promise<{ ok: true }> {
  return apiRequest(
    `/api/v1/workspace/inputs/${encodeURIComponent(inputId)}`,
    { method: "DELETE" },
    parseOkResponse,
  );
}

// --- Facilities ---

export async function createFacility(
  input: CreateFacilityInput,
): Promise<Facility> {
  return apiRequest(
    "/api/v1/workspace/facilities",
    { method: "POST", body: input },
    (payload) => parseWrappedField(payload, "facility", FacilitySchema),
  );
}

export async function updateFacility(
  facilityId: string,
  input: UpdateFacilityInput,
): Promise<Facility> {
  return apiRequest(
    `/api/v1/workspace/facilities/${encodeURIComponent(facilityId)}`,
    { method: "PATCH", body: input },
    (payload) => parseWrappedField(payload, "facility", FacilitySchema),
  );
}

export async function deleteFacility(
  facilityId: string,
): Promise<{ ok: true }> {
  return apiRequest(
    `/api/v1/workspace/facilities/${encodeURIComponent(facilityId)}`,
    { method: "DELETE" },
    parseOkResponse,
  );
}

// --- Supply Lanes ---

export async function createLane(
  input: CreateSupplyLaneInput,
): Promise<SupplyLane> {
  return apiRequest(
    "/api/v1/workspace/lanes",
    { method: "POST", body: input },
    (payload) => parseWrappedField(payload, "lane", SupplyLaneSchema),
  );
}

export async function updateLane(
  laneId: string,
  input: UpdateSupplyLaneInput,
): Promise<SupplyLane> {
  return apiRequest(
    `/api/v1/workspace/lanes/${encodeURIComponent(laneId)}`,
    { method: "PATCH", body: input },
    (payload) => parseWrappedField(payload, "lane", SupplyLaneSchema),
  );
}

export async function deleteLane(laneId: string): Promise<{ ok: true }> {
  return apiRequest(
    `/api/v1/workspace/lanes/${encodeURIComponent(laneId)}`,
    { method: "DELETE" },
    parseOkResponse,
  );
}

// --- Analytics & What-If Simulation ---

export async function getAnalyticsSummary(
  filters?: NetworkQueryFilters,
): Promise<AnalyticsSummary> {
  const params = new URLSearchParams();
  if (filters?.productId) {
    params.set("productId", filters.productId);
  }
  if (filters?.inputId) {
    params.set("inputId", filters.inputId);
  }
  const query = params.toString();
  const path = query
    ? `/api/v1/analytics/summary?${query}`
    : "/api/v1/analytics/summary";
  return apiRequest(path, { method: "GET" }, (payload) =>
    parseWithSchema(AnalyticsSummarySchema, payload),
  );
}

export async function simulateAnalytics(
  request: SimulateAnalyticsRequest,
): Promise<SimulateAnalyticsResponse> {
  return apiRequest(
    "/api/v1/analytics/simulate",
    { method: "POST", body: request },
    (payload) => parseWithSchema(SimulateAnalyticsResponseSchema, payload),
  );
}

// --- Partner Invitations (M3) ---

export async function createInvite(
  input: CreateInviteInput,
): Promise<CreateInviteResponse> {
  return apiRequest(
    "/api/v1/invites",
    { method: "POST", body: input },
    (payload) => parseWithSchema(CreateInviteResponseSchema, payload),
  );
}

export async function listInvites(): Promise<Invitation[]> {
  const result = await apiRequest(
    "/api/v1/invites",
    { method: "GET" },
    (payload) => parseWithSchema(ListInvitesResponseSchema, payload),
  );
  return result.invitations;
}

export async function acceptInvite(
  token: string,
  input: AcceptInviteInput,
): Promise<AcceptInviteResponse> {
  return apiRequest(
    `/api/v1/invites/${encodeURIComponent(token.trim())}/accept`,
    { method: "POST", body: input },
    (payload) => parseWithSchema(AcceptInviteResponseSchema, payload),
  );
}

export async function revokeInvite(
  inviteId: string,
): Promise<RevokeInviteResponse> {
  return apiRequest(
    `/api/v1/invites/${encodeURIComponent(inviteId)}`,
    { method: "DELETE" },
    (payload) => parseWithSchema(RevokeInviteResponseSchema, payload),
  );
}

// --- Opt-In Alternative Supplier Directory (M3) ---

export interface DirectoryQueryFilters {
  countryCode?: string;
  capability?: string;
  excludeRed?: boolean;
}

export async function listDirectoryAlternatives(
  filters?: DirectoryQueryFilters,
): Promise<AlternativeCandidate[]> {
  const params = new URLSearchParams();
  if (filters?.countryCode && filters.countryCode.trim().length > 0) {
    params.set("countryCode", filters.countryCode.trim().toUpperCase());
  }
  if (filters?.capability && filters.capability.trim().length > 0) {
    params.set("capability", filters.capability.trim());
  }
  if (filters?.excludeRed) {
    params.set("excludeRed", "true");
  }
  const query = params.toString();
  const path = query
    ? `/api/v1/directory/alternatives?${query}`
    : "/api/v1/directory/alternatives";
  const result = await apiRequest(path, { method: "GET" }, (payload) =>
    parseWithSchema(DirectoryAlternativesResponseSchema, payload),
  );
  return result.candidates;
}

// --- Org ESG & Directory Profile Settings (M4) ---

export async function updateOrganizationProfile(
  input: UpdateOrganizationProfileInput,
): Promise<Organization> {
  const result = await apiRequest(
    "/api/v1/auth/organization",
    { method: "PATCH", body: input },
    (payload) => parseWithSchema(UpdateOrganizationProfileResponseSchema, payload),
  );
  return result.organization;
}

// --- Bulk Import & Export (M4) ---

export async function bulkImportWorkspace(
  payload: BulkImportJsonRequest,
): Promise<BulkImportSummary> {
  return apiRequest(
    "/api/v1/workspace/import",
    { method: "POST", body: payload },
    (res) => parseWithSchema(BulkImportSummarySchema, res),
  );
}

export async function exportWorkspaceJson(): Promise<WorkspaceExportJson> {
  return apiRequest(
    "/api/v1/workspace/export?format=json",
    { method: "GET" },
    (res) => parseWithSchema(WorkspaceExportJsonSchema, res),
  );
}

export async function exportWorkspaceCsv(): Promise<string> {
  const url = `${getApiBaseUrl()}/api/v1/workspace/export?format=csv`;
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(
      response.status,
      text || `Export failed with status ${response.status}`,
    );
  }
  return text;
}

// --- CSRD / Executive Risk & ESG Report (M4) ---

export async function getExecutiveReport(
  filters?: NetworkQueryFilters,
): Promise<ExecutiveReport> {
  const params = new URLSearchParams();
  if (filters?.productId) {
    params.set("productId", filters.productId);
  }
  if (filters?.inputId) {
    params.set("inputId", filters.inputId);
  }
  const query = params.toString();
  const path = query
    ? `/api/v1/analytics/report?${query}`
    : "/api/v1/analytics/report";
  return apiRequest(path, { method: "GET" }, (res) =>
    parseWithSchema(ExecutiveReportSchema, res),
  );
}

// --- Org Team Members & RBAC (M5) ---

export async function listOrgMembers(): Promise<OrgMember[]> {
  const result = await apiRequest(
    "/api/v1/auth/members",
    { method: "GET" },
    (payload) => parseWithSchema(ListOrgMembersResponseSchema, payload),
  );
  return result.members;
}

export async function addOrgMember(
  input: AddOrgMemberInput,
): Promise<OrgMember> {
  const result = await apiRequest(
    "/api/v1/auth/members",
    { method: "POST", body: input },
    (payload) => parseWithSchema(AddOrgMemberResponseSchema, payload),
  );
  return result.member;
}

export async function removeOrgMember(
  userId: string,
): Promise<RemoveOrgMemberResponse> {
  return apiRequest(
    `/api/v1/auth/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
    (payload) => parseWithSchema(RemoveOrgMemberResponseSchema, payload),
  );
}

// --- Org-Scoped Compliance Audit Log (M6) ---

export async function listAuditEvents(limit = 50): Promise<AuditEvent[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const result = await apiRequest(
    `/api/v1/auth/audit-log?limit=${safeLimit}`,
    { method: "GET" },
    (payload) => parseWithSchema(ListAuditEventsResponseSchema, payload),
  );
  return result.events;
}



