import { describe, expect, it } from 'vitest';
import { defaultLineup, lineupNames, nextModel, presets } from '../src/overlay';

const ALL = ['typesafe/jev-1.13.0', 'typesafe/jev-1.14.0', 'opper/clef', 'opper/clef-flash', 'berget/convaiinnovations/laya', 'openai/gpt-6-luna-decisions', 'empiriolabs/aplomb-1', 'microsoft/decision-1', 'bespoke/nimble-v4-max', 'perplexity/pplx-decider-v1.2'];

describe('who plays the ghosts', () => {
  it('starts mixed: a different AI behind each ghost', () => {
    expect(defaultLineup(ALL)).toEqual({ blinky: 'opper/clef', pinky: 'typesafe/jev-1.14.0', inky: 'perplexity/pplx-decider-v1.2', clyde: 'openai/gpt-6-luna-decisions' });
    expect(lineupNames(defaultLineup(ALL))).toBe('Clef, jev 1.14, Decider and GPT-6 Luna');
  });

  it('offers Mixed and one model for all four ghosts, only with models the key can use', () => {
    // Short enough that the tabs keep to two lines: the logos and the roster say whose.
    expect(presets(ALL).map((p) => p.label)).toEqual(['Mixed', 'All jev 1.14', 'All Clef', 'All Luna', 'All Decision 1', 'All Decider', 'All Nimble']);
    expect(presets(['typesafe/jev-1.14.0']).map((p) => p.label)).toEqual(['All jev 1.14']);
    // A TypeSafe key reaches jev 1.13 only: no preset, everyone on jev.
    expect(presets(['typesafe/jev-1.13.0'])).toEqual([]);
    expect(defaultLineup(['typesafe/jev-1.13.0'])).toEqual({ blinky: 'typesafe/jev-1.13.0', pinky: 'typesafe/jev-1.13.0', inky: 'typesafe/jev-1.13.0', clyde: 'typesafe/jev-1.13.0' });
    expect(lineupNames(defaultLineup(['typesafe/jev-1.13.0']))).toBe('jev');
    // Perplexity's long names would overflow the roster: the logo says whose.
    expect(lineupNames(defaultLineup(['perplexity/pplx-decider-flash-v1.2']))).toBe('Decider Flash');
  });

  it('switches a tapped ghost to the next model, round the list', () => {
    expect(nextModel('typesafe/jev-1.13.0', ALL)).toBe('typesafe/jev-1.14.0');
    expect(nextModel('perplexity/pplx-decider-v1.2', ALL)).toBe('typesafe/jev-1.13.0');
  });
});
