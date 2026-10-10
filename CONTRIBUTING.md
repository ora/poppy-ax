# Contributing

Thank you for helping keep this guide accurate. The most useful fix is a wrong or unclear sentence, and you can make one without running the site.

## Fix a sentence

All page text lives in [`content/`](content/): JSON for the page shell and short strings, Markdown and MDX for longer text. Components only display it.

1. Find the sentence. Search the repository for a few words of it; it will be in a file under `content/`.
2. Edit the file on GitHub (the pencil icon) or in your own fork.
3. Open a pull request. Say what was wrong and, for anything about the protocol, link the section of the [PAP spec](https://personalagentprotocol.org/docs/spec) that supports your change.

Not sure what the fix should be? Use the "Report an error" link at the foot of any page. It opens an issue with the page path filled in.

## House style

- Plain words and short sentences. Explain a term the first time it appears.
- Take every field name and requirement from the spec, and link the section it comes from. Do not write field names from memory.
- No em dashes. Use a spaced hyphen or rewrite the sentence.

## License of contributions

Content in `content/` is licensed under [CC BY 4.0](content/LICENSE), and the rest of the code under the [MIT License](LICENSE). By opening a pull request you agree that your contribution is released under the same license as the files it changes.

## Code changes

Run these before you open a pull request:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```
