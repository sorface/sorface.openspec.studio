import type { OpenSpecAction } from "@/features/openspec-workflow/model/openspec-types";

export function changeFromDocumentPath(path: string): string | null {
  const match = /^openspec\/changes\/([^/]+)\/(.+\.md)$/.exec(path);
  if (!match || match[1] === "archive") return null;
  return match[1];
}

export function actionMatchesDocument(action: Pick<OpenSpecAction, "outputPaths">, path: string): boolean {
  return action.outputPaths?.some((outputPath) => {
    if (outputPath === path) return true;
    const globIndex = outputPath.indexOf("**");
    return globIndex >= 0 && path.startsWith(outputPath.slice(0, globIndex));
  }) ?? false;
}
