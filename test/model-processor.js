var should = require('should');
var ModelProcessor = require('../model-processor');

var logger = require('./logger');

describe('model-processor', function() {
    describe('construct', function() {
        it('construct', function () {
            var processor = new ModelProcessor(logger);
        });
    });

});
