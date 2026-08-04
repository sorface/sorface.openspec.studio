export function isMasterSpecPath(path: string | null): boolean {
  return /^openspec\/specs\/[^/]+\/spec\.md$/.test(path ?? "");
}

export function isDeltaSpecPath(path: string | null): boolean {
  return /^openspec\/changes\/[^/]+\/(?:spec|specs)\/[^/]+\/spec\.md$/.test(path ?? "");
}

export function isUserReadOnlySpecPath(path: string | null): boolean {
  return isMasterSpecPath(path) || isDeltaSpecPath(path);
}
