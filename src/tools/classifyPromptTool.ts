/**
 * BlindSprint: Classify a mystery prompt into app type and extract planning hints.
 * Fast heuristic so the agent can decide stack and template in under a second.
 */

export type AppType =
  | "landing_page"
  | "dashboard"
  | "workflow_app"
  | "marketplace"
  | "portfolio_brand"
  | "interactive_tool";

export interface ClassifyPromptResult {
  appType: AppType;
  audience: string;
  keyFeatures: string[];
  visualTone: string;
  mustHaveInteractions: string[];
}

const LANDING_KEYWORDS = [
  "landing", "product launch", "event", "brand", "marketing", "hero", "cta",
  "sign up", "launch", "promo", "campaign", "splash",
];
const DASHBOARD_KEYWORDS = [
  "dashboard", "admin", "analytics", "metrics", "kpi", "charts", "reports",
  "overview", "stats", "monitor", "back office",
];
const WORKFLOW_KEYWORDS = [
  "workflow", "form", "booking", "intake", "wizard", "stepper", "onboarding",
  "signup flow", "checkout", "multi-step", "application",
];
const MARKETPLACE_KEYWORDS = [
  "marketplace", "catalog", "products", "listing", "browse", "shop", "store",
  "discover", "filter", "search", "ecommerce",
];
const PORTFOLIO_KEYWORDS = [
  "portfolio", "creator", "resume", "about me", "brand site", "identity",
  "showcase", "work samples", "contact",
];
const INTERACTIVE_KEYWORDS = [
  "calculator", "planner", "generator", "recommender", "tool", "interactive",
  "converter", "estimator", "quiz", "configurator",
];

function matchScore(prompt: string, keywords: string[]): number {
  const lower = prompt.toLowerCase();
  return keywords.filter((k) => lower.includes(k)).length;
}

export function classifyPrompt(prompt: string): ClassifyPromptResult {
  const lower = prompt.toLowerCase().trim();
  const scores: { type: AppType; score: number }[] = [
    { type: "landing_page", score: matchScore(lower, LANDING_KEYWORDS) },
    { type: "dashboard", score: matchScore(lower, DASHBOARD_KEYWORDS) },
    { type: "workflow_app", score: matchScore(lower, WORKFLOW_KEYWORDS) },
    { type: "marketplace", score: matchScore(lower, MARKETPLACE_KEYWORDS) },
    { type: "portfolio_brand", score: matchScore(lower, PORTFOLIO_KEYWORDS) },
    { type: "interactive_tool", score: matchScore(lower, INTERACTIVE_KEYWORDS) },
  ];
  scores.sort((a, b) => b.score - a.score);
  const appType = scores[0].score > 0 ? scores[0].type : "landing_page";

  const audience =
    lower.includes("b2b") || lower.includes("business")
      ? "business users"
      : lower.includes("consumer") || lower.includes("user")
        ? "consumers"
        : lower.includes("developer")
          ? "developers"
          : "general audience";

  const featureMap: Record<AppType, string[]> = {
    landing_page: ["hero", "features", "testimonials/stats", "CTA", "footer"],
    dashboard: ["sidebar/top nav", "KPI cards", "chart placeholders", "activity table", "filters"],
    workflow_app: ["stepper", "form", "validation", "confirmation state"],
    marketplace: ["search", "filters", "cards", "detail drawer/modal"],
    portfolio_brand: ["hero", "work grid", "about", "contact"],
    interactive_tool: ["input panel", "result panel", "history/help state"],
  };
  const keyFeatures = featureMap[appType];

  const visualTone =
    lower.includes("premium") || lower.includes("luxury")
      ? "premium, refined"
      : lower.includes("playful") || lower.includes("fun")
        ? "playful, friendly"
        : lower.includes("minimal") || lower.includes("clean")
          ? "minimal, clean"
          : "modern, professional, trustworthy";

  const interactionMap: Record<AppType, string[]> = {
    landing_page: ["nav scroll", "CTA click", "form submit"],
    dashboard: ["filters", "tab switch", "chart hover"],
    workflow_app: ["step next/back", "form validation", "success state"],
    marketplace: ["search", "filter", "card click", "modal open"],
    portfolio_brand: ["nav", "grid hover", "contact form"],
    interactive_tool: ["input change", "submit", "result display"],
  };
  const mustHaveInteractions = interactionMap[appType];

  return {
    appType,
    audience,
    keyFeatures,
    visualTone,
    mustHaveInteractions,
  };
}
