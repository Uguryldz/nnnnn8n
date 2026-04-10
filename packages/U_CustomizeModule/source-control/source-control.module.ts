import type { ModuleInterface } from '@n8n/decorators';
import { BackendModule } from '@n8n/decorators';
import { Container } from '@n8n/di';

@BackendModule({
	name: 'source-control',
	instanceTypes: ['main'],
})
export class SourceControlModule implements ModuleInterface {
	async init() {
		await import('../source-control.ee/source-control.controller.ee');

		const { SourceControlService } = await import('../source-control.ee/source-control.service.ee');
		await Container.get(SourceControlService).start();
	}
}
