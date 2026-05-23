import { buildStudyPlanConfirmationPreview } from "./studyPlan.js";
import {
  deleteStudyPlanRecipe,
  loadStudyPlanRecipes,
  saveStudyPlanRecipe,
} from "./studyPlanRecipes.js";

function loadInitialStudyPlanRecipes({ storage } = {}) {
  return loadStudyPlanRecipes(storage);
}

async function refreshStudyPlanRecipes(controller) {
  if (typeof controller?.fetchStudyPlanRecipes !== "function") {
    return { skipped: true, recipes: null };
  }
  return {
    ...(await controller.fetchStudyPlanRecipes()),
    skipped: false,
    usedFallback: false,
  };
}

async function saveStudyPlanRecipeWithFallback(
  controller,
  { name = "", plan, storage } = {},
) {
  if (typeof controller?.saveStudyPlanRecipe === "function") {
    try {
      return {
        ...(await controller.saveStudyPlanRecipe({ name, plan })),
        usedFallback: false,
      };
    } catch (error) {
      const localResult = saveStudyPlanRecipe({ name, plan, storage });
      return {
        ...localResult,
        preview: localResult.preview || buildStudyPlanConfirmationPreview(localResult.recipe?.plan || plan),
        usedFallback: true,
        error,
      };
    }
  }

  return {
    ...saveStudyPlanRecipe({ name, plan, storage }),
    usedFallback: false,
  };
}

async function deleteStudyPlanRecipeWithFallback(
  controller,
  { recipeId, storage } = {},
) {
  if (typeof controller?.archiveSavedStudy === "function") {
    try {
      const payload = await controller.archiveSavedStudy({ id: recipeId });
      return {
        ok: payload.ok,
        recipes: Array.isArray(payload.recipes)
          ? payload.recipes
          : (payload.savedStudies || []).map((savedStudy) => ({
              ...savedStudy,
              id: savedStudy.id,
              plan: savedStudy.plan,
              savedStudy,
              readiness: savedStudy.readiness,
              dependencies: savedStudy.dependencies || [],
            })),
        savedStudy: payload.savedStudy,
        usedFallback: false,
      };
    } catch (error) {
      return {
        ok: true,
        recipes: deleteStudyPlanRecipe(recipeId, storage),
        usedFallback: true,
        error,
      };
    }
  }

  if (typeof controller?.deleteStudyPlanRecipe === "function") {
    try {
      return {
        ...(await controller.deleteStudyPlanRecipe({ id: recipeId })),
        usedFallback: false,
      };
    } catch (error) {
      return {
        ok: true,
        recipes: deleteStudyPlanRecipe(recipeId, storage),
        usedFallback: true,
        error,
      };
    }
  }

  return {
    ok: true,
    recipes: deleteStudyPlanRecipe(recipeId, storage),
    usedFallback: false,
  };
}


async function refreshSavedStudyReadinessWithFallback(
  controller,
  { recipeId } = {},
) {
  if (typeof controller?.refreshSavedStudyReadiness !== "function") {
    return {
      ok: false,
      skipped: true,
      recipes: null,
      statusMessage: "Saved-study readiness refresh is only available with the local server.",
    };
  }
  return {
    ...(await controller.refreshSavedStudyReadiness({ id: recipeId })),
    skipped: false,
    usedFallback: false,
  };
}


export {
  deleteStudyPlanRecipeWithFallback,
  loadInitialStudyPlanRecipes,
  refreshStudyPlanRecipes,
  refreshSavedStudyReadinessWithFallback,
  saveStudyPlanRecipeWithFallback,
};
