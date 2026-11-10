import type {CookingYieldEvidence} from './cookingYieldIntelligence.ts';

export const USDA_FBG_VEGETABLE_YIELD_2026_09_02='USDA Food Buying Guide, Section 2 Vegetables Yield Table, updated 2026-09-02';
export const USDA_FBG_MEAT_YIELD_2026_09_02='USDA Food Buying Guide, Section 1 Meats/Meat Alternates Yield Table, updated 2026-09-02';
export const USDA_FBG_GROUND_BEEF_10PCT_CATEGORY_2026_09_02='USDA Food Buying Guide, Section 1 Ground Beef category: no more than 10% fat; 1 lb AP = 0.76 lb cooked, drained lean meat; updated 2026-09-02';

export const reviewedCookingYieldReferences:CookingYieldEvidence[]=[
  {
    id:'usda-fbg-2026-potato-white-russet-baked-no-skin',
    key:{food:'Potato',form:'White or Russet whole without skin',method:'baked',lid:'uncovered',drained:false},
    source:'usda_exact',yieldRatio:.74,reference:USDA_FBG_VEGETABLE_YIELD_2026_09_02,
  },
  {
    id:'usda-fbg-2026-potato-white-russet-baked-with-skin',
    key:{food:'Potato',form:'White or Russet whole with skin',method:'baked',lid:'uncovered',drained:false},
    source:'usda_exact',yieldRatio:.82,reference:USDA_FBG_VEGETABLE_YIELD_2026_09_02,
  },
  {
    id:'usda-fbg-2026-potato-white-russet-diced-skin-cooked',
    key:{food:'Potato',form:'White or Russet diced with skin',method:'cooked',drained:false},
    source:'usda_exact',yieldRatio:.99,reference:USDA_FBG_VEGETABLE_YIELD_2026_09_02,
  },
  {
    id:'usda-fbg-2026-potato-red-whole-cooked',
    key:{food:'Potato',form:'Red whole with skin',method:'cooked',drained:false},
    source:'usda_exact',yieldRatio:.97,reference:USDA_FBG_VEGETABLE_YIELD_2026_09_02,
  },
  {
    id:'usda-fbg-2026-chicken-breast-tenderloins-boneless-skinless',
    key:{food:'Chicken breast',form:'boneless skinless tenderloins',method:'cooked',drained:false},
    source:'usda_exact',yieldRatio:.73,reference:USDA_FBG_MEAT_YIELD_2026_09_02,
  },
  {
    id:'usda-fbg-2026-ground-beef-10-percent-fat-cooked-drained',
    key:{food:'Ground beef',form:'fresh or frozen, no more than 10% fat',method:'cooked and drained',drained:true},
    source:'usda_category',yieldRatio:.76,reference:USDA_FBG_GROUND_BEEF_10PCT_CATEGORY_2026_09_02,
  },
  {
    id:'usda-fbg-2026-chicken-boneless-with-skin',
    key:{food:'Chicken',form:'boneless with skin in natural proportions',method:'cooked',drained:false},
    source:'usda_exact',yieldRatio:.70,reference:USDA_FBG_MEAT_YIELD_2026_09_02,
  },
];
