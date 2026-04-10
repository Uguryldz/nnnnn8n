import type { User } from '@n8n/db';
import { ProjectRepository, Project } from '@n8n/db';
import { Container } from '@n8n/di';
import { hasGlobalScope, type Scope } from '@n8n/permissions';
import { In, type FindOptionsWhere } from '@n8n/typeorm';

import { RoleService } from '@/services/role.service';

export async function findProjectWithAccess(
	user: User,
	projectId: string,
	scopes: Scope[],
): Promise<Project | null> {
	const repo = Container.get(ProjectRepository);
	const where: FindOptionsWhere<Project> = { id: projectId };

	if (!hasGlobalScope(user, scopes, { mode: 'allOf' })) {
		const allowed = await Container.get(RoleService).rolesWithScope('project', scopes);
		where.projectRelations = { role: In(allowed), userId: user.id };
	}

	return await repo.findOne({ where });
}

export async function findAccessibleProjectIds(
	user: User,
	scopes: Scope[],
): Promise<string[]> {
	const repo = Container.get(ProjectRepository);
	const where: FindOptionsWhere<Project> = {};

	if (!hasGlobalScope(user, scopes, { mode: 'allOf' })) {
		const allowed = await Container.get(RoleService).rolesWithScope('project', scopes);
		where.type = 'team';
		where.projectRelations = { role: In(allowed), userId: user.id };
	}

	const projects = await repo.find({ where, select: ['id'] });
	return projects.map((p) => p.id);
}
