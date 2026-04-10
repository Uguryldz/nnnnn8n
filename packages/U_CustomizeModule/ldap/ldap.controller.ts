import { Get, Post, Put, RestController, GlobalScope } from '@n8n/decorators';
import pick from 'lodash/pick';

import { BadRequestError } from '@/errors/response-errors/bad-request.error';
import { EventService } from '@/events/event.service';

import { NON_SENSIBLE_LDAP_CONFIG_PROPERTIES } from './constants';
import { LdapService } from './ldap.service';
import { LdapConfiguration } from './types';

@RestController('/ldap')
export class LdapController {
	constructor(
		private readonly svc: LdapService,
		private readonly events: EventService,
	) {}

	@Get('/config')
	@GlobalScope('ldap:manage')
	async config() {
		return await this.svc.fetchConfig();
	}

	@Post('/test-connection')
	@GlobalScope('ldap:manage')
	async test() {
		try { await this.svc.verifyConnection(); }
		catch (e) { throw new BadRequestError((e as Error).message); }
	}

	@Put('/config')
	@GlobalScope('ldap:manage')
	async save(req: LdapConfiguration.Update) {
		try { await this.svc.persistConfig(req.body); }
		catch (e) { throw new BadRequestError((e as Error).message); }

		const result = await this.svc.fetchConfig();
		this.events.emit('ldap-settings-updated', {
			userId: req.user.id,
			...pick(result, NON_SENSIBLE_LDAP_CONFIG_PROPERTIES),
		});
		return result;
	}

	@Get('/sync')
	@GlobalScope('ldap:sync')
	async history(req: LdapConfiguration.GetSync) {
		const { page = '0', perPage = '20' } = req.query;
		return await this.svc.getSyncHistory(parseInt(page, 10), parseInt(perPage, 10));
	}

	@Post('/sync')
	@GlobalScope('ldap:sync')
	async sync(req: LdapConfiguration.Sync) {
		try { await this.svc.runSync(req.body.type); }
		catch (e) { throw new BadRequestError((e as Error).message); }
	}
}
