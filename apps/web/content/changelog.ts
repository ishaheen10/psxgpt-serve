// Public changelog shown at /docs#changelog.
//
// DO NOT add entries here. Ground truth is one JSON record per change in the
// changes/ directory of the repo where the change originated. Add a record there,
// then regenerate:
//   node scripts/sync-changelog.mjs

import { GENERATED_CHANGELOG } from './changelog.generated';

export type ChangeTag = 'new' | 'improvement' | 'fix';

export interface ChangelogEntry {
  id: string;
  date: string;
  tag: ChangeTag;
  title: string;
  points: string[];
}

export const CHANGELOG: ChangelogEntry[] = GENERATED_CHANGELOG;
