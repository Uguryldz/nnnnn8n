import type { ModuleInterface } from '@n8n/decorators';
import { BackendModule } from '@n8n/decorators';

@BackendModule({
	name: 'provisioning',
	instanceTypes: ['main'],
})
export class ProvisioningModule implements ModuleInterface {
	async init() {
		await import('./provisioning.controller');
		await import('./provisioning.service');
		await import('./role-mapping-rule.controller');
		await import('./role-mapping-rule.service');
	}
}
