import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../types/database.types';
import {assertV2SessionOwner,readV2OwnedProfileState} from '../../auth/accessGateClient.ts';
import {completedActivityLayoutPatch,readCompletedActivityLayouts,
 type CompletedActivityLayouts} from './completedActivityLayouts.ts';

export type CompletedActivityLayoutSnapshot={layouts:CompletedActivityLayouts;version:number};
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** Read owner-bound UI preferences without touching the canonical activity/metric store. */
export async function readOwnedCompletedActivityLayouts(
 client:SupabaseClient<Database>,owner:string,isCurrent:()=>boolean=()=>true,
):Promise<CompletedActivityLayoutSnapshot>{
 const state=await readV2OwnedProfileState(client,owner,isCurrent);
 const row=object(state.settings),version=row.version;
 if(typeof version!=='number'||!Number.isSafeInteger(version)||version<1)throw new Error('Current settings version is unavailable.');
 return {layouts:readCompletedActivityLayouts(row.settings),version};
}

/** Idempotent guarded save. A collision never overwrites newer preferences.
 * The caller must provide a stable actionId when retrying the exact same payload.
 */
export async function saveOwnedCompletedActivityLayouts(
 client:SupabaseClient<Database>,owner:string,
 input:{layouts:CompletedActivityLayouts;expectedVersion:number;actionId:string},
 isCurrent:()=>boolean=()=>true,
):Promise<CompletedActivityLayoutSnapshot>{
 if(!owner.trim()||!input.actionId.trim()||input.actionId.length>150)throw new Error('A valid owner and save action are required.');
 if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)throw new Error('A current settings version is required.');
 if(!isCurrent())throw new Error('The activity view is no longer active.');
 const patch=completedActivityLayoutPatch(input.layouts);
 await assertV2SessionOwner(client,owner);
 if(!isCurrent())throw new Error('The activity view is no longer active.');
 const {data,error}=await client.rpc('v2_patch_profile_settings_section',{
  p_expected_user_id:owner,p_section:'app_preferences',p_patch:patch,
  p_expected_version:input.expectedVersion,p_client_action_id:input.actionId,
 });
 if(error)throw error;
 if(typeof data!=='number'||!Number.isSafeInteger(data)||data<1)throw new Error('Could not verify layout save.');
 await assertV2SessionOwner(client,owner);
 if(!isCurrent())throw new Error('The activity view is no longer active.');
 const latest=await readOwnedCompletedActivityLayouts(client,owner,isCurrent);
 if(latest.version<data)throw new Error('Saved settings version could not be confirmed.');
 return latest;
}
