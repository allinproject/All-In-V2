export type RecipeBypassResult={answer:string;routeKey:string};

const normalize=(value:unknown)=>String(value??"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const GENERATIVE_RE=/\b(create|make me|invent|generate|adapt|change|modify|substitut(?:e|ion|ions|ing)?|swap|replace|recommend|suggest|what should i (?:cook|make|eat)|lower calorie|higher protein|budget version|meal plan)\b/;

export const savedRecipeLookupQuery=(message:string):string|null=>{
  const raw=String(message??"").trim().replace(/[?.!]+$/g,"");
  const lower=raw.toLowerCase();
  if(GENERATIVE_RE.test(lower)||!/\b(recipe|cookbook)\b/.test(lower))return null;
  const lookupVerb="(?:(?:show|open|find|display|pull up)(?: me)?|give me)";
  const patterns=[
    new RegExp(`^${lookupVerb}\\s+(?:my\\s+)?(?:saved\\s+)?(?:cookbook\\s+)?(.+?)\\s+recipe$`,"i"),
    /^(?:what(?:'s| is))\s+(?:my\s+)?(?:saved\s+)?(.+?)\s+recipe$/i,
    new RegExp(`^${lookupVerb}\\s+(?:my\\s+)?(?:saved\\s+)?recipe\\s+(?:for\\s+)?(.+)$`,"i"),
  ];
  for(const pattern of patterns){const match=raw.match(pattern),query=match?.[1]?.trim();if(query&&query.length>=2)return query;}
  return null;
};

const ingredientLine=(value:any):string|null=>{
  if(typeof value==="string")return value.trim()||null;
  if(!value||typeof value!=="object")return null;
  const item=String(value.item??value.name??value.ingredient??"").trim();if(!item)return null;
  const amount=String(value.amount??value.quantity??"").trim(),unit=String(value.unit??"").trim();
  return [amount,unit,item].filter(Boolean).join(" ");
};
const instructionLine=(value:any):string|null=>{
  if(typeof value==="string")return value.trim()||null;
  if(!value||typeof value!=="object")return null;
  const text=String(value.text??value.instruction??value.step??value.description??"").trim();return text||null;
};

export const formatSavedRecipe=(recipe:any):RecipeBypassResult|null=>{
  const title=String(recipe?.title??"").trim();if(!title)return null;
  const servings=Number(recipe?.servings),ingredients=(Array.isArray(recipe?.ingredients)?recipe.ingredients:[]).map(ingredientLine).filter(Boolean) as string[],instructions=(Array.isArray(recipe?.instructions)?recipe.instructions:[]).map(instructionLine).filter(Boolean) as string[];
  const parts=[title];
  if(Number.isFinite(servings)&&servings>0)parts.push(`Servings: ${Math.round(servings)}`);
  if(ingredients.length)parts.push(`Ingredients:\n${ingredients.map(line=>`- ${line}`).join("\n")}`);
  if(instructions.length)parts.push(`Directions:\n${instructions.map((line,index)=>`${index+1}. ${line}`).join("\n")}`);
  return{answer:parts.join("\n\n"),routeKey:"recipe_saved_lookup"};
};

export async function resolveSavedRecipeBypass({client,message}:{client:any;message:string}):Promise<RecipeBypassResult|null>{
  const query=savedRecipeLookupQuery(message);if(!query)return null;
  const {data,error}=await client.rpc("allin_recipe_browse_page",{p_query:query,p_filters:[],p_limit:10,p_offset:0});
  if(error)return null;
  const exact=(Array.isArray(data)?data:[]).filter((row:any)=>normalize(row?.title)===normalize(query));
  if(exact.length!==1)return null;
  const hit=exact[0],id=String(hit?.id??"").trim(),source=String(hit?.source_kind??"").trim();
  if(!id||(source!=="catalog"&&source!=="personal"))return null;
  const table=source==="personal"?"allin_user_recipes":"allin_recipes";
  const detail=await client.from(table).select("id,title,servings,ingredients,instructions").eq("id",id).single();
  if(detail.error||!detail.data)return null;
  return formatSavedRecipe(detail.data);
}
