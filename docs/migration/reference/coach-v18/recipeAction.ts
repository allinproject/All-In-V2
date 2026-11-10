export type RecipeActionContext={kind:string;object_id:string;working_state?:Record<string,unknown>|null};
export type RecipeProposedAction={version:1;kind:'recipe_my_version';label:string;payload:{scope:'save_my_version'|'update_my_version';source:'catalog';base_recipe_id:string;version_id?:string|null;expected_version?:number|null;title?:string|null;overrides:Record<string,unknown>;notes?:string|null}};
export type CookingCompletionProposedAction={version:1;kind:'cooking_completion';label:string;payload:{recipe_source:'catalog'|'personal';recipe_id:string;recipe_name:string;actual_servings?:number|null;adjustment_note?:string|null;ingredient_adjustment?:{scope:'all_servings'|'single_serving';ingredient:string;amount:number;unit:'oz'|'g'|'lb'}|null;meal_prep_plan_id?:string|null}};
export type RecoveryStretchProposedAction={version:1;kind:'recovery_stretch_plan';label:string;payload:{local_date:string;stretch_ids:string[];expected_version:number;rationale?:string|null}};
export type CoachProposedAction=RecipeProposedAction|CookingCompletionProposedAction|RecoveryStretchProposedAction;
export type CoachActionCapability={kind:CoachProposedAction['kind'];target_kind:'recipe'|'recovery';target_id:string;state_version:number|null;semantics:'review'|'preview_apply';owner:'recipe_my_version_writer'|'cooking_completion_review'|'recovery_stretch_plan_writer'};

const TEXT_LIMITS={label:120,title:240,notes:8000,version_id:180,recipe_name:240,rationale:500,ingredient:80,meal_prep_plan_id:180};
const OVERRIDE_KEYS=new Set(['servings','description','ingredients','cook_now_directions','meal_prep_directions','freezer_kit_directions','fridge_notes','freezer_notes','tags']);
const RECOVERY_STRETCH_IDS=new Set(['calf_stretch','hip_flexor_stretch','hamstring_stretch','quad_stretch','figure_four_stretch']);
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

export function eligibleRecipeActionContext(context:unknown):RecipeActionContext|null{
 if(!context||typeof context!=='object'||Array.isArray(context))return null;
 const c=context as Record<string,unknown>;
 const objectId=typeof c.object_id==='string'?c.object_id.trim():'';
 const state=c.working_state&&typeof c.working_state==='object'&&!Array.isArray(c.working_state)?c.working_state as Record<string,unknown>:null;
 if(c.kind!=='recipe'||!objectId||state?.recipe_source!=='catalog')return null;
 return {kind:'recipe',object_id:objectId,working_state:state};
}

function recipeContext(context:unknown):{objectId:string;source:'catalog'|'personal';workingState:Record<string,unknown>}|null{
 if(!context||typeof context!=='object'||Array.isArray(context))return null;const c=context as Record<string,unknown>;
 const objectId=typeof c.object_id==='string'?c.object_id.trim():'';const state=c.working_state&&typeof c.working_state==='object'&&!Array.isArray(c.working_state)?c.working_state as Record<string,unknown>:null;
 const source=state?.recipe_source;if(c.kind!=='recipe'||!objectId||(source!=='catalog'&&source!=='personal')||!state)return null;
 return {objectId,source,workingState:state};
}
function recoveryContext(context:unknown):{localDate:string;stateVersion:number}|null{
 if(!context||typeof context!=='object'||Array.isArray(context))return null;const c=context as Record<string,unknown>;if(c.kind!=='recovery')return null;
 const localDate=typeof c.local_date==='string'?c.local_date.trim():'';if(!DATE_RE.test(localDate))return null;
 const state=c.working_state&&typeof c.working_state==='object'&&!Array.isArray(c.working_state)?c.working_state as Record<string,unknown>:null;
 const rawVersion=c.state_version??state?.stretch_plan_version??0,stateVersion=Number(rawVersion);if(!Number.isInteger(stateVersion)||stateVersion<0)return null;
 return {localDate,stateVersion};
}

