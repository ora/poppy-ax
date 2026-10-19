---
what_failed: "A protocol endpoint answered with a redirect instead of answering at its published address. This row grades files that declare version 0.1; for 0.2 files the same problem is T1-14, which fails."
why_it_matters: "The 0.1 guides say each redirect hop needs its own DPoP proof, and tell assistants not to follow a redirect with the old one. Draft 0.2 goes further: an assistant sends no credentials to a redirect at all."
setup_step: "/setup#level-2-tokens-work-only-with-the-assistants-key"
spec_section: "https://personalagentprotocol.org/docs/guides"
---
