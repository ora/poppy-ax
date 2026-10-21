// Heading anchors on the live pages of Poppy Draft 0.2 (in progress, read 2026-10-19). A link to
// any other anchor lands at the top of the page instead of the section.
export const SPEC_ANCHORS: Record<string, string[]> = {
  "/docs/spec": [
    "intro", "terms", "discovery", "fields", "oauth-server", "extensions", "sessions", "agent-identity",
    "starting-sessions", "sending-tokens", "sign-in", "direct-sign-in", "device-sign-in", "mediated-sign-in",
    "account-tokens", "sign-out", "web-browsing", "apis", "conversations", "conversation-protocols",
    "conversation-requests", "sending-messages", "message-fields", "reading-events", "streaming", "status",
    "human-or-ai", "handoff", "direct-conversations", "conversation-sign-in", "closing", "conversation-errors",
    "feedback", "security", "untrusted-content", "secrets", "trust", "assertion-audience", "references",
  ],
  "/docs/extensions/operations": [
    "intro", "support", "operations", "revisions", "ownership", "proposing", "binding-openapi", "binding-mcp",
    "binding-conversations", "binding-web", "confirming", "approval", "confirm", "tracking", "cancelling",
    "proof", "errors",
  ],
  "/docs/guides": [
    "about", "both", "both-secrets", "both-signing", "both-key-rotation", "both-fetching", "both-retries",
    "both-rate-limits", "both-transport", "agents", "agent-discovery", "agent-user-ids", "agent-dpop",
    "agent-tokens", "agent-choosing-sign-in", "agent-direct-device", "agent-mediated", "agent-native-apps",
    "agent-browsing", "agent-conversations", "agent-interfaces", "companies", "company-agents", "company-dpop",
    "company-lifetimes", "company-consent", "company-device", "company-mediated", "company-account-settings",
    "company-browsing", "company-scopes", "company-internal", "company-hosting", "company-guest",
    "company-conversations", "company-errors", "operations", "operations-agents", "operations-companies",
  ],
  "/docs/path-to-1": ["process", "feedback", "open-topics", "partners"],
  "/kit/company": ["requirements", "install", "usage", "architecture", "validator", "feedback"],
};
