import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
	mapFinishReason,
	splitSystem,
	toAnthropicMessage,
	toAnthropicToolDefinition,
	toN8nContent,
} from '../nodes/AnthropicStructured/helpers';

describe('splitSystem', () => {
	it('pulls a single system text message into systemMessage and leaves the rest', () => {
		const result = splitSystem([
			{ role: 'system', content: [{ type: 'text', text: 'You are concise.' }] },
			{ role: 'user', content: [{ type: 'text', text: 'Hello' }] },
		]);
		expect(result.systemMessage).toBe('You are concise.');
		expect(result.conversation).toHaveLength(1);
		expect(result.conversation[0].role).toBe('user');
	});

	it('joins multiple system messages with double newlines', () => {
		const result = splitSystem([
			{ role: 'system', content: [{ type: 'text', text: 'Rule one.' }] },
			{ role: 'system', content: [{ type: 'text', text: 'Rule two.' }] },
			{ role: 'user', content: [{ type: 'text', text: 'Hi' }] },
		]);
		expect(result.systemMessage).toBe('Rule one.\n\nRule two.');
		expect(result.conversation).toHaveLength(1);
	});

	it('returns undefined systemMessage when no system role present', () => {
		const result = splitSystem([
			{ role: 'user', content: [{ type: 'text', text: 'Hi' }] },
		]);
		expect(result.systemMessage).toBeUndefined();
		expect(result.conversation).toHaveLength(1);
	});

	it('ignores non-text content inside system messages', () => {
		const result = splitSystem([
			{
				role: 'system',
				content: [
					{ type: 'text', text: 'Use the calendar tool.' },
					{ type: 'reasoning', text: 'thinking…' },
				],
			},
		]);
		expect(result.systemMessage).toBe('Use the calendar tool.');
	});
});

describe('toAnthropicMessage', () => {
	it('passes plain text through unchanged', () => {
		const out = toAnthropicMessage({
			role: 'user',
			content: [{ type: 'text', text: 'Hello' }],
		});
		expect(out).toEqual({
			role: 'user',
			content: [{ type: 'text', text: 'Hello' }],
		});
	});

	it('translates tool-call into tool_use with parsed input', () => {
		const out = toAnthropicMessage({
			role: 'assistant',
			content: [
				{
					type: 'tool-call',
					toolCallId: 'call_1',
					toolName: 'get_weather',
					input: '{"city":"Berlin"}',
				},
			],
		});
		expect(out.role).toBe('assistant');
		expect(out.content[0]).toEqual({
			type: 'tool_use',
			id: 'call_1',
			name: 'get_weather',
			input: { city: 'Berlin' },
		});
	});

	it('wraps un-parseable tool-call input under _raw rather than dropping it', () => {
		const out = toAnthropicMessage({
			role: 'assistant',
			content: [
				{
					type: 'tool-call',
					toolCallId: 'call_2',
					toolName: 'noisy',
					input: 'not json',
				},
			],
		});
		expect(out.content[0]).toMatchObject({
			type: 'tool_use',
			input: { _raw: 'not json' },
		});
	});

	it('translates tool-result with object result into JSON-stringified content', () => {
		const out = toAnthropicMessage({
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'call_1',
					toolName: 'get_weather',
					result: { tempC: 18 },
					status: 'success',
				},
			],
		});
		expect(out.role).toBe('user'); // tool role collapses to user in Anthropic format
		expect(out.content[0]).toEqual({
			type: 'tool_result',
			tool_use_id: 'call_1',
			content: '{"tempC":18}',
		});
	});

	it('passes a string tool-result through verbatim', () => {
		const out = toAnthropicMessage({
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'call_1',
					toolName: 'echo',
					result: 'ok',
					status: 'success',
				},
			],
		});
		expect(out.content[0]).toMatchObject({
			type: 'tool_result',
			content: 'ok',
		});
	});
});

describe('toN8nContent', () => {
	it('passes text blocks through', () => {
		expect(toN8nContent({ type: 'text', text: 'hi' })).toEqual({
			type: 'text',
			text: 'hi',
		});
	});

	it('translates tool_use into tool-call with JSON-stringified input', () => {
		expect(
			toN8nContent({
				type: 'tool_use',
				id: 'call_1',
				name: 'get_weather',
				input: { city: 'Berlin' },
			}),
		).toEqual({
			type: 'tool-call',
			toolCallId: 'call_1',
			toolName: 'get_weather',
			input: '{"city":"Berlin"}',
		});
	});

	it('returns null for unrecognised block types', () => {
		expect(toN8nContent({ type: 'thinking', text: 'x' })).toBeNull();
	});

	it('returns null for tool_use with missing input (defaults to empty object string)', () => {
		expect(
			toN8nContent({ type: 'tool_use', id: 'a', name: 'b', input: undefined } as never),
		).toEqual({
			type: 'tool-call',
			toolCallId: 'a',
			toolName: 'b',
			input: '{}',
		});
	});
});

describe('toAnthropicToolDefinition', () => {
	it('converts a JSONSchema-shaped function tool unchanged when valid', () => {
		const def = toAnthropicToolDefinition({
			type: 'function',
			name: 'get_weather',
			description: 'Look up weather',
			inputSchema: {
				type: 'object',
				properties: { city: { type: 'string' } },
				required: ['city'],
			},
		});
		expect(def).toEqual({
			name: 'get_weather',
			description: 'Look up weather',
			input_schema: {
				type: 'object',
				properties: { city: { type: 'string' } },
				required: ['city'],
			},
		});
	});

	it("backfills type: 'object' when the input_schema is missing one (Anthropic rejects schemas without it)", () => {
		const def = toAnthropicToolDefinition({
			type: 'function',
			name: 'noop',
			inputSchema: {},
		});
		expect(def?.input_schema).toMatchObject({ type: 'object', properties: {} });
	});

	it('converts a Zod inputSchema into a JSON Schema with backfill', () => {
		const def = toAnthropicToolDefinition({
			type: 'function',
			name: 'echo',
			inputSchema: z.object({ message: z.string() }),
		});
		expect(def?.input_schema.type).toBe('object');
		expect(def?.input_schema.properties).toBeDefined();
	});

	it('drops provider tools (server-side Anthropic tools etc.)', () => {
		expect(
			toAnthropicToolDefinition({ type: 'provider', name: 'web_search' }),
		).toBeNull();
	});
});

describe('mapFinishReason', () => {
	it("maps 'end_turn' to 'stop'", () => {
		expect(mapFinishReason('end_turn')).toBe('stop');
	});

	it("maps 'stop_sequence' to 'stop'", () => {
		expect(mapFinishReason('stop_sequence')).toBe('stop');
	});

	it("maps 'max_tokens' to 'length'", () => {
		expect(mapFinishReason('max_tokens')).toBe('length');
	});

	it("maps 'tool_use' to 'tool-calls'", () => {
		expect(mapFinishReason('tool_use')).toBe('tool-calls');
	});

	it("maps unknown values to 'other'", () => {
		expect(mapFinishReason('something_new')).toBe('other');
		expect(mapFinishReason(null)).toBe('other');
	});
});
