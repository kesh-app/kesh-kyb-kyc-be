import { ForbiddenException } from "@nestjs/common";

/**
 * Central KYC/KYB capability matrix.
 *
 * Route decorators use the `*_ROUTE_ROLES` lists because RolesGuard preserves
 * the existing SystemAdmin/Director bypass. Services use the capability
 * functions below so an internal/alternate caller cannot bypass KYC policy.
 */
export const KYC_ADMIN_ROLES = ["SystemAdmin", "Director"] as const;

export const KYC_CREATE_ROUTE_ROLES = [
  "BranchAdmin",
  "FrontDesk",
  "ComplianceLead",
] as const;

export const KYC_DOCUMENT_CREATE_ROUTE_ROLES = KYC_CREATE_ROUTE_ROLES;
export const KYC_PARTY_CREATE_ROUTE_ROLES = KYC_CREATE_ROUTE_ROLES;

export const KYC_EDIT_ROUTE_ROLES = ["FrontDesk", "ComplianceLead"] as const;
export const KYC_SUBMIT_ROUTE_ROLES = KYC_EDIT_ROUTE_ROLES;
export const KYC_DELETE_DOCUMENT_ROUTE_ROLES = KYC_EDIT_ROUTE_ROLES;
export const KYC_EDD_EDIT_ROUTE_ROLES = KYC_EDIT_ROUTE_ROLES;

export const KYC_DECISION_ROUTE_ROLES = [
  "OperationSupervisor",
  "ComplianceLead",
] as const;
export const KYC_RESCREEN_ROUTE_ROLES = ["ComplianceLead"] as const;

export const KYC_EDD_READ_ROUTE_ROLES = [
  "FrontDesk",
  "ComplianceLead",
  "Auditor",
  "FinanceStaff",
  "FinanceManager",
] as const;

export const KYC_PARTY_READ_ROUTE_ROLES = [
  "BranchAdmin",
  "FrontDesk",
  "ComplianceLead",
  "SystemAdmin",
  "FinanceStaff",
  "FinanceManager",
  "Auditor",
  "OperationSupervisor",
] as const;

export const DATA_REVIEW_READ_ROUTE_ROLES = [
  "FrontDesk",
  "ComplianceLead",
  "Auditor",
] as const;
export const DATA_REVIEW_INITIATE_ROUTE_ROLES = [
  "FrontDesk",
  "ComplianceLead",
] as const;
export const DATA_REVIEW_DRAFT_ROUTE_ROLES = ["FrontDesk"] as const;
export const DATA_REVIEW_DECISION_ROUTE_ROLES = ["ComplianceLead"] as const;

export type KycMutationCapability =
  | "create"
  | "edit"
  | "documentCreate"
  | "documentDelete"
  | "partyCreate"
  | "partyDelete"
  | "submit"
  | "eddEdit"
  | "decision"
  | "rescreen"
  | "dataReviewInitiate"
  | "dataReviewDraft"
  | "dataReviewSubmit"
  | "dataReviewDecision";

const withAdmins = (roles: readonly string[]) => [
  ...roles,
  ...KYC_ADMIN_ROLES,
];

const CAPABILITY_ROLES: Record<KycMutationCapability, readonly string[]> = {
  create: withAdmins(KYC_CREATE_ROUTE_ROLES),
  edit: withAdmins(KYC_EDIT_ROUTE_ROLES),
  documentCreate: withAdmins(KYC_DOCUMENT_CREATE_ROUTE_ROLES),
  documentDelete: withAdmins(KYC_DELETE_DOCUMENT_ROUTE_ROLES),
  partyCreate: withAdmins(KYC_PARTY_CREATE_ROUTE_ROLES),
  partyDelete: withAdmins(KYC_EDIT_ROUTE_ROLES),
  submit: withAdmins(KYC_SUBMIT_ROUTE_ROLES),
  eddEdit: withAdmins(KYC_EDD_EDIT_ROUTE_ROLES),
  decision: withAdmins(KYC_DECISION_ROUTE_ROLES),
  rescreen: withAdmins(KYC_RESCREEN_ROUTE_ROLES),
  dataReviewInitiate: withAdmins(DATA_REVIEW_INITIATE_ROUTE_ROLES),
  dataReviewDraft: withAdmins(DATA_REVIEW_DRAFT_ROUTE_ROLES),
  dataReviewSubmit: withAdmins(DATA_REVIEW_DRAFT_ROUTE_ROLES),
  dataReviewDecision: withAdmins(DATA_REVIEW_DECISION_ROUTE_ROLES),
};

/** All authenticated roles retain the existing application/customer read scope. */
export function canReadKyc(role?: string | null): boolean {
  return Boolean(role);
}

export function canCreateKyc(role?: string | null): boolean {
  return Boolean(role && CAPABILITY_ROLES.create.includes(role));
}

export function canEditKyc(role?: string | null): boolean {
  return Boolean(role && CAPABILITY_ROLES.edit.includes(role));
}

export function canMutateKyc(
  role: string | null | undefined,
  capability: KycMutationCapability,
): boolean {
  return Boolean(role && CAPABILITY_ROLES[capability].includes(role));
}

export function assertCanMutateKyc(
  role: string | null | undefined,
  capability: KycMutationCapability,
): void {
  if (!canMutateKyc(role, capability)) {
    throw new ForbiddenException(
      "Role ini hanya memiliki akses baca untuk data CDD/KYC/KYB.",
    );
  }
}
