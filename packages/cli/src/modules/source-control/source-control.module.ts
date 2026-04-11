import type { ModuleInterface } from '@n8n/decorators';
import { BackendModule } from '@n8n/decorators';
import { Container } from '@n8n/di';

@BackendModule({
	name: 'source-control',
	instanceTypes: ['main'],
})
export class SourceControlModule implements ModuleInterface {
	async init() {
		await import('./sc.controller');
		await import('./sc-preferences.service');
		await import('./sc-git.service');

		const { SCPreferencesService } = await import('./sc-preferences.service');
		await Container.get(SCPreferencesService).loadFromDb();
	}
}
