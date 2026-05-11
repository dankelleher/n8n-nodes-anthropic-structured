# Changelog

## 0.1.2

- `package.json`: add `author.email` so n8n's verification form can read it
  from the npm registry.

## 0.1.1

- First release published via GitHub Actions with an npm provenance attestation
  (SLSA-signed). No code changes vs 0.1.0.

## 0.1.0 — Initial release

- `Anthropic (Structured)` chat-model sub-node for n8n's AI Agent / Basic LLM Chain.
- Calls Anthropic's `/v1/messages` API directly via `fetch` — no third-party SDK shipped in dist.
- `JSON Schema` parameter wires through to Anthropic's `output_config.format` constrained-decoding API for guaranteed schema-conformant output.
- Composes with tools: intermediate agent rounds emit `tool_use` blocks, the final response is schema-conformant.
- Verified-node compliant — uses only `n8n-workflow`, `@n8n/ai-node-sdk`, and standard `fetch`.
