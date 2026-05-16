import { KuFacetSequence } from '../types';

/**
 * Defines the ordered unlock sequence for each KU type.
 *
 * unlockAtSrsStage: all facets in this stage must reach this SRS stage before
 * the next stage's facets are created. Corresponds roughly to:
 *   1 = ~4 h   2 = ~8 h   3 = ~1 day   4 = ~2 days   5 = ~1 week
 *
 * null = terminal — no further stages unlock from here.
 *
 * Stages with source 'kanji-components' are skipped automatically for KUs
 * whose lesson has no component_kanji entries.
 */
export const FACET_SEQUENCES: KuFacetSequence[] = [
  {
    kuType: 'Vocab',
    stages: [
      {
        stage: 1,
        facets: [{ type: 'Kanji-Component-Meaning', source: 'kanji-components' }],
        unlockAtSrsStage: 2,
      },
      {
        stage: 2,
        facets: [{ type: 'Content-to-Definition', source: 'primary' }],
        unlockAtSrsStage: 3,
      },
      {
        stage: 3,
        facets: [{ type: 'Definition-to-Content', source: 'primary' }],
        unlockAtSrsStage: 3,
      },
      {
        stage: 4,
        facets: [{ type: 'Content-to-Reading', source: 'primary' }],
        unlockAtSrsStage: 4,
      },
      {
        stage: 5,
        facets: [{ type: 'audio', source: 'primary' }],
        unlockAtSrsStage: 4,
      },
      {
        stage: 6,
        facets: [{ type: 'AI-Generated-Question', source: 'primary' }],
        unlockAtSrsStage: 5,
      },
      {
        stage: 7,
        facets: [{ type: 'Kanji-Component-Reading', source: 'kanji-components' }],
        unlockAtSrsStage: null,
      },
    ],
  },
  {
    kuType: 'Kanji',
    stages: [
      {
        stage: 1,
        facets: [{ type: 'Kanji-Component-Meaning', source: 'primary' }],
        unlockAtSrsStage: 2,
      },
      {
        stage: 2,
        facets: [{ type: 'Kanji-Component-Reading', source: 'primary' }],
        unlockAtSrsStage: null,
      },
    ],
  },
  {
    kuType: 'Grammar',
    stages: [
      {
        stage: 1,
        facets: [{ type: 'sentence-assembly', source: 'examples' }],
        unlockAtSrsStage: 3,
      },
      {
        stage: 2,
        facets: [{ type: 'AI-Generated-Question', source: 'primary' }],
        unlockAtSrsStage: null,
      },
    ],
  },
  {
    kuType: 'Concept',
    stages: [
      {
        stage: 1,
        facets: [{ type: 'sentence-assembly', source: 'examples' }],
        unlockAtSrsStage: 3,
      },
      {
        stage: 2,
        facets: [{ type: 'AI-Generated-Question', source: 'primary' }],
        unlockAtSrsStage: null,
      },
    ],
  },
];
