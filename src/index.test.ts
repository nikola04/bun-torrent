import { expect, test } from 'bun:test';

import * as api from './index';

test('public entrypoint loads', () => {
    expect(api).toBeDefined();
});