export function coachActionCapabilities(context:unknown):CoachActionCapability[]{
 const recipe=recipeContext(context);if(recipe){const capabilities:CoachActionCapability[]=[{kind:'cooking_completion',target_kind:'recipe',target_id:recipe.objectId,state_version:null,semantics:'review',owner:'cooking_completion_review'}];if(recipe.source==='catalog')capabilities.unshift({kind:'recipe_my_version',target_kind:'recipe',target_id:recipe.objectId,state_version:recipeWorkingVersion(recipe.workingState),semantics:'preview_apply',owner:'recipe_my_version_writer'});return capabilities;}
 const recovery=recoveryContext(context);if(recovery)return [{kind:'recovery_stretch_plan',target_kind:'recovery',target_id:recovery.localDate,state_version:recovery.stateVersion,semantics:'preview_apply',owner:'recovery_stretch_plan_writer'}];
 return [];
}

export function validateCoachProposedAction(raw:unknown,context:unknown):CoachProposedAction|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const kind=(raw as Record<string,unknown>).kind;
 if(kind==='recipe_my_version')return validateRecipeProposedAction(raw,context);
 if(kind==='cooking_completion')return validateCookingCompletionProposedAction(raw,context);
 if(kind==='recovery_stretch_plan')return validateRecoveryStretchProposedAction(raw,context);
 return null;
}

export function validateRecipeProposedAction(raw:unknown,context:unknown):RecipeProposedAction|null{
 const attached=eligibleRecipeActionContext(context);if(!attached)return null;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const value=raw as Record<string,unknown>;if(value.version!==1||value.kind!=='recipe_my_version')return null;
 const label=text(value.label,TEXT_LIMITS.label);if(!label)return null;
 const p=value.payload;if(!p||typeof p!=='object'||Array.isArray(p))return null;const payload=p as Record<string,unknown>;
 const allowed=new Set(['scope','source','base_recipe_id','version_id','expected_version','title','overrides','notes']);for(const key of Object.keys(payload))if(!allowed.has(key))return null;
 if(payload.scope!=='save_my_version'&&payload.scope!=='update_my_version')return null;
 if(payload.source!=='catalog'||payload.base_recipe_id!==attached.object_id)return null;
 const overrides=payload.overrides;if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))return null;
 const overrideRecord={...(overrides as Record<string,unknown>)};if(!Object.keys(overrideRecord).length)return null;for(const key of Object.keys(overrideRecord))if(!OVERRIDE_KEYS.has(key))return null;
 if('servings'in overrideRecord){const n=Number(overrideRecord.servings);if(!Number.isFinite(n)||n<=0||n>100)return null;overrideRecord.servings=n;}
 for(const key of ['ingredients','cook_now_directions','meal_prep_directions','freezer_kit_directions','tags'])if(key in overrideRecord&&!Array.isArray(overrideRecord[key]))return null;
 const expected=optionalInteger(payload.expected_version);if(expected===undefined)return null;
 const versionId=optionalText(payload.version_id,TEXT_LIMITS.version_id);if(versionId===undefined)return null;
 if(payload.scope==='update_my_version'&&(!versionId||expected===null||expected<1))return null;
 if(payload.scope==='save_my_version'&&(versionId!==null||expected!==null))return null;
 const title=optionalText(payload.title,TEXT_LIMITS.title),notes=optionalText(payload.notes,TEXT_LIMITS.notes);if(title===undefined||notes===undefined)return null;
 return {version:1,kind:'recipe_my_version',label,payload:{scope:payload.scope,source:'catalog',base_recipe_id:attached.object_id,version_id:versionId,expected_version:expected,title,overrides:overrideRecord,notes}};
}

