/** Shared types for consolidation workflow steps. */

/** Step retry configuration passed to `step.do()`. */
export type StepRetry = {
  retries: { limit: number; delay: number; backoff: "exponential" | "linear" };
  timeout: number;
};
