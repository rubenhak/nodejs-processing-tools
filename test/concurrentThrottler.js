var should = require('should');
var _ = require('the-lodash');
var Promise = require('the-promise');

var ConcurrentThrottler = require('../concurrentThrottler');

function newThrottler(config)
{
    var throttler = new ConcurrentThrottler(require('./logger'), config);
    return throttler;
}

describe('concurrentThrottler.js', function() {
    describe('execute', function() {
        it('normal', function () {
            var activeActions = {};
            var waitigActions = {};
            var throttler = newThrottler({number: 5});

            var jobNames = []
            for(var i = 0; i < 200; i++) {
                jobNames.push('action-' + i);
            }

            return Promise.parallel(jobNames, name => {
                waitigActions[name] = true;
                return throttler.execute(() => {
                    activeActions[name] = true;
                    should(_.keys(activeActions).length).be.lessThanOrEqual(5);

                    return new Promise((resolve, reject) => {
                        setTimeout(() => {
                            delete waitigActions[name];
                            delete activeActions[name];
                            resolve('ok');
                        }, 10);
                    });
                }, name);
            })
            .then(() => {
                should(_.keys(waitigActions).length).be.exactly(0);
            })
        });
    });

});