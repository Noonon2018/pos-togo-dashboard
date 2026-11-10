import { mergeKind, mergeWarning } from './mergeCheck';

const cats: Record<string, string> = {
  VISIBLE: 'phone',
  'ATM CASH': 'cash',
  'GOOGLE PLAY: MICROSOFT ON': 'apps',
  AMAZON: 'shopping',
  'AMAZON MKTPL': 'shopping',
  'MYSTERY SHOP': 'other',
  'TRANSFER SAV 7788': 'transfer',
};
const catOf = (n: string) => cats[n] ?? null;
const accounts = ['Chase College Checking …3719', 'Savings'];

describe('mergeWarning', () => {
  it('flags the real mistake: ATM cash and Microsoft merged into the phone bill', () => {
    expect(mergeWarning(['ATM CASH', 'GOOGLE PLAY: MICROSOFT ON'], 'VISIBLE', catOf, accounts)).toEqual({
      kind: 'crossCategory',
      items: [
        { name: 'ATM CASH', category: 'cash' },
        { name: 'GOOGLE PLAY: MICROSOFT ON', category: 'apps' },
      ],
      target: 'VISIBLE',
      targetCategory: 'phone',
    });
  });
  it('lets same-category merges through (the normal clean-up)', () => {
    expect(mergeWarning(['AMAZON MKTPL'], 'AMAZON', catOf, accounts)).toEqual({ kind: 'none' });
  });
  it('lets unknown shops be merged into a known one, and renames to a new name', () => {
    expect(mergeWarning(['MYSTERY SHOP'], 'AMAZON', catOf, accounts).kind).toBe('none');
    expect(mergeWarning(['VISIBLE'], 'Visible Wireless', catOf, accounts).kind).toBe('none');
  });
  it('flags mixing categories even under a brand-new name', () => {
    expect(mergeWarning(['VISIBLE', 'ATM CASH'], 'Phone & cash', catOf, accounts).kind).toBe('crossCategory');
  });
  it('warns when a non-transfer is merged into my own account', () => {
    expect(mergeWarning(['ATM CASH'], 'savings', catOf, accounts)).toEqual({ kind: 'toAccount', names: ['ATM CASH'] });
    expect(mergeWarning(['TRANSFER SAV 7788'], 'Savings', catOf, accounts)).toEqual({ kind: 'none' });
  });
  it('ignores empty targets and merging a name into itself', () => {
    expect(mergeWarning(['VISIBLE'], '  ', catOf, accounts).kind).toBe('none');
    expect(mergeWarning(['VISIBLE'], 'VISIBLE', catOf, accounts).kind).toBe('none');
  });
});

describe('mergeKind', () => {
  it('tells merge, rename and account apart', () => {
    const names = new Set(Object.keys(cats));
    expect(mergeKind('VISIBLE', names, accounts)).toBe('merge');
    expect(mergeKind('Visible Wireless', names, accounts)).toBe('rename');
    expect(mergeKind('SAVINGS', names, accounts)).toBe('account');
  });
});
