---
what_failed: "A protocol endpoint answered with a redirect instead of answering at its published address."
why_it_matters: "Outside discovery, the spec (section 3) says an assistant must not send a token, DPoP proof, assertion or credentials to the address an endpoint redirects to. So a protocol endpoint should answer at its published address."
setup_step: "/setup#level-2-tokens-work-only-with-the-assistants-key"
spec_section: "https://personalagentprotocol.org/docs/spec#discovery"
---
