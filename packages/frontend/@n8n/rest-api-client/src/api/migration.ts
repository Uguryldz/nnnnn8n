import type { IRestApiContext } from '../types';
import { post } from '../utils';

export type PublishToAzureResult = { ok: true; blobName: string };

export async function publishMigrationToAzure(
	context: IRestApiContext,
	workflowId: string,
): Promise<PublishToAzureResult> {
	const response = await post(context.baseUrl, '/migration/publish-azure', { workflowId });
	return (response as { data: PublishToAzureResult }).data;
}

export async function publishDataTableToAzure(
	context: IRestApiContext,
	dataTableId: string,
): Promise<PublishToAzureResult> {
	const response = await post(context.baseUrl, '/migration/publish-azure-data-table', {
		dataTableId,
	});
	return (response as { data: PublishToAzureResult }).data;
}
