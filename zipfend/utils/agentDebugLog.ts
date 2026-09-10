export function agentDebugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
) {
  if (import.meta.env.DEV) {
    console.debug(`[DEBUG:${hypothesisId}] ${location} - ${message}`, data);
  }
}
