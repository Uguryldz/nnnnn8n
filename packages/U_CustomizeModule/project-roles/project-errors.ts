import { UserError } from 'n8n-workflow';
import type { AssignableProjectRole } from '@n8n/permissions';

export class TeamProjectOverQuotaError extends UserError {
	constructor(limit: number) {
		super(
			`Attempted to create a new project but quota is already exhausted. You may have a maximum of ${limit} team projects.`,
		);
	}
}

export class UnlicensedProjectRoleError extends UserError {
	constructor(role: AssignableProjectRole) {
		super(`Your instance is not licensed to use role "${role}".`);
	}
}
