const assert = require('node:assert/strict');
const M = require('./evaluations.js');
const raw = (id, extra = {}) => ({id, kind: 'evaluator', begin_at: '2026-10-20T18:45:00+09:00',
    project_name: 'Fixture project', ...extra});
const rows = ids => M.parseRows(ids.map(id => raw(id)));
const reject = value => assert.throws(() => M.parseRows(value));
assert.equal(M.identifier(123), '123');
assert.equal(M.identifier('fixture-id'), 'fixture-id');
for (const id of [null, {}, [], 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'unsafe/id', '\n', 'x'.repeat(129)])
    assert.throws(() => M.identifier(id));
assert.deepEqual(M.parseRows([]), []);
assert.equal(rows([1])[0].project, 'Fixture project');
assert.equal(M.parseRows([{id: 'abc', kind: 'evaluator', beginAt: '2026-10-20T09:45:00Z', projectName: 'Camel'}])[0].project, 'Camel');
assert.deepEqual(M.parseRows([raw(1, {kind: 'evaluated'})]), []);
assert.equal(M.parseRows([raw(1, {project_name: null})])[0].project, '');
for (const value of [{}, null, [null], [raw(1), raw(1)], Array(1001).fill(raw(1)),
    [raw(1, {begin_at: '2026-10-20T18:45:00'})], [raw(1, {begin_at: '2026-02-30T18:45:00Z'})],
    [raw(1, {begin_at: 'invalid'})], [raw(1, {kind: null})], [raw(1, {project_name: {}})]]) reject(value);

let plan = M.advanceSeen(null, 'subject-a', rows([1]));
assert.deepEqual(plan.added, []); // Existing entries at first launch are silent.
plan = M.advanceSeen(plan.state, 'subject-a', rows([1, 2]));
assert.deepEqual(plan.added.map(row => row.id), ['2']);
let stored = M.storedState(JSON.stringify(plan.state));
assert.deepEqual(M.advanceSeen(stored, 'subject-a', rows([2, 1])).added, []);
plan = M.advanceSeen(stored, 'subject-a', []);
assert.deepEqual(M.advanceSeen(plan.state, 'subject-a', rows([1, 2])).added, []); // Removal isn't forgetting.
assert.deepEqual(M.advanceSeen(plan.state, 'subject-b', rows([1, 2])).added, []); // Separate account baseline.
let empty = M.advanceSeen(null, 'subject-a', []).state;
assert.equal(M.advanceSeen(M.storedState(JSON.stringify(empty)), 'subject-a', rows([3])).added.length, 1);
const large = {version: 1, subject: 'subject-a', ids: Array.from({length: 2000}, (_, index) => String(index + 1))};
const capped = M.advanceSeen(large, 'subject-a', rows([3000, 3001]));
assert.equal(capped.state.ids.length, 2000);
assert.deepEqual(capped.state.ids.slice(0, 2), ['3000', '3001']);
assert.deepEqual(M.storedState(JSON.stringify(capped.state)), capped.state);
for (const state of ['oops', '{}', 'null', JSON.stringify({...large, version: 2}),
    JSON.stringify({...large, ids: [1]}), JSON.stringify({...large, ids: ['1', '1']}),
    JSON.stringify({...large, ids: Array(2001).fill('1')})]) assert.throws(() => M.storedState(state));

const claims = {iss: 'https://auth.42.fr/auth/realms/students-42', sub: 'fixture-id',
    preferred_username: 'fixture-login', exp: 1000};
assert.deepEqual(M.claimsInfo(claims, 'fixture-login'), {subject: 'fixture-id', login: 'fixture-login'});
assert.throws(() => M.claimsInfo(claims, 'someone-else'), /account-error/);
for (const bad of [null, {...claims, iss: 'https://example.test'}, {...claims, sub: ''}, {...claims, exp: null}])
    assert.throws(() => M.claimsInfo(bad, 'fixture-login'));
assert.equal(M.retryAfter('75'), 75);
assert.equal(M.retryAfter('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('2026-10-21T07:27:00Z')), 60);
for (const value of [null, '', '-1', 'invalid', '9'.repeat(110)]) assert.equal(M.retryAfter(value), 0);
const note = M.notification(rows([123])[0]);
assert.equal(note.id, 'intrapy:123');
assert.ok(note.body.includes('Fixture project') && note.body.includes('평가 123'));
assert.ok(note.body.length <= 1000);
console.log('PASS: intrapy schema/roles/time validation, account binding, silent baseline, new IDs, restart/dedup, bounded state and retry hints');