export function validateCookingCompletionProposedAction(raw:unknown,context:unknown):CookingCompletionProposedAction|null{
 const attached=recipeContext(context);if(!attached||!raw||typeof raw!=='object'||Array.isArray(raw))return null;const value=raw as Record<string,unknown>;if(value.version!==1||value.kind!=='cooking_completion')return null;
 const label=text(value.label,TEXT_LIMITS.label);if(!label)return null;const p=value.payload;if(!p||typeof p!=='object'||Array.isArray(p))return null;const payload=p as Record<string,unknown>;
 const allowed=new Set(['recipe_source','recipe_id','recipe_name','actual_servings','adjustment_note','ingredient_adjustment','meal_prep_plan_id']);for(const key of Object.keys(payload))if(!allowed.has(key))return null;
 if(payload.recipe_source!==attached.source||payload.recipe_id!==attached.objectId)return null;const recipeName=text(payload.recipe_name,TEXT_LIMITS.recipe_name);if(!recipeName)return null;
 const actualServings=optionalPositiveInteger(payload.actual_servings,100);if(actualServings===undefined)return null;const adjustmentNote=optionalText(payload.adjustment_note,500);if(adjustmentNote===undefined)return null;const mealPrepPlanId=optionalText(payload.meal_prep_plan_id,TEXT_LIMITS.meal_prep_plan_id);if(mealPrepPlanId===undefined)return null;
 const ingredientAdjustment=ingredientAdjustmentValue(payload.ingredient_adjustment);if(ingredientAdjustment===undefined)return null;
 return {version:1,kind:'cooking_completion',label,payload:{recipe_source:attached.source,recipe_id:attached.objectId,recipe_name:recipeName,actual_servings:actualServings,adjustment_note:adjustmentNote,ingredient_adjustment:ingredientAdjustment,meal_prep_plan_id:mealPrepPlanId}};
}

export function validateRecoveryStretchProposedAction(raw:unknown,context:unknown):RecoveryStretchProposedAction|null{
 const attached=recoveryContext(context);if(!attached||!raw||typeof raw!=='object'||Array.isArray(raw))return null;const value=raw as Record<string,unknown>;if(value.version!==1||value.kind!=='recovery_stretch_plan')return null;
 const label=text(value.label,TEXT_LIMITS.label);if(!label)return null;const p=value.payload;if(!p||typeof p!=='object'||Array.isArray(p))return null;const payload=p as Record<string,unknown>;
 const allowed=new Set(['local_date','stretch_ids','expected_version','rationale']);for(const key of Object.keys(payload))if(!allowed.has(key))return null;
 if(payload.local_date!==attached.localDate)return null;const expectedVersion=Number(payload.expected_version);if(!Number.isInteger(expectedVersion)||expectedVersion<0||expectedVersion!==attached.stateVersion)return null;
 if(!Array.isArray(payload.stretch_ids))return null;const stretchIds=[...new Set(payload.stretch_ids.map(v=>typeof v==='string'?v.trim():'').filter(Boolean))];if(stretchIds.length<1||stretchIds.length>5||stretchIds.some(id=>!RECOVERY_STRETCH_IDS.has(id)))return null;
 const rationale=optionalText(payload.rationale,TEXT_LIMITS.rationale);if(rationale===undefined)return null;
 return {version:1,kind:'recovery_stretch_plan',label,payload:{local_date:attached.localDate,stretch_ids:stretchIds,expected_version:attached.stateVersion,rationale}};
}

