var should = require('should');
var RepoStore = require('../repo-store');

var logger = require('./logger');

describe('repo-store.js', function() {
    describe('construct', function() {
        it('construct', function () {
            var store = new RepoStore(logger, "sample");
            store.setupRepository('contacts').description('PEOPLE LIST');
        });
    });
});
