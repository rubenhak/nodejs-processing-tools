var assert = require('assert');
// var calculator = require('../index');
var calculator = {
    add: function (a, b) {
        return a + b;
    }
};

describe('calculator', function() {
    describe('add function', function() {
        it('adds numbers', function () {
            var result = calculator.add(1, 1);
            assert.equal(result, 2);
        });
        it('adds larger numbers', function () {
            var result = calculator.add(3, 4);
            assert.equal(result, 7);
        });
    });
});