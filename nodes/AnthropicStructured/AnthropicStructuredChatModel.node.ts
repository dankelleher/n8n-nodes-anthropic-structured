/* eslint-disable @n8n/community-nodes/node-usable-as-tool -- this is an AI language model sub-node, not an action node; auto-wrapping it as a tool would be nonsensical */
import { supplyModel } from '@n8n/ai-node-sdk';
import type {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { StructuredAnthropicModel } from './StructuredAnthropicModel';

interface AnthropicCredentials {
	apiKey: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-5';

const MODEL_CHOICES = [
	{ name: 'Claude Opus 4.7', value: 'claude-opus-4-7' },
	{ name: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
	{ name: 'Claude Opus 4.5', value: 'claude-opus-4-5' },
	{ name: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
	{ name: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5' },
	{ name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
];

/**
 * Anthropic Chat Model with constrained-decoding structured outputs.
 *
 * Drops into the AI Agent's `ai_languageModel` slot exactly like n8n's
 * built-in Anthropic model — but exposes Anthropic's `output_config.format`
 * API as a `JSON Schema` parameter. When set, every response is guaranteed
 * to be schema-conformant by construction. When not set, behaves like a
 * normal chat model.
 */
export class AnthropicStructuredChatModel implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Anthropic (Structured)',
		name: 'anthropicStructuredChatModel',
		icon: {
			light: 'file:../../icons/anthropic.svg',
			dark: 'file:../../icons/anthropic.dark.svg',
		},
		group: ['transform'],
		version: 1,
		description:
			'Anthropic Claude with Anthropic-side structured outputs. Set a JSON Schema and the model is guaranteed to return schema-conformant JSON.',
		subtitle: '={{$parameter["model"]}}',
		defaults: {
			name: 'Anthropic (Structured)',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models'],
				'Language Models': ['Chat Models (Recommended)'],
			},
			resources: {
				primaryDocumentation: [
					{ url: 'https://docs.claude.com/en/build-with-claude/structured-outputs' },
				],
			},
		},
		credentials: [
			{
				name: 'anthropicApi',
				required: true,
			},
		],
		inputs: [],
		outputs: [
			{
				type: NodeConnectionTypes.AiLanguageModel,
				displayName: 'Model',
			},
		],
		properties: [
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: MODEL_CHOICES,
				default: DEFAULT_MODEL,
				description: 'The Claude model to use. Constrained decoding is supported on Claude 4.5+.',
			},
			{
				displayName: 'JSON Schema',
				name: 'jsonSchema',
				type: 'json',
				default: '',
				placeholder: '{\n  "type": "object",\n  "properties": { ... }\n}',
				description:
					'Optional JSON Schema. When set, Anthropic returns schema-conformant JSON via constrained decoding. Leave empty for normal chat behaviour.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Maximum Number of Tokens',
						name: 'maxTokens',
						type: 'number',
						default: 4096,
						description: 'Maximum tokens in the response',
					},
					{
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
						default: 0.7,
						description: 'Sampling temperature (0–1)',
					},
					{
						displayName: 'Top P',
						name: 'topP',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
						default: 1,
						description: 'Nucleus sampling parameter',
					},
					{
						displayName: 'Top K',
						name: 'topK',
						type: 'number',
						default: 0,
						description: 'Top-K sampling parameter (0 disables)',
					},
				],
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials<AnthropicCredentials>('anthropicApi');
		const modelId = this.getNodeParameter('model', itemIndex, DEFAULT_MODEL) as string;
		const jsonSchemaRaw = this.getNodeParameter('jsonSchema', itemIndex, '') as
			| string
			| Record<string, unknown>;
		const options = this.getNodeParameter('options', itemIndex, {}) as Record<string, unknown>;

		const jsonSchema = parseJsonSchema(jsonSchemaRaw, this.getNode.bind(this), itemIndex);

		const model = new StructuredAnthropicModel(credentials.apiKey, modelId, {
			maxTokens: typeof options.maxTokens === 'number' ? options.maxTokens : undefined,
			temperature: typeof options.temperature === 'number' ? options.temperature : undefined,
			topP: typeof options.topP === 'number' ? options.topP : undefined,
			topK: typeof options.topK === 'number' && options.topK > 0 ? options.topK : undefined,
			jsonSchema,
		});

		return supplyModel(this, model);
	}
}

const parseJsonSchema = (
	raw: string | Record<string, unknown>,
	getNode: () => ReturnType<ISupplyDataFunctions['getNode']>,
	itemIndex: number,
): Record<string, unknown> | undefined => {
	if (!raw) return undefined;
	if (typeof raw === 'object') return raw;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;
		return parsed;
	} catch (err) {
		throw new NodeOperationError(
			getNode(),
			`Invalid JSON Schema: ${(err as Error).message}`,
			{ itemIndex },
		);
	}
};
