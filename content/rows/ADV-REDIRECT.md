---
what_failed: "A protocol endpoint answered with a redirect instead of answering at its published address. This row grades files that declare version 0.1; for later files the same problem is T1-14, which fails."
why_it_matters: "The 0.1 guides say each redirect hop needs its own DPoP proof, and tell assistants not to follow a redirect with the old one. Drafts 0.2 and 0.3 go further: an assistant sends no credentials to a redirect at all."
setup_step: "/setup#level-2-check-the-session-header"
spec_section: "https://personalagentprotocol.org/docs/0.3/guides"
---
