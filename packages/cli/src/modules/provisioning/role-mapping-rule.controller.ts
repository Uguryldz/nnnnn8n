import {
	CreateRoleMappingRuleDto,
	ListRoleMappingRuleQueryDto,
	MoveRoleMappingRuleDto,
	PatchRoleMappingRuleDto,
} from '@n8n/api-types';
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

import type { RuleMappingList, RuleMappingItem } from './role-mapping-rule.service';
import { CustomRoleMappingRuleService } from './role-mapping-rule.service';

@RestController('/role-mapping-rule')
export class RoleMappingRuleController {
	constructor(private readonly svc: CustomRoleMappingRuleService) {}

	@Get('/')
	@GlobalScope('roleMappingRule:list')
	async list(@Query query: ListRoleMappingRuleQueryDto): Promise<RuleMappingList> {
		return await this.svc.list(query);
	}

	@Post('/')
	@GlobalScope('roleMappingRule:create')
	async create(@Body body: CreateRoleMappingRuleDto): Promise<RuleMappingItem> {
		return await this.svc.create(body);
	}

	@Post('/:id/move')
	@GlobalScope('roleMappingRule:update')
	async move(@Body body: MoveRoleMappingRuleDto, @Param('id') id: string): Promise<RuleMappingItem> {
		return await this.svc.move(id, body.targetIndex);
	}

	@Patch('/:id')
	@GlobalScope('roleMappingRule:update')
	async patch(@Body body: PatchRoleMappingRuleDto, @Param('id') id: string): Promise<RuleMappingItem> {
		return await this.svc.patch(id, body);
	}

	@Delete('/:id')
	@GlobalScope('roleMappingRule:delete')
	async remove(@Param('id') id: string): Promise<{ success: true }> {
		await this.svc.remove(id);
		return { success: true };
	}
}
