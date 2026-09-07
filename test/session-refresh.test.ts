import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isGraphQLAuthenticationFailure, withSessionRefresh} from '../src/shared/session-refresh.js';

test('GraphQL partial results, authorization errors and malformed envelopes never trigger replay', () => {
  const auth = {extensions: {code: 'UNAUTHENTICATED'}};
  assert.equal(isGraphQLAuthenticationFailure({data: null, errors: [auth]}), true);
  for (const value of [null, {}, {errors: []}, {errors: [null]}, {data: {partial: true}, errors: [auth]},
    {errors: [{extensions: {code: 'FORBIDDEN'}}]}, {errors: [auth, {extensions: {code: 'INTERNAL_SERVER_ERROR'}}]}]) {
    assert.equal(isGraphQLAuthenticationFailure(value), false);
  }
});

test('failed refresh stops the operation and does not replay a request', async () => {
  let sends = 0, refreshes = 0;
  await assert.rejects(withSessionRefresh(async () => {sends++; throw {status: 401};}, async () => {refreshes++; throw new Error('renewal failed');}));
  assert.equal(sends, 1); assert.equal(refreshes, 1);
});
