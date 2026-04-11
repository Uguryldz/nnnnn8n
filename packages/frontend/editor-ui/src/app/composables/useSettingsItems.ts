import { useRouter } from 'vue-router';
import { useUserHelpers } from './useUserHelpers';
import { computed } from 'vue';
import type { IMenuItem } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { VIEWS } from '../constants';
import { useUIStore } from '../stores/ui.store';
import { useSettingsStore } from '../stores/settings.store';
import { hasPermission } from '../utils/rbac/permissions';
import { MIGRATION_REPORT_TARGET_VERSION } from '@n8n/api-types';
import { usePostHog } from '../stores/posthog.store';
import { AI_GATEWAY_EXPERIMENT } from '../constants/experiments';

export function useSettingsItems() {
	const router = useRouter();
	const i18n = useI18n();
	const uiStore = useUIStore();
	const settingsStore = useSettingsStore();
	const { canUserAccessRouteByName } = useUserHelpers(router);
	const postHogStore = usePostHog();

	const settingsItems = computed<IMenuItem[]>(() => {
		const menuItems: IMenuItem[] = [
			{
				id: 'settings-personal',
				icon: 'circle-user-round',
				label: i18n.baseText('settings.personal'),
				position: 'top',
				available: canUserAccessRouteByName(VIEWS.PERSONAL_SETTINGS),
				route: { to: { name: VIEWS.PERSONAL_SETTINGS } },
			},
			{
				id: 'settings-users',
				icon: 'user-round',
				label: i18n.baseText('settings.users'),
				position: 'top',
				available: canUserAccessRouteByName(VIEWS.USERS_SETTINGS),
				route: { to: { name: VIEWS.USERS_SETTINGS } },
			},
			{
				id: 'settings-ai',
				icon: 'sparkles',
				label: i18n.baseText('settings.ai'),
				position: 'top',
				available:
					settingsStore.isAiAssistantEnabled && canUserAccessRouteByName(VIEWS.AI_SETTINGS),
				route: { to: { name: VIEWS.AI_SETTINGS } },
			},
			{
				id: 'settings-n8n-gateway',
				icon: 'network',
				label: i18n.baseText('settings.n8nGateway'),
				position: 'top',
				available:
					postHogStore.getVariant(AI_GATEWAY_EXPERIMENT.name) === AI_GATEWAY_EXPERIMENT.variant &&
					settingsStore.isAiGatewayEnabled &&
					canUserAccessRouteByName(VIEWS.AI_GATEWAY_SETTINGS),
				route: { to: { name: VIEWS.AI_GATEWAY_SETTINGS } },
			},
			{
				id: 'settings-project-roles',
				icon: 'user-round',
				label: i18n.baseText('settings.projectRoles'),
				position: 'top',
				available: canUserAccessRouteByName(VIEWS.PROJECT_ROLES_SETTINGS),
				route: { to: { name: VIEWS.PROJECT_ROLES_SETTINGS } },
				new: true,
			},
			{
				id: 'settings-api',
				icon: 'plug',
				label: i18n.baseText('settings.n8napi'),
				position: 'top',
				available: settingsStore.isPublicApiEnabled && canUserAccessRouteByName(VIEWS.API_SETTINGS),
				route: { to: { name: VIEWS.API_SETTINGS } },
			},
			// external-secrets hidden
			{
				id: 'settings-credential-resolvers',
				icon: 'key-round',
				label: i18n.baseText('credentialResolver.view.title'),
				position: 'top',
				available: canUserAccessRouteByName(VIEWS.RESOLVERS),
				route: { to: { name: VIEWS.RESOLVERS } },
			},
			{
				id: 'settings-source-control',
				icon: 'git-branch',
				label: i18n.baseText('settings.sourceControl.title'),
				position: 'top',
				available: canUserAccessRouteByName(VIEWS.SOURCE_CONTROL),
				route: { to: { name: VIEWS.SOURCE_CONTROL } },
			},
			// sso hidden
			{
				id: 'settings-security',
				icon: 'shield',
				label: i18n.baseText('settings.security'),
				position: 'top',
				available: canUserAccessRouteByName(VIEWS.SECURITY_SETTINGS),
				route: { to: { name: VIEWS.SECURITY_SETTINGS } },
			},
			{
				id: 'settings-ldap',
				icon: 'network',
				label: i18n.baseText('settings.ldap'),
				position: 'top',
				available: canUserAccessRouteByName(VIEWS.LDAP_SETTINGS),
				route: { to: { name: VIEWS.LDAP_SETTINGS } },
			},
			{
				id: 'settings-workersview',
				icon: 'waypoints',
				label: i18n.baseText('mainSidebar.workersView'),
				position: 'top',
				available:
					settingsStore.isQueueModeEnabled &&
					hasPermission(['rbac'], { rbac: { scope: 'workersView:manage' } }),
				route: { to: { name: VIEWS.WORKER_VIEW } },
			},
		];

		// log-streaming hidden

		menuItems.push({
			id: 'settings-community-nodes',
			icon: 'box',
			label: i18n.baseText('settings.communityNodes'),
			position: 'top',
			available: canUserAccessRouteByName(VIEWS.COMMUNITY_NODES),
			route: { to: { name: VIEWS.COMMUNITY_NODES } },
		});

		if (MIGRATION_REPORT_TARGET_VERSION) {
			menuItems.push({
				id: 'settings-migration-report',
				icon: 'list-checks',
				label: i18n.baseText('settings.migrationReport'),
				position: 'top',
				available: canUserAccessRouteByName(VIEWS.MIGRATION_REPORT),
				route: { to: { name: VIEWS.MIGRATION_REPORT } },
			});
		}

		// Append module-registered settings sidebar items (excluding hidden modules).
		const hiddenModuleIds = new Set(['settings-chat', 'settings-chat-hub', 'chat-hub', 'chat']);
		const moduleItems = uiStore.settingsSidebarItems.filter(
			(item) => !hiddenModuleIds.has(item.id) && !item.id.includes('chat'),
		);

		return menuItems.concat(moduleItems.filter((item) => !menuItems.some((m) => m.id === item.id)));
	});

	const visibleSettingsItems = computed(() => settingsItems.value.filter((item) => item.available));

	return { settingsItems: visibleSettingsItems };
}
