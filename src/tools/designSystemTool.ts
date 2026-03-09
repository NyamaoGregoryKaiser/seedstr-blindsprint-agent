/**
 * BlindSprint: Return a coherent design system for the project.
 * Color palette, typography, spacing, radius/shadows, component variants.
 */

export interface DesignSystemResult {
  colorPalette: string;
  typographyScale: string;
  spacingScale: string;
  radiusAndShadows: string;
  componentVariants: string;
}

const PRESETS: Record<string, DesignSystemResult> = {
  default: {
    colorPalette:
      "Background: white/slate-50. Text: slate-800/900. Accent: single color (e.g. blue-600, indigo-600). Borders: slate-200. Success/error: green-600, red-600.",
    typographyScale:
      "Headings: text-2xl to text-4xl, font-semibold. Body: text-base. Small: text-sm. Max 2 font families (e.g. system + one display).",
    spacingScale:
      "8pt rhythm: 4, 8, 12, 16, 24, 32, 48, 64 (Tailwind 1–8 scale). Section padding 24–32.",
    radiusAndShadows:
      "Cards/inputs: rounded-lg (8px). Buttons: rounded-md. Subtle shadow: shadow-sm. Cards: shadow-md.",
    componentVariants:
      "Primary button: accent bg, white text. Secondary: outline or muted. Cards: white bg, border or shadow. Inputs: border, focus ring.",
  },
  premium: {
    colorPalette:
      "Dark or light; one accent (gold/emerald). High contrast text. Muted secondary.",
    typographyScale:
      "Serif or distinctive sans for headings; clean sans for body. Clear hierarchy.",
    spacingScale:
      "Generous whitespace; 8pt rhythm; large section gaps.",
    radiusAndShadows:
      "Rounded-xl for cards; subtle shadows; no heavy borders.",
    componentVariants:
      "Refined buttons; minimal borders; accent on hover/focus.",
  },
  minimal: {
    colorPalette:
      "Neutral grays; one accent only; lots of white space.",
    typographyScale:
      "One font family; size and weight for hierarchy only.",
    spacingScale:
      "8pt rhythm; generous padding; max-width container.",
    radiusAndShadows:
      "rounded-lg; shadow-sm only where needed.",
    componentVariants:
      "Flat or outline buttons; simple cards; no clutter.",
  },
};

export function designSystem(tone: "default" | "premium" | "minimal" = "default"): DesignSystemResult {
  return PRESETS[tone] ?? PRESETS.default;
}
