import test from 'node:test';
import assert from 'node:assert/strict';
import { sortMatchesByKickoffProximity } from '../lib/matches/related-matches';

test('related matches are sorted by absolute kickoff distance, with stable ties and invalid dates last', () => {
  const matches = [
    { id: 'far-before', utcKickoff: '2026-10-01T12:00:00.000Z' },
    { id: 'mid-before', utcKickoff: '2026-10-06T12:00:00.000Z' },
    { id: 'near-after', utcKickoff: '2026-10-16T12:00:00.000Z' },
    { id: 'near-before', utcKickoff: '2026-10-14T12:00:00.000Z' },
    { id: 'far-after', utcKickoff: '2026-10-25T12:00:00.000Z' },
    { id: 'invalid', utcKickoff: 'not-a-date' },
  ];
  const originalOrder = matches.map((match) => match.id);

  const sorted = sortMatchesByKickoffProximity(matches, '2026-10-15T12:00:00.000Z');

  assert.deepEqual(
    sorted.map((match) => match.id),
    ['near-after', 'near-before', 'mid-before', 'far-after', 'far-before', 'invalid']
  );
  assert.deepEqual(matches.map((match) => match.id), originalOrder, 'the input array is not mutated');
});

test('an invalid reference timestamp preserves input order', () => {
  const matches = [
    { id: 'first', utcKickoff: '2026-10-14T12:00:00.000Z' },
    { id: 'second', utcKickoff: '2026-10-16T12:00:00.000Z' },
  ];

  assert.deepEqual(
    sortMatchesByKickoffProximity(matches, 'invalid').map((match) => match.id),
    ['first', 'second']
  );
});
