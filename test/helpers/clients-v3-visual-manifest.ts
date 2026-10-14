export type VisualCaptureStatus = "planned" | "captured" | "missing" | "not-run" | "skipped";

export type VisualCapturePlanEntry = {
  file: string;
  role: string;
  scenario: string;
  viewport: string;
  theme: string;
  status: VisualCaptureStatus;
};

export function buildVisualCaptureFilename(
  sha: string,
  slug: string,
  viewport: { width: number; height: number },
  theme?: "dark",
): { file: string; viewportLabel: string; themeLabel: string } {
  const themeSuffix = theme === "dark" ? "-dark" : "";
  const viewportLabel = viewport.width <= 400 ? "mobile" : "desktop";
  const themeLabel = theme === "dark" ? "dark" : "light";
  const file = `${sha}-${slug}-${viewportLabel}${themeSuffix}.png`;
  return { file, viewportLabel, themeLabel };
}

export function finalizeVisualManifest(input: {
  sha: string;
  planned: VisualCapturePlanEntry[];
  scenariosCompleted: boolean;
}): {
  runStatus: "complete" | "partial";
  plannedCaptureCount: number;
  capturedCount: number;
  missingCount: number;
  notRunCount: number;
  captures: VisualCapturePlanEntry[];
} {
  const captures = input.planned.map((entry) => ({ ...entry }));
  let capturedCount = 0;
  let missingCount = 0;
  let notRunCount = 0;
  for (const entry of captures) {
    if (entry.status === "captured") {
      capturedCount += 1;
    } else if (entry.status === "not-run" || entry.status === "planned") {
      notRunCount += 1;
      entry.status = entry.status === "planned" ? "not-run" : entry.status;
    } else {
      missingCount += 1;
    }
  }
  const allCaptured = capturedCount === captures.length && captures.length > 0;
  const runStatus = input.scenariosCompleted && allCaptured ? "complete" : "partial";
  return {
    runStatus,
    plannedCaptureCount: captures.length,
    capturedCount,
    missingCount: captures.length - capturedCount,
    notRunCount,
    captures,
  };
}
