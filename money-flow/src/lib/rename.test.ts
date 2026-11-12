import { renameCounterparty, unmerge } from './rename';
import { resolveAlias } from './normalize';

describe('renameCounterparty', () => {
  const raw = ['AMAZON', 'AMZN DIGITAL', 'NETFLIX'];
  it('renames and merges', () => {
    let a = renameCounterparty({}, raw, 'AMZN DIGITAL', 'AMAZON');
    expect(resolveAlias('AMZN DIGITAL', a)).toBe('AMAZON');
    a = renameCounterparty(a, raw, 'AMAZON', 'Amazon (all)');
    expect(resolveAlias('AMAZON', a)).toBe('Amazon (all)');
    expect(resolveAlias('AMZN DIGITAL', a)).toBe('Amazon (all)');
    expect(resolveAlias('NETFLIX', a)).toBe('NETFLIX');
  });
  it('renaming back does not create a cycle', () => {
    let a = renameCounterparty({}, raw, 'NETFLIX', 'Streaming');
    a = renameCounterparty(a, raw, 'Streaming', 'NETFLIX');
    expect(resolveAlias('NETFLIX', a)).toBe('NETFLIX');
    expect(a).toEqual({});
  });
  it('unmerge restores one key', () => {
    const a = renameCounterparty({}, raw, 'AMZN DIGITAL', 'AMAZON');
    expect(resolveAlias('AMZN DIGITAL', unmerge(a, 'AMZN DIGITAL'))).toBe('AMZN DIGITAL');
  });
  it('ignores empty / identical names', () => {
    const a = { X: 'Y' };
    expect(renameCounterparty(a, raw, 'NETFLIX', '  ')).toBe(a);
    expect(renameCounterparty(a, raw, 'NETFLIX', 'NETFLIX')).toBe(a);
  });
});
