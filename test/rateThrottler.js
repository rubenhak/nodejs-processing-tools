var should = require('should');
var _ = require('the-lodash');
var Promise = require('the-promise');

var RateThrottler = require('../rateThrottler');

function newThrottler(config)
{
    var throttler = new RateThrottler(require('./logger'), config);
    return throttler;
}

describe('rateThrottler.js', function() {
    describe('execute', function() {
        it('normal', function () {
            this.timeout(6 * 1000)

            var waitingActions = {};
            var throttler = newThrottler({interval: 1000, number: 10});

            var jobNames = []
            for(var i = 0; i < 45; i++) {
                jobNames.push('action-' + i);
            }

            return Promise.parallel(jobNames, name => {
                waitingActions[name] = true;
                return throttler.execute(() => {

                    return new Promise((resolve, reject) => {
                        setTimeout(() => {
                            delete waitingActions[name];
                            resolve('ok');
                        }, 10);
                    });
                }, name);
            })
            .then(() => {
                should(_.keys(waitingActions).length).be.exactly(0);
            })
        });
    });

});