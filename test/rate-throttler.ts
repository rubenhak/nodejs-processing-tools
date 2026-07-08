import 'mocha';
import should from 'should';
import _ from 'the-lodash';
import { MyPromise } from 'the-promise';

import { RateThrottler, RateThrottlerConfig } from '../src';
import logger from './logger';

function newThrottler(config: RateThrottlerConfig): RateThrottler {
    return new RateThrottler(logger, config);
}

describe('rate-throttler', function () {
    describe('execute', function () {
        it('normal', function () {
            this.timeout(6 * 1000);

            const waitingActions: Record<string, boolean> = {};
            const throttler = newThrottler({ interval: 1000, number: 10 });

            const jobNames: string[] = [];
            for (let i = 0; i < 45; i++) {
                jobNames.push('action-' + i);
            }

            return MyPromise.parallel(jobNames, (name) => {
                waitingActions[name] = true;
                return throttler.execute(() => {
                    return new Promise((resolve) => {
                        setTimeout(() => {
                            delete waitingActions[name];
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
