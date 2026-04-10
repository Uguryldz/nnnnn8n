import {
	CreateRoleMappingRuleDto,
	type ListRoleMappingRuleQueryInput,
	type PatchRoleMappingRuleInput,
} from '@n8n/api-types';
import {
	ProjectRepository,
	RoleMappingRule,
	RoleMappingRuleRepository,
	RoleRepository,
	type Role,
} from '@n8n/db';
import { Service } from '@n8n/di';
import { In, type FindOptionsOrder } from '@n8n/typeorm';
import type { z } from 'zod';

import { BadRequestError } from '@/errors/response-errors/bad-request.error';
import { ConflictError } from '@/errors/response-errors/conflict.error';
import { NotFoundError } from '@/errors/response-errors/not-found.error';

type RuleInput = z.infer<(typeof CreateRoleMappingRuleDto)['schema']>;
type RuleKind = 'instance' | 'project';

export type RuleMappingItem = {
	id: string;
	expression: string;
	role: string;
	type: RuleKind;
	order: number;
	projectIds: string[];
	createdAt: string;
	updatedAt: string;
};

export type RuleMappingList = { count: number; items: RuleMappingItem[] };

@Service()
export class CustomRoleMappingRuleService {
	constructor(
		private readonly rules: RoleMappingRuleRepository,
		private readonly roles: RoleRepository,
		private readonly projects: ProjectRepository,
	) {}

	async list(q: ListRoleMappingRuleQueryInput): Promise<RuleMappingList> {
		const [field, dir] = (q.sortBy ?? 'order:asc').split(':') as [string, string];
		const direction = dir === 'desc' ? 'DESC' : 'ASC';
		const orderMap: Record<string, FindOptionsOrder<RoleMappingRule>> = {
			createdAt: { createdAt: direction, id: 'ASC' },
			updatedAt: { updatedAt: direction, id: 'ASC' },
		};

		const [rows, total] = await this.rules.findAndCount({
			where: q.type ? { type: q.type } : {},
			relations: ['projects', 'role'],
			order: orderMap[field] ?? { order: direction, id: 'ASC' },
			skip: q.skip,
			take: q.take,
		});

		return { count: total, items: rows.map((r) => this.serialize(r)) };
	}

	async create(dto: RuleInput): Promise<RuleMappingItem> {
		const pids = this.resolveProjectIds(dto.type, dto.projectIds, []);
		const role = await this.requireRole(dto.role);
		this.validateRoleKind(role, dto.type);
		await this.ensureOrderSlotFree(dto.type, dto.order);

		const linked = pids.length ? await this.projects.findBy({ id: In(pids) }) : [];
		if (linked.length !== pids.length) throw new BadRequestError('One or more projects not found');

		const entity = Object.assign(new RoleMappingRule(), {
			expression: dto.expression, role, type: dto.type, order: dto.order, projects: linked,
		});

		const saved = await this.rules.save(entity);
		await this.reindex(dto.type);

		return this.serialize(
			await this.rules.findOneOrFail({ where: { id: saved.id }, relations: ['projects', 'role'] }),
		);
	}

	async patch(id: string, dto: PatchRoleMappingRuleInput): Promise<RuleMappingItem> {
		if (!id) throw new BadRequestError('Rule id required');
		if (!dto || !Object.keys(dto).length) throw new BadRequestError('At least one field required');

		const rule = await this.rules.findOne({ where: { id }, relations: ['projects', 'role'] });
		if (!rule) throw new NotFoundError('Rule not found');

		const origKind = rule.type as RuleKind;
		const kind = (dto.type ?? origKind) as RuleKind;
		const slug = dto.role ?? rule.role.slug;

		const role = slug === rule.role.slug
			? rule.role
			: await this.requireRole(slug);
		this.validateRoleKind(role, kind);

		const order = dto.order ?? rule.order;
		await this.ensureOrderSlotFree(kind, order, id);

		const pids = this.resolveProjectIds(kind, dto.projectIds, rule.projects.map((p) => p.id));
		const linked = pids.length ? await this.projects.findBy({ id: In(pids) }) : [];
		if (linked.length !== pids.length) throw new BadRequestError('One or more projects not found');

		Object.assign(rule, {
			expression: dto.expression ?? rule.expression,
			role, type: kind, order, projects: linked,
		});

		await this.rules.save(rule);
		await this.reindex(kind);
		if (origKind !== kind) await this.reindex(origKind);

		return this.serialize(
			await this.rules.findOneOrFail({ where: { id }, relations: ['projects', 'role'] }),
		);
	}

