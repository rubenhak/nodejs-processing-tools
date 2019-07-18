var should = require('should');
var DependencyProcessor = require('../dependency-processor');

var logger = require('./logger');

describe('dependency-processor', function() {
    describe('construct', function() {
        it('construct', function () {
            var processor = new DependencyProcessor(logger, 'xxx', x => {

            });
        });
    });

});
