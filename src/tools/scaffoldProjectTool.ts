/**
 * BlindSprint: Emit the base file tree for the chosen template.
 * Modes: vite-react-ts-tailwind (default) or static-html-css-js (fallback for tiny prompts).
 */

export type ScaffoldMode = "vite-react-ts-tailwind" | "static-html-css-js";

export interface ScaffoldProjectResult {
  mode: ScaffoldMode;
  files: string[];
  description: string;
}

const VITE_REACT_TREE: string[] = [
  "package.json",
  "index.html",
  "README.md",
  "tsconfig.json",
  "vite.config.ts",
  "postcss.config.js",
  "tailwind.config.js",
  "src/main.tsx",
  "src/App.tsx",
  "src/index.css",
  "src/data/mockData.ts",
  "src/components/Header.tsx",
  "src/components/Hero.tsx",
  "src/components/FeatureGrid.tsx",
  "src/components/Footer.tsx",
  "src/styles/globals.css",
];

const STATIC_TREE: string[] = [
  "index.html",
  "styles.css",
  "script.js",
  "README.md",
  "assets/.gitkeep",
];

export function scaffoldProject(mode: ScaffoldMode): ScaffoldProjectResult {
  if (mode === "static-html-css-js") {
    return {
      mode: "static-html-css-js",
      files: STATIC_TREE,
      description: "Plain HTML/CSS/JS; no build step. Use for very small or static-only prompts.",
    };
  }
  return {
    mode: "vite-react-ts-tailwind",
    files: VITE_REACT_TREE,
    description:
      "Vite + React + TypeScript + Tailwind. Add components under src/components/ and mock data in src/data/mockData.ts.",
  };
}
