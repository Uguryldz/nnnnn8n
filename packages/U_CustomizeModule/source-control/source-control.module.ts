import type { ModuleInterface } from '@n8n/decorators';
import { BackendModule } from '@n8n/decorators';
import { Container } from '@n8n/di';

@BackendModule({
	name: 'source-control',
	instanceTypes: ['main'],
})
export class SourceControlModule implements ModuleInterface {
	async init() {
		// Source control requires complex git/file services from the .ee package.
		// Full cleanroom rewrite of those services is pending — for now we bootstrap
		// the existing implementation without the license gate.
		// NOTE: This is the only module that still loads .ee code at runtime.
		await import('../source-control.ee/source-control.controller.ee');

		const { SourceControlService } = await import('../source-control.ee/source-control.service.ee');
		await Container.get(SourceControlService).start();
	}
}
