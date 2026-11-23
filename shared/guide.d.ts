import type { GuideCatalog, GuideCriteria, GuideMatch, Problem } from '../web/types';

export const guideFilterFields: readonly (keyof GuideCriteria)[];
export function guideMatches(catalog: GuideCatalog, criteria: GuideCriteria, sectionWeights?:Record<string,number>|null): GuideMatch[];
export function guideSections(matches: GuideMatch[]): {key:string;label:string;problems:Problem[]}[];
