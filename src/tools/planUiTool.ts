/**
 * BlindSprint: Generate a UI build plan from app type and prompt.
 * Outputs page structure, sections, nav, responsive behavior, design tokens, acceptance checklist.
 */

import type { AppType } from "./classifyPromptTool.js";

export interface PlanUiResult {
  pageStructure: string;
  sections: string[];
  navModel: string;
  responsiveBehavior: string;
  designTokens: string;
  acceptanceChecklist: string[];
}

const TEMPLATES: Record<
  AppType,
  { sections: string[]; nav: string; responsive: string; tokens: string }
> = {
  landing_page: {
    sections: ["Hero", "Features", "Testimonials/Stats", "CTA", "Footer"],
    nav: "Sticky header with logo + links, smooth scroll to sections",
    responsive: "Stack sections vertically on mobile; hero full-width; CTA prominent",
    tokens: "One accent color, 8pt spacing, max-width container, strong heading hierarchy",
  },
  dashboard: {
    sections: ["Sidebar/Top nav", "KPI cards", "Charts", "Activity table", "Filters"],
    nav: "Sidebar (collapse on mobile) or top nav with key metrics",
    responsive: "Cards 1-col mobile, 2–4 col desktop; table horizontal scroll",
    tokens: "Neutral base, one accent for primary actions; card radius 8px",
  },
  workflow_app: {
    sections: ["Stepper", "Form", "Validation", "Confirmation"],
    nav: "Step indicator; back/next or submit",
    responsive: "Single column form; stepper horizontal or vertical on small",
    tokens: "Clear primary CTA; error/success states; 8pt spacing",
  },
  marketplace: {
    sections: ["Search", "Filters", "Product cards", "Detail drawer/modal"],
    nav: "Top search + filter bar; breadcrumb in detail",
    responsive: "Grid 1–2 col mobile, 3–4 col desktop; modal full-screen on mobile",
    tokens: "Card shadow/radius; one accent; clear price/action on cards",
  },
  portfolio_brand: {
    sections: ["Hero", "Work grid", "About", "Contact"],
    nav: "Header with anchor links",
    responsive: "Full-width hero; grid 1–2 col mobile; contact form stacked",
    tokens: "Max 2 font families; generous whitespace; one accent",
  },
  interactive_tool: {
    sections: ["Input panel", "Result panel", "History/help"],
    nav: "Optional tabs or single view",
    responsive: "Stack input above result on mobile; side-by-side on desktop",
    tokens: "Clear input/output separation; one primary CTA; loading state",
  },
};

const BASE_CHECKLIST = [
  "Entry point (index.html / main.tsx) exists",
  "All created files are referenced (no dead imports)",
  "README exists with npm install && npm run dev",
  "No TODO, lorem ipsum, or placeholder links in final copy",
  "Loading, empty, error, success states where relevant",
  "Responsive layout; one primary CTA per view",
  "Accessible labels and keyboard-friendly where relevant",
];

export function planUi(appType: AppType, _promptHint?: string): PlanUiResult {
  const t = TEMPLATES[appType];
  return {
    pageStructure: `Single-page app with sections: ${t.sections.join(" → ")}`,
    sections: t.sections,
    navModel: t.nav,
    responsiveBehavior: t.responsive,
    designTokens: t.tokens,
    acceptanceChecklist: BASE_CHECKLIST,
  };
}
