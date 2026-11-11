import type { ProfileGuideTarget } from './profileGuide';

/** Scroll positions are measured against the ScrollView content, not the device screen. */
export type GuideLayoutRegistry = {
  sections: Partial<Record<'account' | 'personalize' | 'help' | 'legal', number>>;
  children: Partial<Record<'sports' | 'kitchen' | 'coach', number>>;
};

export function emptyGuideLayoutRegistry(): GuideLayoutRegistry {
  return { sections: {}, children: {} };
}

/**
 * An unknown measurement must never fall back to 0, because a parent card can
 * lay out after its children. Both measurements are needed for nested targets.
 */
export function guideTargetOffset(
  registry: GuideLayoutRegistry,
  target: ProfileGuideTarget | null,
  padding = 16,
): number | null {
  if (!target) return null;
  const top = target === 'sports' || target === 'kitchen' || target === 'coach'
    ? nestedOffset(registry, target)
    : registry.sections[target];
  return typeof top === 'number' && Number.isFinite(top) && top >= 0
    ? Math.max(0, top - Math.max(0, Number.isFinite(padding) ? padding : 0))
    : null;
}

function nestedOffset(
  registry: GuideLayoutRegistry,
  target: 'sports' | 'kitchen' | 'coach',
): number | null {
  const parent = registry.sections.personalize;
  const child = registry.children[target];
  if (typeof parent !== 'number' || typeof child !== 'number') return null;
  return parent + child;
}
