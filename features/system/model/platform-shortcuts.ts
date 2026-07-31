export interface PlatformNavigator {
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
}

type ShortcutEvent = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">;

function currentNavigator(): PlatformNavigator | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

export function isMacPlatform(source: PlatformNavigator | undefined = currentNavigator()): boolean {
  const platform = source?.userAgentData?.platform || source?.platform || source?.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function primaryShortcutLabel(key: string, source?: PlatformNavigator): string {
  return isMacPlatform(source) ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}

function hasSupportedModifier(event: ShortcutEvent, source?: PlatformNavigator): boolean {
  const primary = isMacPlatform(source) ? event.metaKey : event.ctrlKey;
  const compatibilityModifier = isMacPlatform(source) ? event.ctrlKey : event.metaKey;
  return primary || compatibilityModifier;
}

export function isSaveShortcut(event: ShortcutEvent, source?: PlatformNavigator): boolean {
  return !event.altKey && !event.shiftKey && hasSupportedModifier(event, source) && event.key.toLowerCase() === "s";
}

export function historyShortcut(
  event: ShortcutEvent,
  source?: PlatformNavigator,
): "undo" | "redo" | null {
  if (event.altKey || !hasSupportedModifier(event, source)) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}
