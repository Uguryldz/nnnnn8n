import { ProvisioningConfigDto, ProvisioningConfigPatchDto } from '@n8n/api-types';
import { Logger } from '@n8n/backend-common';
import { SettingsRepository } from '@n8n/db';
import { Service } from '@n8n/di';
import { jsonParse } from 'n8n-workflow';
import { BadRequestError } from '@/errors/response-errors/bad-request.error';
import { ZodError } from 'zod';

const CONFIG_KEY = 'features.provisioning';

const DEFAULT_CONFIG: ProvisioningConfigDto = ProvisioningConfigDto.parse({
	scopesProvisionInstanceRole: false,
	scopesProvisionProjectRoles: false,
	scopesName: '',
	scopesInstanceRoleClaimName: '',
	scopesProjectsRolesClaimName: '',
	scopesUseExpressionMapping: false,
});

@Service()
export class CustomProvisioningService {
	private cached: ProvisioningConfigDto | undefined;

	constructor(
		private readonly logger: Logger,
		private readonly settings: SettingsRepository,
	) {}

	async getConfig(): Promise<ProvisioningConfigDto> {
		if (!this.cached) this.cached = await this.load();
		return this.cached;
	}

	async patchConfig(raw: unknown): Promise<ProvisioningConfigDto> {
		let patch: ProvisioningConfigPatchDto;
		try {
			patch = ProvisioningConfigPatchDto.parse(raw);
		} catch (e) {
			if (e instanceof ZodError) throw new BadRequestError(e.message);
			throw e;
		}

		const current = await this.getConfig();
		const merged = { ...current, ...patch } as ProvisioningConfigDto;

		ProvisioningConfigDto.parse(merged);

		await this.settings.upsert(
			{ key: CONFIG_KEY, value: JSON.stringify(merged), loadOnStartup: true },
			{ conflictPaths: ['key'] },
		);

		this.cached = await this.load();
		return this.cached;
	}

	private async load(): Promise<ProvisioningConfigDto> {
		const row = await this.settings.findByKey(CONFIG_KEY);
		if (!row) return DEFAULT_CONFIG;
		try {
			return ProvisioningConfigDto.parse(jsonParse(row.value));
		} catch {
			this.logger.warn('Invalid provisioning config in DB, using defaults');
			return DEFAULT_CONFIG;
		}
	}
}
