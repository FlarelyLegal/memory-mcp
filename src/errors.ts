/**
 * Shared error classification used by both MCP tool handlers and REST API middleware.
 *
 * Centralizes the mapping from thrown errors to user-facing error info,
 * so both protocols apply the same logic.
 */

import { AccessDeniedError } from "./auth.js";

export type ErrorKind = "access_denied" | "bad_input" | "internal";

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  /** HTTP status code (for API layer). */
  status: number;
  /** Whether to log the error server-side. */
  log: boolean;
}

/** Classify an unknown thrown value into a structured error. */
export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof AccessDeniedError) {
    return { kind: "access_denied", message: error.message, status: 403, log: false };
  }
  if (error instanceof SyntaxError) {
    return { kind: "bad_input", message: "Invalid JSON body", status: 400, log: false };
  }
  return { kind: "internal", message: "Internal error", status: 500, log: true };
}
