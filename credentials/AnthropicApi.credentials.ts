import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class AnthropicApi implements ICredentialType {
	name = 'anthropicApi';

	displayName = 'Anthropic API';

	icon: Icon = {
		light: 'file:../icons/anthropic.svg',
		dark: 'file:../icons/anthropic.dark.svg',
	};

	documentationUrl = 'https://docs.claude.com/en/api/getting-started';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Anthropic API key. Generate one at console.anthropic.com',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials?.apiKey}}',
				'anthropic-version': '2023-06-01',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.anthropic.com',
			url: '/v1/models',
			method: 'GET',
		},
	};
}
