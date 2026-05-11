// Pure helpers that convert between n8n's @n8n/ai-node-sdk types and
// Anthropic's `/v1/messages` API wire format. Kept side-effect-free so they
// can be unit-tested in isolation.

import {
	getParametersJsonSchema,
	type FinishReason,
	type Message,
	type MessageContent,
	type Tool,
} from '@n8n/ai-node-sdk';

// ─── Anthropic request/response shapes ──────────────────────────────────────

export interface AnthropicTextBlock {
	type: 'text';
	text: string;
}

export interface AnthropicToolUseBlock {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
	type: 'tool_result';
	tool_use_id: string;
	content: string;
}

export type AnthropicContentBlock =
	| AnthropicTextBlock
	| AnthropicToolUseBlock
	| AnthropicToolResultBlock
	| { type: string; [k: string]: unknown };

export interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: AnthropicContentBlock[];
}

export interface AnthropicToolDefinition {
	name: string;
	description?: string;
	input_schema: Record<string, unknown>;
}

export interface AnthropicMessagesResponse {
	id: string;
	type: 'message';
	role: 'assistant';
	model: string;
	content: AnthropicContentBlock[];
	stop_reason: string | null;
	usage?: { input_tokens?: number; output_tokens?: number };
}

// ─── Conversion functions ───────────────────────────────────────────────────

/**
 * Anthropic's `system` is a separate top-level field, not a role inside
 * `messages`. Pull all system content out of the message list and join it.
 */
export const splitSystem = (
	messages: Message[],
): { systemMessage?: string; conversation: Message[] } => {
	const system: string[] = [];
	const conversation: Message[] = [];
	for (const m of messages) {
		if (m.role === 'system') {
			for (const c of m.content) {
				if (c.type === 'text') system.push(c.text);
			}
		} else {
			conversation.push(m);
		}
	}
	return {
		systemMessage: system.length > 0 ? system.join('\n\n') : undefined,
		conversation,
	};
};

/**
 * Map an n8n `Message` to an Anthropic message object. Tool/result content
 * blocks are translated to Anthropic's `tool_use` / `tool_result` shapes.
 * The `tool` role collapses into `user` (Anthropic's `tool_result` blocks
 * live inside user-role messages).
 */
export const toAnthropicMessage = (m: Message): AnthropicMessage => {
	const role: AnthropicMessage['role'] = m.role === 'assistant' ? 'assistant' : 'user';
	const content: AnthropicContentBlock[] = [];
	for (const c of m.content) {
		if (c.type === 'text') {
			content.push({ type: 'text', text: c.text });
		} else if (c.type === 'tool-call') {
			content.push({
				type: 'tool_use',
				id: c.toolCallId ?? c.toolName,
				name: c.toolName,
				input: parseToolCallInput(c.input),
			});
		} else if (c.type === 'tool-result') {
			content.push({
				type: 'tool_result',
				tool_use_id: c.toolCallId,
				content:
					typeof c.result === 'string' ? c.result : JSON.stringify(c.result),
			});
		}
	}
	return { role, content };
};

/**
 * Map an Anthropic content block back to n8n's `MessageContent`. Blocks that
 * have no n8n equivalent (e.g. provider-specific server tool use) return
 * `null` and are filtered out by the caller.
 */
export const toN8nContent = (block: AnthropicContentBlock): MessageContent | null => {
	if (block.type === 'text' && typeof (block as AnthropicTextBlock).text === 'string') {
		return { type: 'text', text: (block as AnthropicTextBlock).text };
	}
	if (block.type === 'tool_use') {
		const b = block as AnthropicToolUseBlock;
		return {
			type: 'tool-call',
			toolCallId: b.id,
			toolName: b.name,
			input: JSON.stringify(b.input ?? {}),
		};
	}
	return null;
};

/**
 * Convert an n8n `Tool` to Anthropic's tool definition shape. Provider tools
 * (Anthropic-side server tools like `web_search`) aren't supported by this
 * node and are dropped.
 *
 * Anthropic requires every `input_schema` to have a top-level `type` field
 * (typically `"object"`). `getParametersJsonSchema()` doesn't always provide
 * one — e.g. for tools with no parameters — so we backfill sensibly.
 */
export const toAnthropicToolDefinition = (tool: Tool): AnthropicToolDefinition | null => {
	if (tool.type !== 'function') return null;
	const raw = getParametersJsonSchema(tool) as unknown as Record<string, unknown>;
	const input_schema: Record<string, unknown> =
		raw && typeof raw === 'object' ? { ...raw } : {};
	if (typeof input_schema.type !== 'string') {
		input_schema.type = 'object';
	}
	if (input_schema.type === 'object' && input_schema.properties === undefined) {
		input_schema.properties = {};
	}
	const def: AnthropicToolDefinition = {
		name: tool.name,
		input_schema,
	};
	if (tool.description) def.description = tool.description;
	return def;
};

/**
 * Translate Anthropic's `stop_reason` to n8n's `FinishReason` taxonomy.
 */
export const mapFinishReason = (reason: string | null): FinishReason => {
	switch (reason) {
		case 'end_turn':
		case 'stop_sequence':
			return 'stop';
		case 'max_tokens':
			return 'length';
		case 'tool_use':
			return 'tool-calls';
		default:
			return 'other';
	}
};

// ─── Internal ───────────────────────────────────────────────────────────────

/**
 * n8n's `ContentToolCall.input` is a JSON-encoded string. Anthropic expects
 * `tool_use.input` as an object. Parse, falling back to a wrapped form if
 * the upstream caller emitted something un-parseable so we never lose data.
 */
const parseToolCallInput = (raw: string): Record<string, unknown> => {
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return { _raw: raw };
	}
};
