export type FdcGenericDataType = 'Foundation' | 'SR Legacy';
export type FdcCandidate = {
  source: 'usda_fdc';
  source_id: string;
  data_type: FdcGenericDataType;
  food_description: string;
  nutrition_basis: '100g';
  portion_label: '100 g';
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  saturated_fat_g: number | null;
  sodium_mg: number | null;
  usable: boolean;
  source_quality: 'usda_reference_unreviewed';
  source_license: 'USDA FoodData Central / CC0 1.0';
  review_required: true;
  retrieved_at: string;
};
function numeric(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function foodText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function nutrient(rows: any[], ids: number[], unit: string): number | null {
  for (const id of ids) {
    const row = rows.find((item: any) =>
      Number(item?.nutrientId ?? item?.nutrient?.id) === id &&
      String(item?.unitName ?? item?.nutrient?.unitName ?? '').toUpperCase() === unit
    );
    const value = row ? numeric(row.value ?? row.amount) : null;
    if (value !== null) return value;
  }
  return null;
}
export function normalizeFdcGenericFood(raw: unknown, retrievedAt: string): FdcCandidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const food = raw as Record<string, any>;
  const id = Number(food.fdcId);
  const description = foodText(food.description);
  const dataType = food.dataType;
  if (!Number.isSafeInteger(id) || id <= 0 || !description ||
      (dataType !== 'Foundation' && dataType !== 'SR Legacy') ||
      !Number.isFinite(Date.parse(retrievedAt))) return null;
  const rows = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  const calories = nutrient(rows, dataType === 'Foundation' ? [2048, 2047, 1008] : [1008, 2048, 2047], 'KCAL');
  const protein = nutrient(rows, [1003], 'G');
  const carbs = nutrient(rows, [1005], 'G');
  const fat = nutrient(rows, [1004], 'G');
  const fiber = nutrient(rows, [1079], 'G');
  const saturatedFat = nutrient(rows, [1258], 'G');
  const sodium = nutrient(rows, [1093], 'MG');
  return {
    source: 'usda_fdc', source_id: String(id), data_type: dataType,
    food_description: description, nutrition_basis: '100g', portion_label: '100 g',
    calories, protein_g: protein, carbs_g: carbs, fat_g: fat,
    fiber_g: fiber, saturated_fat_g: saturatedFat, sodium_mg: sodium,
    usable: calories !== null && protein !== null && carbs !== null && fat !== null,
    source_quality: 'usda_reference_unreviewed',
    source_license: 'USDA FoodData Central / CC0 1.0',
    review_required: true, retrieved_at: retrievedAt,
  };
}
