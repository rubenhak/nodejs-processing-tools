import 'mocha';
import should from 'should';

import { RepoStore } from '../src';
import logger from './logger';

describe('repo-store', function () {
    describe('construct', function () {
        it('construct', function () {
            const store = new RepoStore(logger, 'sample');
            store.setupRepository('contacts').description('PEOPLE LIST');
            should.exist(store);
        });
    });
});
