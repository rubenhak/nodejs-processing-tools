import 'mocha';
import should from 'should';
import _ from 'the-lodash';
import { MyPromise } from 'the-promise';

import { ConcurrentThrottler, ConcurrentThrottlerConfig } from '../src';
import logger from './logger';

function newThrottler(config: ConcurrentThrottlerConfig): ConcurrentThrottler {
    return new ConcurrentThrottler(logger, config);
}

describe('concurrent-throttler', function () {
    describe('execute', function () {
        it('normal', function () {
            const activeActions: Record<string, boolean> = {};
            const waitingActions: Record<string, boolean> = {};
            const throttler = newThrottler({ number: 5 });

            const jobNames: string[] = [];
            for (let i = 0; i < 200; i++) {
                jobNames.push('action-' + i);
            }

            return MyPromise.parallel(jobNames, (name) => {
                waitingActions[name] = true;
                return throttler.execute(() => {
                    activeActions[name] = true;
                    should(_.keys(activeActions).length).be.lessThanOrEqual(5);

                    return new Promise((resolve) => {
                        setTimeout(() => {
                            delete waitingActions[name];
                            delete activeActions[name];
                            resolve('ok');
                        }, 10);
                    });
                }, name);
            }).then(() => {
                should(_.keys(waitingActions).length).be.exactly(0);
            });
        });
    });
});
