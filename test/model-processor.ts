import 'mocha';
import should from 'should';

import { ModelProcessor } from '../src';
import logger from './logger';

describe('model-processor', function () {
    describe('construct', function () {
        it('construct', function () {
            const processor = new ModelProcessor(logger);
            should.exist(processor);
        });
    });
});
