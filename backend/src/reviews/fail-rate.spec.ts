import { nextFailCounts } from './fail-rate';

const h = (...results: ('pass' | 'fail')[]) => results.map(result => ({ result, stage: 0, timestamp: '' }));

describe('nextFailCounts', () => {
    it('seeds an uncounted card from its history', () => {
        expect(nextFailCounts({ history: h('pass', 'fail', 'fail', 'pass') }, true))
            .toEqual({ reviewCount: 5, failCount: 3, failRate: 0.6 });
    });

    it('adds to stored counts and ignores history', () => {
        expect(nextFailCounts({ reviewCount: 9, failCount: 1, history: h('fail') }, false))
            .toEqual({ reviewCount: 10, failCount: 1, failRate: 0.1 });
    });

    it('leaves failRate off under the minimum', () => {
        expect(nextFailCounts({}, true)).toEqual({ reviewCount: 1, failCount: 1 });
    });
});
