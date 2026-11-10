export type AiRequestOrigin =
  | "interactive_user"
  | "explicit_ai_action"
  | "passive_background_sync"
  | "unspecified";

const EXPLICIT_ORIGINS = new Set<AiRequestOrigin>([
  "interactive_user",
  "explicit_ai_action",
  "passive_background_sync",
]);

export const normalizeAiRequestOrigin = (value: unknown): AiRequestOrigin => {
  if (typeof value !== "string") return "unspecified";
  const origin = value.trim() as AiRequestOrigin;
  return EXPLICIT_ORIGINS.has(origin) ? origin : "unspecified";
};

export const shouldInvokeAiProvider = (origin: AiRequestOrigin): boolean =>
  origin !== "passive_background_sync";
