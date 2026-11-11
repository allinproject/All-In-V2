/**
 * Canonical Kitchen capabilities within V2 nutrition_preferences.
 * Unknown is deliberately distinct from not available. No second kitchen store.
 */
export const HOME_KITCHEN_GROUPS = [
  { title: 'Cooking appliances', items: [
    ['stovetop','Stovetop'],['oven','Oven'],['toaster_oven','Toaster oven'],['microwave','Microwave'],
    ['air_fryer','Air fryer'],['slow_cooker','Slow cooker'],['pressure_cooker','Pressure cooker'],
    ['grill','Grill'],['rice_cooker','Rice cooker'],
  ] },
  { title: 'Food preparation', items: [
    ['blender','Blender'],['immersion_blender','Immersion blender'],
    ['food_processor','Food processor'],['mixer','Stand / hand mixer'],
  ] },
  { title: 'Cookware & baking', items: [
    ['sheet_pan','Sheet pan'],['casserole_dish','Casserole dish'],['skillet','Skillet'],
    ['saucepan','Saucepan'],['stockpot','Stockpot'],['dutch_oven','Dutch oven'],
    ['muffin_tin','Muffin tin'],['loaf_pan','Loaf pan'],
  ] },
  { title: 'Kitchen tools', items: [['food_scale','Food scale'],['thermometer','Thermometer']] },
] as const;
export const WORK_REHEAT_ITEMS = [
  ['microwave','Microwave'],['toaster_oven','Toaster oven'],['air_fryer','Air fryer'],
] as const;
export const KITCHEN_AVAILABILITY = ['unknown','available','unavailable'] as const;
export type Availability = typeof KITCHEN_AVAILABILITY[number];
export type KitchenEquipmentId = typeof HOME_KITCHEN_GROUPS[number]['items'][number][0];
export type KitchenCount = 'burner_count' | 'skillet_count' | 'container_count';
export type KitchenState = {
  home: Record<string, Availability>;
  work: Record<string, Availability>;
  constraints: Record<KitchenCount, number | null> & { notes: string | null };
};
const homeIds = new Set<string>(HOME_KITCHEN_GROUPS.flatMap(group => group.items.map(item => item[0])));
const workIds = new Set<string>(WORK_REHEAT_ITEMS.map(item => item[0]));
const countKeys: readonly KitchenCount[] = ['burner_count','skillet_count','container_count'];

function object(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}
function state(raw: unknown): Availability {
  return raw === 'available' || raw === 'unavailable' ? raw : 'unknown';
}
function count(raw: unknown): number | null {
  return Number.isSafeInteger(raw) && Number(raw) >= 0 && Number(raw) <= 99 ? Number(raw) : null;
}
export function emptyKitchen(): KitchenState {
  return {
    home: {}, work: {},
    constraints: { burner_count:null, skillet_count:null, container_count:null, notes:null },
  };
}
export function parseKitchen(raw: unknown): KitchenState {
  const root = object(raw);
  const home = object(root.home);
  const work = object(root.work);
  const limits = object(root.constraints);
  const next = emptyKitchen();
  for (const id of homeIds) next.home[id] = state(home[id]);
  for (const id of workIds) next.work[id] = state(work[id]);
  for (const key of countKeys) next.constraints[key] = count(limits[key]);
  next.constraints.notes = typeof limits.notes === 'string' && limits.notes.trim()
    ? limits.notes.trim().slice(0,500) : null;
  return next;
}
export function setEquipmentAvailability(
  value: KitchenState, scope: 'home' | 'work', id: string, availability: Availability,
): KitchenState {
  const ids = scope === 'home' ? homeIds : workIds;
  if (!ids.has(id)) throw new Error('Unsupported kitchen equipment.');
  if (!KITCHEN_AVAILABILITY.includes(availability)) throw new Error('Unsupported availability.');
  return { ...value, [scope]: { ...value[scope], [id]: availability } };
}
export function setKitchenCount(value: KitchenState, key: KitchenCount, input: string): KitchenState {
  if (!countKeys.includes(key)) throw new Error('Unsupported count.');
  const trimmed = input.trim();
  if (trimmed !== '' && (!/^\d{1,2}$/.test(trimmed) || Number(trimmed) > 99)) {
    throw new Error('Enter a whole number between 0 and 99, or leave blank.');
  }
  return { ...value, constraints: { ...value.constraints, [key]: trimmed ? Number(trimmed) : null } };
}
export function setKitchenNotes(value: KitchenState, notes: string): KitchenState {
  if (notes.length > 500) throw new Error('Kitchen notes cannot exceed 500 characters.');
  return { ...value, constraints: { ...value.constraints, notes: notes.trim() || null } };
}
/** One atomic profile-settings patch; food safety and preferences remain untouched. */
export function kitchenSettingsPatch(value: KitchenState) {
  const clean = parseKitchen(value);
  return { kitchen: clean };
}
