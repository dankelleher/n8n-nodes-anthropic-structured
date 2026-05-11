// `BaseChatModel` from `@n8n/ai-node-sdk` that talks to Anthropic's
// `/v1/messages` endpoint via `fetch`. No third-party SDK — passes the
// `@n8n/community-nodes/no-restricted-imports` allowlist used by the
// verified-node scanner.
//
// When `jsonSchema` is set on the model, requests include
// `output_config: { format: { type: "json_schema", schema } }` — Anthropic's
// constrained-decoding API. The final response is then guaranteed to be
// schema-conformant. Intermediate `tool_use` rounds in an agent loop are
// not constrained (Anthropic documents this composition as a primary use
// case for agentic workflows).
//
// References
//  - Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
//  - Messages API:        https://docs.claude.com/en/api/messages

import {
	BaseChatModel,
	type ChatModelConfig,
	type GenerateResult,
	type Message,
	type MessageContent,
	type StreamChunk,
} from '@n8n/ai-node-sdk';

import {
	type AnthropicContentBlock,
	type AnthropicMessagesResponse,
	type AnthropicToolDefinition,
	mapFinishReason,
	splitSystem,
	toAnthropicMessage,
	toAnthropicToolDefinition,
	toN8nContent,
} from './helpers';

const ANTHROPIC_VERSION = '2023-06-01';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MAX_TOKENS = 4096;

export interface StructuredAnthropicConfig extends ChatModelConfig {
	jsonSchema?: Record<string, unknown>;
}

export class StructuredAnthropicModel extends BaseChatModel<StructuredAnthropicConfig> {
	private readonly apiKey: string;

	constructor(apiKey: string, modelId: string, defaultConfig?: StructuredAnthropicConfig) {
		super('anthropic', modelId, defaultConfig);
		this.apiKey = apiKey;
	}

	async generate(
		messages: Message[],
		config?: StructuredAnthropicConfig,
	): Promise<GenerateResult> {
		const body = this.buildRequestBody(messages, config, false);
		const response = await fetch(MESSAGES_URL, {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify(body),
			signal: config?.abortSignal,
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Anthropic API error ${response.status}: ${text}`);
		}
		const data = (await response.json()) as AnthropicMessagesResponse;
		return this.toGenerateResult(data);
	}

	stream(
		messages: Message[],
		config?: StructuredAnthropicConfig,
	): AsyncIterable<StreamChunk> {
		// MVP: emit the full response as a single text-delta + finish chunk.
		// True SSE streaming via `parseSSEStream` is a follow-up — agents
		// using structured output for a single JSON-blob answer don't really
		// benefit from per-token streaming.
		const generate = this.generate(messages, config);
		return (async function* (): AsyncIterable<StreamChunk> {
			const result = await generate;
			for (const part of result.message.content) {
				if (part.type === 'text') {
					yield { type: 'text-delta', delta: part.text };
				}
			}
			yield {
				type: 'finish',
				finishReason: result.finishReason ?? 'stop',
				usage: result.usage,
			};
		})();
	}

	private headers(): Record<string, string> {
		return {
			'x-api-key': this.apiKey,
			'anthropic-version': ANTHROPIC_VERSION,
			'content-type': 'application/json',
		};
	}

	private buildRequestBody(
		messages: Message[],
		config: StructuredAnthropicConfig | undefined,
		stream: boolean,
	): Record<string, unknown> {
		const merged: StructuredAnthropicConfig = {
			...this.defaultConfig,
			...config,
		};
		const { systemMessage, conversation } = splitSystem(messages);
		const body: Record<string, unknown> = {
			model: this.modelId,
			max_tokens: merged.maxTokens ?? DEFAULT_MAX_TOKENS,
			messages: conversation.map(toAnthropicMessage),
			stream,
		};
		if (systemMessage) body.system = systemMessage;
		if (typeof merged.temperature === 'number') body.temperature = merged.temperature;
		if (typeof merged.topP === 'number') body.top_p = merged.topP;
		if (typeof merged.topK === 'number') body.top_k = merged.topK;
		if (Array.isArray(merged.stopSequences) && merged.stopSequences.length > 0) {
			body.stop_sequences = merged.stopSequences;
		}
		// Tools bound via `BaseChatModel#withTools()` end up on `this.tools`.
		// We send them on every request so the agent's tool dispatch works.
		if (this.tools.length > 0) {
			body.tools = this.tools
				.map(toAnthropicToolDefinition)
				.filter((t): t is AnthropicToolDefinition => t !== null);
		}
		// `output_config.format` composes with `tools`: intermediate agent
		// rounds emit `tool_use` blocks, the final answer is schema-conformant.
		if (merged.jsonSchema) {
			body.output_config = {
				format: { type: 'json_schema', schema: merged.jsonSchema },
			};
		}
		return body;
	}

	private toGenerateResult(data: AnthropicMessagesResponse): GenerateResult {
		const content: MessageContent[] = data.content
			.map((block: AnthropicContentBlock) => toN8nContent(block))
			.filter((c): c is MessageContent => c !== null);
		const promptTokens = data.usage?.input_tokens ?? 0;
		const completionTokens = data.usage?.output_tokens ?? 0;
		return {
			id: data.id,
			finishReason: mapFinishReason(data.stop_reason),
			usage: {
				promptTokens,
				completionTokens,
				totalTokens: promptTokens + completionTokens,
			},
			message: { role: 'assistant', content },
		};
	}
}