	async remove(id: string) {
		if (!id) throw new BadRequestError('Rule id required');
		const rule = await this.rules.findOne({ where: { id } });
		if (!rule) throw new NotFoundError('Rule not found');
		const kind = rule.type as RuleKind;
		await this.rules.remove(rule);
		await this.reindex(kind);
	}

	async move(id: string, target: number): Promise<RuleMappingItem> {
		if (!id) throw new BadRequestError('Rule id required');
		const rule = await this.rules.findOne({ where: { id }, relations: ['projects', 'role'] });
		if (!rule) throw new NotFoundError('Rule not found');

		const kind = rule.type as RuleKind;
		const all = await this.rules.find({ where: { type: kind }, select: ['id', 'order'], order: { order: 'ASC' } });

		const from = all.findIndex((r) => r.id === id);
		const to = Math.min(target, all.length - 1);
		const reordered = [...all];
		reordered.splice(from, 1);
		reordered.splice(to, 0, all[from]);

		await this.writeOrder(reordered.map((r) => r.id));

		return this.serialize(
			await this.rules.findOneOrFail({ where: { id }, relations: ['projects', 'role'] }),
		);
	}

	// ── helpers ──

	private async requireRole(slug: string) {
		const r = await this.roles.findOne({ where: { slug } });
		if (!r) throw new NotFoundError(`Role "${slug}" not found`);
		return r;
	}

	private validateRoleKind(role: Role, kind: RuleKind) {
		if (kind === 'instance' && role.roleType !== 'global')
			throw new BadRequestError('Instance rules require a global role');
		if (kind === 'project' && role.roleType !== 'project')
			throw new BadRequestError('Project rules require a project role');
	}

	private resolveProjectIds(kind: RuleKind, explicit: string[] | undefined, fallback: string[]): string[] {
		if (kind === 'instance') {
			if (explicit?.length) throw new BadRequestError('projectIds must be empty for instance rules');
			return [];
		}
		const ids = [...new Set(explicit ?? fallback)];
		if (!ids.length) throw new BadRequestError('projectIds required for project rules');
		return ids;
	}

	private async ensureOrderSlotFree(kind: RuleKind, order: number, excludeId?: string) {
		const existing = await this.rules.findOne({ where: { type: kind, order } });
		if (existing && existing.id !== excludeId) {
			throw new ConflictError(`Order ${order} already taken for type "${kind}"`);
		}
	}

	private async reindex(kind: RuleKind) {
		const all = await this.rules.find({ where: { type: kind }, select: ['id', 'order'], order: { order: 'ASC' } });
		if (!all.length || all.every((r, i) => r.order === i)) return;
		await this.writeOrder(all.map((r) => r.id));
	}

	private async writeOrder(ids: string[]) {
		if (!ids.length) return;
		await this.rules.manager.transaction(async (tx) => {
			const base = ids.length + 1000;
			for (let i = 0; i < ids.length; i++) await tx.update(RoleMappingRule, { id: ids[i] }, { order: base + i });
			for (let i = 0; i < ids.length; i++) await tx.update(RoleMappingRule, { id: ids[i] }, { order: i });
		});
	}

	private serialize(r: RoleMappingRule): RuleMappingItem {
		return {
			id: r.id, expression: r.expression, role: r.role.slug,
			type: r.type as RuleKind, order: r.order,
			projectIds: r.projects.map((p) => p.id),
			createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
		};
	}
}
