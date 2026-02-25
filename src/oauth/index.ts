/** Barrel export for OAuth utilities. */
export { OAuthError } from "./error.js";
export { generateCSRFProtection, validateCSRFToken } from "./csrf.js";
export type { CSRFProtectionResult, ValidateCSRFResult } from "./csrf.js";
export {
  createOAuthState,
  validateOAuthState,
  getUpstreamAuthorizeUrl,
  fetchUpstreamAuthToken,
} from "./state.js";
export type { OAuthStateResult, ValidateStateResult } from "./state.js";
export { isClientApproved, addApprovedClient, renderApprovalDialog } from "./approval.js";
export type { ApprovalDialogOptions } from "./approval.js";
