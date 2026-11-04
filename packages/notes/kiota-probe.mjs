import { DefaultRequestAdapter } from '@microsoft/kiota-bundle';
import { createGraphServiceClient } from '@microsoft/msgraph-sdk';
import '@microsoft/msgraph-sdk-users';
const adapter = new DefaultRequestAdapter({ getAuthorizationToken: async () => 'x' });
const client = createGraphServiceClient(adapter);
console.log('ok', typeof client.me);

