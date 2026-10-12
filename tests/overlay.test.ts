import { describe, expect, it } from 'vitest';
import { defaultLineup, lineupNames, nextModel, presets } from '../src/overlay';

const ALL = ['typesafe/jev-1.13.0', 'opper/clef', 'opper/clef-flash', 'opper/kev-4b', 'berget/convaiinnovations/laya', 'openai/gpt-6-luna-decisions', 'empiriolabs/aplomb-1', 'microsoft/decision-1'];

describe('who plays the ghosts', () => {
  it('starts mixed: a different AI behind each ghost', () => {
    expect(defaultLineup(ALL)).toEqual({ blinky: 'opper/clef', pinky: 'typesafe/jev-1.13.0', inky: 'opper/kev-4b', clyde: 'openai/gpt-6-luna-decisions' });
    expect(lineupNames(defaultLineup(ALL))).toBe('Clef, jev, Kev and GPT-6 Luna');
  });

  it('offers Mixed and one model for all four ghosts, only with models the key can use', () => {
    expect(presets(ALL).map((p) => p.label)).toEqual(['Mixed', 'All jev', 'All Clef', 'All Kev', 'All GPT-6 Luna', 'All Decision 1', 'All Aplomb 1']);
    expect(presets(['typesafe/jev-1.13.0']).map((p) => p.label)).toEqual(['All jev']);
    expect(defaultLineup(['typesafe/jev-1.13.0'])).toEqual({ blinky: 'typesafe/jev-1.13.0', pinky: 'typesafe/jev-1.13.0', inky: 'typesafe/jev-1.13.0', clyde: 'typesafe/jev-1.13.0' });
    expect(lineupNames(defaultLineup(['typesafe/jev-1.13.0']))).toBe('jev');
  });

  it('switches a tapped ghost to the next model, round the list', () => {
    expect(nextModel('typesafe/jev-1.13.0', ALL)).toBe('opper/clef');
    expect(nextModel('microsoft/decision-1', ALL)).toBe('typesafe/jev-1.13.0');
  });
});
