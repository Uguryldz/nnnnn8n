import {
	CreateRoleMappingRuleDto,
	ListRoleMappingRuleQueryDto,
	MoveRoleMappingRuleDto,
	PatchRoleMappingRuleDto,
} from '@n8n/api-types';
import { AuthenticatedRequest } from '@n8n/db';
import {
	Body,
	Delete,
	Get,
	GlobalScope,
	Param,
	Patch,
	Post,
	Query,
	RestController,
} from '@n8n/decorators';

import type {
	RoleMappingRuleListResponse,
	RoleMappingRuleResponse,
} from '../provisioning.ee/role-mapping-rule.service.ee';
import { RoleMappingRuleService } from '../provisioning.ee/role-mapping-rule.service.ee';

@RestController('/role-mapping-rule')
export class RoleMappingRuleController {
	constructor(private readonly roleMappingRuleService: RoleMappingRuleService) {}

	@Get('/')
	@GlobalScope('roleMappingRule:list')
	async list(
		@Query query: ListRoleMappingRuleQueryDto,
	): Promise<RoleMappingRuleListResponse> {
		return await this.roleMappingRuleService.list(query);
	}

	@Post('/')
	@GlobalScope('roleMappingRule:create')
	async create(
		@Body body: CreateRoleMappingRuleDto,
	): Promise<RoleMappingRuleResponse> {
		return await this.roleMappingRuleService.create(body);
	}

	@Post('/:id/move')
	@GlobalScope('roleMappingRule:update')
	async move(
		@Body body: MoveRoleMappingRuleDto,
		@Param('id') id: string,
	): Promise<RoleMappingRuleResponse> {
		return await this.roleMappingRuleService.move(id, body.targetIndex);
	}

	@Patch('/:id')
	@GlobalScope('roleMappingRule:update')
	async patch(
		@Body body: PatchRoleMappingRuleDto,
		@Param('id') id: string,
	): Promise<RoleMappingRuleResponse> {
		return await this.roleMappingRuleService.patch(id, body);
	}

	@Delete('/:id')
	@GlobalScope('roleMappingRule:delete')
	async delete(
		@Param('id') id: string,
	): Promise<{ success: true }> {
		await this.roleMappingRuleService.delete(id);
		return { success: true };
	}
}
