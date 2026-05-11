# n8n-nodes-anthropic-structured

An [n8n](https://n8n.io) community chat-model node that wraps **Anthropic Claude** and exposes Anthropic's **constrained-decoding structured-output API** (`output_config.format`) as a first-class option. Set a JSON Schema, and the model is *guaranteed* to return schema-conformant JSON — no prompt-injected formatting instructions, no optional tool the model can ignore.

A drop-in alternative to n8n's built-in Anthropic Chat Model for any workflow that needs reliable structured output.

![Anthropic (Structured) wired into an AI Agent alongside Memory and a Civic tool](https://raw.githubusercontent.com/dankelleher/n8n-nodes-anthropic-structured/main/screenshots/01-workflow-canvas.png)

## Why this exists

n8n's stock Anthropic node uses LangChain, which (as of early 2026) implements structured output via the **legacy tool-use trick** — define a synthetic `format_final_json_response` tool and hope the model calls it. This is unreliable on medium-complex schemas: the model can produce free-form text, or call the tool with malformed args, or ignore it entirely.

Anthropic [shipped real constrained decoding](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — `output_config.format` with `type: "json_schema"`. The schema is enforced at the *sampling layer*: every emitted token has to match. LangChain hasn't picked this up yet. This node does.

## Installation

In your n8n instance:

1. Go to **Settings → Community Nodes**
2. Click **Install a community node**
3. Enter `n8n-nodes-anthropic-structured` and accept the risk acknowledgement

## Setup

1. Create or open a workflow.
2. Add an **AI Agent**, **Basic LLM Chain**, or any node with an `ai_languageModel` input.
3. On the Chat Model input click `+`, search **Anthropic (Structured)**.
4. Configure an **Anthropic API** credential (`x-api-key` header — get a key at [console.anthropic.com](https://console.anthropic.com)).
5. Pick a Claude model (4.5+ — only those support `output_config.format`).
6. (Optional) Paste a JSON Schema into the **JSON Schema** field. When non-empty, every response is constrained-decoded against that schema.

![Node configuration showing the JSON Schema field](https://raw.githubusercontent.com/dankelleher/n8n-nodes-anthropic-structured/main/screenshots/02-node-config.png)

### With and without tools

- **Without tools** (Basic LLM Chain): the single response is JSON-schema conformant. Standard use case.
- **With tools** (AI Agent + tool nodes): intermediate agent rounds emit `tool_use` blocks as normal; the model's *final* answer is the schema-conformant JSON. Anthropic explicitly supports this composition.

### Supported Claude models

- Claude Opus 4.7 / 4.6 / 4.5
- Claude Sonnet 4.6 / 4.5
- Claude Haiku 4.5

Earlier Claude models don't support `output_config.format` and aren't listed in the model picker.

## How it works

Verified-community-node compliant — uses only `@n8n/ai-node-sdk` and standard `fetch`, no third-party SDKs in the published bundle:

- Extends `BaseChatModel` from `@n8n/ai-node-sdk`
- Implements `generate()` / `stream()` by POSTing to `https://api.anthropic.com/v1/messages` directly
- Maps n8n's `Message`/`MessageContent` types to Anthropic's request shape (system messages extracted to the top-level `system` field, `tool-call`/`tool-result` content blocks translated to Anthropic's `tool_use`/`tool_result`)
- Tools bound by the agent via `withTools()` are sent as Anthropic tool definitions; `input_schema` `type` is backfilled to `"object"` when missing so Anthropic accepts schemas like `{}` from tools without parameters
- When `jsonSchema` is set, includes `output_config: { format: { type: "json_schema", schema } }`

See [`nodes/AnthropicStructured/helpers.ts`](nodes/AnthropicStructured/helpers.ts) for the conversion functions (covered by vitest tests).

## Credentials

The **Anthropic API** credential takes a single field:

- **API Key** — your Anthropic API key (sent as the `x-api-key` header along with `anthropic-version: 2023-06-01`)

The credential test issues a `GET /v1/models` against the Anthropic API.

## Compatibility

- n8n `>= 2.19`
- Self-hosted and (once verified) n8n Cloud
- Zero third-party runtime dependencies

## Development

```bash
pnpm install      # install deps
pnpm lint         # n8n's community-node lint suite
pnpm test         # vitest unit tests
pnpm build        # compile TypeScript and copy static files into dist/
pnpm dev          # run a local n8n with this node loaded (hot reload)
```

CI runs lint + tests + build on every push and PR. Releases are triggered by pushing a version tag (e.g. `0.1.1`); GitHub Actions then publishes to npm with a provenance attestation.

## Resources

- [Anthropic structured outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic Messages API reference](https://docs.claude.com/en/api/messages)
- [n8n community node docs](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
