import {
  STUDY_PLAN_VERSION,
  buildStudyPlanConfirmationPreview,
  validateStudyPlan,
} from "./studyPlan.js";

const STUDY_PLAN_RECIPE_STORAGE_VERSION = "study-plan-recipes-v1";
const STUDY_PLAN_RECIPE_STORAGE_KEY = "indexStudyLab.studyBuilder.recipes.v1";
const STUDY_PLAN_RECIPE_LIMIT = 50;

function getDefaultStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

function normalizeRecipeName(name, plan) {
  const cleaned = String(name || "").replace(/\s+/g, " ").trim();
  if (cleaned) {
    return cleaned.slice(0, 120);
  }
  const preview = buildStudyPlanConfirmationPreview(plan);
  if (preview.studyTitle && preview.viewLabel) {
    return `${preview.studyTitle} · ${preview.viewLabel}`;
  }
  return "Untitled StudyPlan";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "study-plan";
}

function simpleHash(value) {
  let hash = 2166136261;
  String(value || "").split("").forEach((char) => {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return (hash >>> 0).toString(36);
}

function parseStoredRecipes(rawValue) {
  if (!rawValue) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed?.recipes) ? parsed.recipes : [];
  } catch {
    return [];
  }
}

function normalizeRecipeRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const validation = validateStudyPlan(record.plan);
  if (!validation.ok || !validation.normalizedPlan) {
    return null;
  }
  const name = normalizeRecipeName(record.name, validation.normalizedPlan);
  const routeHash = validation.routeHash;
  return {
    id: String(record.id || `${slugify(name)}-${simpleHash(routeHash)}`),
    version: STUDY_PLAN_RECIPE_STORAGE_VERSION,
    name,
    routeHash,
    studyId: validation.normalizedPlan.studyId,
    viewId: validation.normalizedPlan.viewId,
    plan: validation.normalizedPlan,
    createdAt: String(record.createdAt || record.updatedAt || ""),
    updatedAt: String(record.updatedAt || record.createdAt || ""),
  };
}

function loadStudyPlanRecipes(storage = getDefaultStorage()) {
  if (!storage) {
    return [];
  }
  return parseStoredRecipes(storage.getItem(STUDY_PLAN_RECIPE_STORAGE_KEY))
    .map(normalizeRecipeRecord)
    .filter(Boolean)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function writeStudyPlanRecipes(recipes, storage = getDefaultStorage()) {
  if (!storage) {
    return recipes;
  }
  const normalizedRecipes = recipes.map(normalizeRecipeRecord).filter(Boolean);
  storage.setItem(
    STUDY_PLAN_RECIPE_STORAGE_KEY,
    JSON.stringify({
      version: STUDY_PLAN_RECIPE_STORAGE_VERSION,
      recipes: normalizedRecipes.slice(0, STUDY_PLAN_RECIPE_LIMIT),
    }),
  );
  return normalizedRecipes;
}

function saveStudyPlanRecipe({
  name = "",
  plan,
  storage = getDefaultStorage(),
  now = new Date().toISOString(),
} = {}) {
  const validation = validateStudyPlan(plan);
  const existingRecipes = loadStudyPlanRecipes(storage);
  if (!validation.ok || !validation.normalizedPlan) {
    return {
      ok: false,
      recipe: null,
      recipes: existingRecipes,
      validation,
    };
  }

  const recipeName = normalizeRecipeName(name, validation.normalizedPlan);
  const id = `${slugify(recipeName)}-${simpleHash(validation.routeHash)}`;
  const existingRecipe = existingRecipes.find((recipe) => recipe.id === id);
  const recipe = {
    id,
    version: STUDY_PLAN_RECIPE_STORAGE_VERSION,
    name: recipeName,
    routeHash: validation.routeHash,
    studyId: validation.normalizedPlan.studyId,
    viewId: validation.normalizedPlan.viewId,
    plan: validation.normalizedPlan,
    createdAt: existingRecipe?.createdAt || now,
    updatedAt: now,
  };
  const recipes = [recipe, ...existingRecipes.filter((item) => item.id !== id)].slice(
    0,
    STUDY_PLAN_RECIPE_LIMIT,
  );
  return {
    ok: true,
    recipe,
    recipes: writeStudyPlanRecipes(recipes, storage),
    validation,
  };
}

function deleteStudyPlanRecipe(recipeId, storage = getDefaultStorage()) {
  const recipes = loadStudyPlanRecipes(storage).filter(
    (recipe) => recipe.id !== String(recipeId || ""),
  );
  return writeStudyPlanRecipes(recipes, storage);
}

function getStudyPlanRecipeContractManifest() {
  return {
    version: STUDY_PLAN_RECIPE_STORAGE_VERSION,
    storageKey: STUDY_PLAN_RECIPE_STORAGE_KEY,
    limit: STUDY_PLAN_RECIPE_LIMIT,
    recordFields: [
      "id",
      "version",
      "name",
      "routeHash",
      "studyId",
      "viewId",
      "plan",
      "createdAt",
      "updatedAt",
    ],
    invariants: [
      "Only StudyPlans that pass validateStudyPlan() are saved.",
      "Saved recipe routeHash is derived from the normalized StudyPlan.",
      "Saving the same name and route updates the existing recipe.",
      "Recipes may be stored by backend settings endpoints, with browser-local storage as offline fallback.",
      "Recipes are reusable assistant inputs, not completed-run evidence.",
    ],
  };
}

export {
  STUDY_PLAN_RECIPE_LIMIT,
  STUDY_PLAN_RECIPE_STORAGE_KEY,
  STUDY_PLAN_RECIPE_STORAGE_VERSION,
  deleteStudyPlanRecipe,
  getStudyPlanRecipeContractManifest,
  loadStudyPlanRecipes,
  saveStudyPlanRecipe,
};