// Legacy function name retained because provider.ts and existing tests import it. The returned
// prompt is now a request-scoped capability manifest rather than a Recipe-only authorization.
export function recipeActionPrompt(context:unknown):string|null{
 const capabilities=coachActionCapabilities(context);if(!capabilities.length)return null;const recipe=recipeContext(context),recovery=recoveryContext(context);
 const lines=['ALL IN Coach action capability manifest (request-scoped, preview/review only):'];
 for(const capability of capabilities)lines.push(`- ${capability.kind}: target=${capability.target_kind}:${capability.target_id}; state_version=${capability.state_version??'n/a'}; semantics=${capability.semantics}; owner=${capability.owner}.`);
 lines.push('You may emit proposed_action only for a capability listed above. Never invent another action kind, target, identity, version, or writer. Never claim a proposed action was saved/applied. The host re-validates and the canonical owner performs any durable write after explicit user review/apply.');
 if(recipe?.source==='catalog')lines.push(`recipe_my_version schema: version=1, kind=recipe_my_version, exact base_recipe_id=${recipe.objectId}, source=catalog, scope=save_my_version or update_my_version. Overrides may contain only servings, description, ingredients, cook_now_directions, meal_prep_directions, freezer_kit_directions, fridge_notes, freezer_notes, or tags. For update_my_version use only the exact version_id/expected_version supplied by context; never invent either.`);
 if(recipe)lines.push('Recipe optimization evidence guardrail: do not invent substitutions; calorie, protein, saturated-fat, or cost deltas; dietary compatibility; culinary validity; dish-count or freezer/reheat outcomes; yield effects; Pantry availability; kitchen capacity; or equipment facts. Lower-calorie requests may use only a supplied deterministic recipe-adaptation assessment built from validated candidates. Higher-protein, Budget/lower-cost, lower-saturated-fat, vegetarian, vegan, dairy-free, gluten-free, Pantry-only/use-what-I-have, simpler/fewer-dishes, one-pan, microwave-only, slow-cooker conversion, air-fryer conversion, and freezer/reheat-friendly requests may use only a supplied deterministic objective-specific optimization assessment built from reviewed culinary knowledge plus canonical objective evidence for the exact current Recipe/version. Pantry-only availability and equipment/kitchen constraints must come from canonical context. Technique-conversion objectives require reviewed technique evidence for that exact context; never apply a generic appliance conversion formula, and unsupported conversions must fail closed. If the required assessment or evidence is missing, stale, conflicting, or unsupported, explain the uncertainty or offer a safer validated alternative rather than freehanding a modification. Canonical nutrition and any required Cooking Yield review must complete before preview. Use Once remains the default; Save My Version requires explicit user action through the existing versioned Recipe writer.');
 if(recipe)lines.push(`cooking_completion schema: version=1, kind=cooking_completion, exact recipe_source=${recipe.source}, exact recipe_id=${recipe.objectId}, recipe_name, optional actual_servings, adjustment_note, ingredient_adjustment, meal_prep_plan_id. This action only opens the canonical cooking-completion review; it never directly mutates Pantry or Prepared Meals.`);
 if(recovery)lines.push(`recovery_stretch_plan schema: version=1, kind=recovery_stretch_plan, exact local_date=${recovery.localDate}, exact expected_version=${recovery.stateVersion}, stretch_ids selected only from calf_stretch, hip_flexor_stretch, hamstring_stretch, quad_stretch, figure_four_stretch, optional rationale. The canonical Recovery writer still requires explicit Apply and exact-version concurrency.`);
 return lines.join('\n');
}

function recipeWorkingVersion(state:Record<string,unknown>){const raw=state.my_version_revision??state.expected_version??state.version;const n=Number(raw);return Number.isInteger(n)&&n>=0?n:null;}
function ingredientAdjustmentValue(value:unknown):CookingCompletionProposedAction['payload']['ingredient_adjustment']|undefined{if(value===null||value===undefined)return null;if(!value||typeof value!=='object'||Array.isArray(value))return undefined;const raw=value as Record<string,unknown>,allowed=new Set(['scope','ingredient','amount','unit']);for(const key of Object.keys(raw))if(!allowed.has(key))return undefined;if(raw.scope!=='all_servings'&&raw.scope!=='single_serving')return undefined;const ingredient=text(raw.ingredient,TEXT_LIMITS.ingredient),amount=Number(raw.amount);if(!ingredient||!Number.isFinite(amount)||amount<0||(raw.unit!=='oz'&&raw.unit!=='g'&&raw.unit!=='lb'))return undefined;return {scope:raw.scope,ingredient,amount,unit:raw.unit};}
function text(value:unknown,max:number){return typeof value==='string'&&value.trim()&&value.trim().length<=max?value.trim():null}
function optionalText(value:unknown,max:number):string|null|undefined{if(value===null||value===undefined||value==='')return null;if(typeof value!=='string'||value.trim().length>max)return undefined;return value.trim()||null}
function optionalInteger(value:unknown):number|null|undefined{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isInteger(n)&&n>=0?n:undefined}
function optionalPositiveInteger(value:unknown,max:number):number|null|undefined{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isInteger(n)&&n>0&&n<=max?n:undefined}
