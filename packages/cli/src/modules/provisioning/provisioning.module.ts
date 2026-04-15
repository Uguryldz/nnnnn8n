import type { ModuleInterface } from '@n8n/decorators';
import { BackendModule } from '@n8n/decorators';
import { LicenseState } from '@n8n/backend-common';
import { Container } from '@n8n/di';
import { License } from '@/license';

@BackendModule({
	name: 'provisioning',
	instanceTypes: ['main'],
})
export class ProvisioningModule implements ModuleInterface {
	async init() {
		await import('./provisioning.controller');
		await import('./provisioning.service');
		await import('./role-mapping-rule.controller');
		await import('./role-mapping-rule.service');

		// Runtime override: enable features without modifying license files
		const ls = Container.get(LicenseState);

		// Quotas
		ls.getMaxTeamProjects = () => -1;
		ls.getMaxVariables = () => -1;

		// Features we activated
		ls.isSharingLicensed = () => true;
		ls.isLdapLicensed = () => true;
		ls.isCustomRolesLicensed = () => true;
		ls.isAdvancedPermissionsLicensed = () => true;
		ls.isProjectRoleAdminLicensed = () => true;
		ls.isProjectRoleEditorLicensed = () => true;
		ls.isProjectRoleViewerLicensed = () => true;
		ls.isVariablesLicensed = () => true;
		ls.isSourceControlLicensed = () => true;
		ls.isDataRedactionLicensed = () => true;
		ls.isWorkflowDiffsLicensed = () => true;
		ls.isAdvancedExecutionFiltersLicensed = () => true;
		ls.isDebugInEditorLicensed = () => true;
		ls.isBinaryDataS3Licensed = () => true;
		ls.isWorkerViewLicensed = () => true;
		ls.isFoldersLicensed = () => true;
		ls.isPersonalSpacePolicyLicensed = () => true;
		ls.isProvisioningLicensed = () => true;

		// Override deprecated License class methods used by some services
		const lic = Container.get(License);
		const origIsLicensed = lic.isLicensed.bind(lic);
		const alwaysLicensedFeatures = new Set([
			'feat:sharing',
			'feat:ldap',
			'feat:variables',
			'feat:sourceControl',
			'feat:customRoles',
			'feat:advancedPermissions',
			'feat:advancedExecutionFilters',
			'feat:debugInEditor',
			'feat:binaryDataS3',
			'feat:workerView',
			'feat:workflowDiffs',
			'feat:namedVersions',
			'feat:personalSpacePolicy',
			'feat:dataRedaction',
			'feat:folders',
			'feat:projectRole:admin',
			'feat:projectRole:editor',
			'feat:projectRole:viewer',
		]);
		lic.isLicensed = (feature: string) =>
			alwaysLicensedFeatures.has(feature) || origIsLicensed(feature);
		lic.isSharingEnabled = () => true;
		lic.isLdapEnabled = () => true;
		lic.isVariablesEnabled = () => true;
		lic.isAdvancedExecutionFiltersEnabled = () => true;
		lic.isAdvancedPermissionsLicensed = () => true;
		lic.isSourceControlLicensed = () => true;
		lic.isBinaryDataS3Licensed = () => true;
		lic.isDebugInEditorLicensed = () => true;
		lic.isWorkerViewLicensed = () => true;
		lic.isFoldersEnabled = () => true;
		lic.getTeamProjectLimit = () => -1;
		lic.getUsersLimit = () => -1;
		lic.isWithinUsersLimit = () => true;
		lic.isCustomNpmRegistryEnabled = () => true;
		lic.getWorkflowHistoryPruneLimit = () => -1;
	}
}
