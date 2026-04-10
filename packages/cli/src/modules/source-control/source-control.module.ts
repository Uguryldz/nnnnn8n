import type { ModuleInterface } from '@n8n/decorators';
import { BackendModule } from '@n8n/decorators';

@BackendModule({
	name: 'source-control',
	instanceTypes: ['main'],
})
export class SourceControlModule implements ModuleInterface {
	async init() {
		// Source control requires 2000+ lines of git/file services that are
		// entirely in .ee files. A full cleanroom rewrite is pending.
		// Module is registered but inactive to keep the codebase .ee-free.
	}
}
