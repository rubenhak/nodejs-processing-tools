import 'mocha';
import should from 'should';

import { DependencyProcessor } from '../src';
import logger from './logger';

describe('dependency-processor', function () {
    describe('construct', function () {
        it('construct', function () {
            const processor = new DependencyProcessor(logger, 'xxx', () => {
                return true;
            });
            should.exist(processor);
        });
    });
});
