/**
 * BlindSprint: Last-pass reality check before zip and submit.
 * Checks: key files exist, entry point, package.json for React, README, no TODO/lorem/placeholder.
 */

import type { ProjectBuilder } from "./projectBuilder.js";

export type ProjectMode = "vite-react-ts-tailwind" | "static-html-css-js";

export interface SubmissionGuardResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  summary: string;
}

const BAD_PATTERNS = [
  /TODO\s*[:(\[]/i,
  /FIXME/i,
  /lorem\s+ipsum/i,
  /placeholder\s*(link|url|href)/i,
  /#\s*$/m,
  /your\s*(\w+)\s*here/i,
];

function hasBadContent(content: string): boolean {
  return BAD_PATTERNS.some((re) => re.test(content));
}

export function submissionGuard(
  filePaths: string[],
  projectMode: ProjectMode,
  getFileContent?: (path: string) => string | undefined
): SubmissionGuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const set = new Set(filePaths.map((p) => p.replace(/\\/g, "/")));

  function has(path: string): boolean {
    return set.has(path.replace(/\\/g, "/"));
  }

  if (!has("index.html")) {
    errors.push("Missing index.html");
  }

  if (projectMode === "vite-react-ts-tailwind") {
    if (!has("package.json")) errors.push("Missing package.json (required for React build)");
    if (!has("src/main.tsx") && !has("src/main.jsx")) {
      errors.push("Missing entry point (src/main.tsx or src/main.jsx)");
    }
    if (!has("README.md")) errors.push("Missing README.md");
  } else {
    if (!has("README.md")) errors.push("Missing README.md");
  }

  if (getFileContent) {
    for (const path of filePaths) {
      const content = getFileContent(path);
      if (content && hasBadContent(content)) {
        warnings.push(`Possible placeholder/TODO/lorem in ${path}`);
      }
    }
  }

  const passed = errors.length === 0;
  const summary = passed
    ? (warnings.length > 0
        ? `Ready to zip with ${warnings.length} warning(s).`
        : "All checks passed. Ready to finalize_project and submit.")
    : `${errors.length} error(s) must be fixed before submitting.`;

  return {
    passed,
    errors,
    warnings,
    summary,
  };
}

/**
 * Run submission guard using the active ProjectBuilder (called from LLM client).
 */
export function runSubmissionGuard(
  builder: ProjectBuilder | null,
  projectMode: ProjectMode
): SubmissionGuardResult {
  const files = builder ? builder.getFiles() : [];
  const getContent = builder
    ? (path: string) => builder.getFileContent(path)
    : undefined;
  return submissionGuard(files, projectMode, getContent);
}
