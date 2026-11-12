// Heading anchors on the frozen pages of Poppy Draft 0.3 (published 2026-11-04, read 2026-11-09, re-checked 2026-11-12), and on
// the unversioned pages the guide links (the path to 1.0, the roadmap, the changelog and the company kit).
// A link to any other anchor lands at the top of the page instead of the section.
export const SPEC_ANCHORS: Record<string, string[]> = {
  "/docs/0.3/spec": [
    "intro", "layers", "terms", "discovery", "fields", "oauth-server", "extensions", "oauth", "agent-identity",
    "direct-sign-in", "device-sign-in", "refresh-tokens", "access-tokens", "revocation", "scopes", "oauth-additions",
    "sessions", "user-ids", "session-header", "delegated-keys", "session-verification", "operator-signatures",
    "sign-in", "ending-sessions", "sending-requests", "web-browsing", "apis", "conversations",
    "conversation-protocols", "conversation-requests", "sending-messages", "message-fields", "reading-events",
    "streaming", "status", "human-or-ai", "handoff", "direct-conversations", "conversation-sign-in", "closing",
    "conversation-errors", "task-coverage", "excluded-tasks", "alternatives", "feedback", "agent-context",
    "security", "untrusted-content", "secrets", "trust", "assertion-audience", "credentials", "browser-join",
    "delegated-key-security", "references",
  ],
  "/docs/0.3/extensions/operations": [
    "intro", "support", "operation-object", "approval-required", "approval", "sending-approval", "at-most-once",
    "security", "approval-proof", "references",
  ],
  "/docs/0.3/extensions/mediated-sign-in": ["intro", "support", "signing-in", "one-time-codes", "errors", "security"],
  "/docs/0.3/guides": [
    "about", "both", "both-secrets", "both-signing", "both-operator-signatures", "both-key-rotation",
    "both-fetching", "both-replies", "both-retries", "both-rate-limits", "both-transport", "both-interoperability",
    "agents", "agent-discovery", "agent-user-ids", "agent-session-header", "agent-tokens", "agent-account-access",
    "agent-choosing-sign-in", "agent-direct-device", "agent-mediated", "agent-native-apps", "agent-browsing",
    "agent-conversations", "agent-interfaces", "agent-excluded-tasks", "agent-operations", "companies",
    "company-adoption", "company-without-oauth", "company-agents", "company-session-header", "company-sessions",
    "company-lifetimes", "company-scope-descriptions", "company-api-descriptions", "company-consent",
    "company-device", "company-mediated", "company-account-settings", "company-browsing", "company-scopes",
    "company-internal", "company-hosting", "company-conversation-provider", "company-agent-issuer",
    "company-guest", "company-conversations", "company-excluded-tasks", "company-operations", "company-errors",
  ],
  "/docs/path-to-1": ["process", "feedback", "open-topics", "partners"],
  "/docs/roadmap": ["payments", "push-notifications", "attachments", "signed-approvals", "self-hosted", "mediated-sign-in"],
  "/docs/changelog": ["v0-3", "v0-3-major", "v0-3-minor", "v0-3-guides"],
  "/kit/company": ["requirements", "install", "usage", "architecture", "before", "after", "validator", "feedback"],
};
