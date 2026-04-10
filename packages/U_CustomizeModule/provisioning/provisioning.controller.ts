import { AuthenticatedRequest } from '@n8n/db';
import { Get, GlobalScope, Patch, RestController } from '@n8n/decorators';

import { CustomProvisioningService } from './provisioning.service';

@RestController('/sso/provisioning')
export class ProvisioningController {
	constructor(private readonly svc: CustomProvisioningService) {}

	@Get('/config')
	@GlobalScope('provisioning:manage')
	async getConfig() {
		return await this.svc.getConfig();
	}

	@Patch('/config')
	@GlobalScope('provisioning:manage')
	async patchConfig(req: AuthenticatedRequest) {
		return await this.svc.patchConfig(req.body);
	}
}
