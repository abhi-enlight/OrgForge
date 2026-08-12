import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateInstanceUrl,
  checkLicenseAvailability,
  checkPackageInstalled,
  checkAgentforceSettings,
  discoverPermissionSets,
  findOrCreateAgentUser,
  assignPermissionSets,
  runPreFlightCheck,
} from './preflight.js';
import { createStubSfApi } from './sfApi.js';

const INSTANCE = 'https://acme.my.salesforce.com';
const TOKEN = 'token-123';

// ── validateInstanceUrl ───────────────────────────────────────────────────
test('validateInstanceUrl accepts salesforce/force hosts over https', () => {
  assert.doesNotThrow(() => validateInstanceUrl('https://acme.my.salesforce.com'));
  assert.doesNotThrow(() => validateInstanceUrl('https://login.salesforce.com'));
  assert.doesNotThrow(() => validateInstanceUrl('https://acme-dev-ed.scratch.my.salesforce.com'));
});

test('validateInstanceUrl rejects http, evil hosts, and garbage', () => {
  assert.throws(() => validateInstanceUrl('http://acme.my.salesforce.com'), /https/);
  assert.throws(() => validateInstanceUrl('https://evil.com'), /hostname/);
  assert.throws(() => validateInstanceUrl('not-a-url'), /Invalid or unsafe/);
  assert.throws(() => validateInstanceUrl(''), /Missing instanceUrl/);
});

// ── checkLicenseAvailability (EC-16) ──────────────────────────────────────
test('license: supported when seats are free', async () => {
  const api = createStubSfApi({
    query: async () => [{ TotalLicenses: 10, UsedLicenses: 3 }],
  });
  const res = await checkLicenseAvailability(TOKEN, INSTANCE, api);
  assert.equal(res.supported, true);
  assert.equal(res.available, 7);
});

test('license: unsupported when all seats used or license absent', async () => {
  const allUsed = createStubSfApi({ query: async () => [{ TotalLicenses: 2, UsedLicenses: 2 }] });
  assert.equal((await checkLicenseAvailability(TOKEN, INSTANCE, allUsed)).supported, false);

  const absent = createStubSfApi({ query: async () => [] });
  const res = await checkLicenseAvailability(TOKEN, INSTANCE, absent);
  assert.equal(res.supported, false);
  assert.match(res.reason, /not found/);
});

test('license: query failure degrades to unsupported, does not throw', async () => {
  const api = createStubSfApi({ query: async () => { throw new Error('INSUFFICIENT_ACCESS'); } });
  const res = await checkLicenseAvailability(TOKEN, INSTANCE, api);
  assert.equal(res.supported, false);
  assert.match(res.reason, /Failed to verify/);
});

// ── checkPackageInstalled (EC-14/EC-15, D7) ───────────────────────────────
test('package: installed when ANY version of the SubscriberPackageId exists (EC-15)', async () => {
  const api = createStubSfApi({
    toolingQuery: async (t, u, soql) => {
      if (soql.includes('SubscriberPackageVersion WHERE Id')) {
        return [{ SubscriberPackageId: '033xyz' }];
      }
      if (soql.includes('InstalledSubscriberPackage WHERE SubscriberPackageId')) {
        return [{ Id: '0A1installed' }];
      }
      return [];
    },
  });
  assert.equal(await checkPackageInstalled(TOKEN, INSTANCE, '04tfj000000NNITAA4', api), true);
});

test('package: missing when no installed row', async () => {
  const api = createStubSfApi({
    toolingQuery: async () => [],
  });
  assert.equal(await checkPackageInstalled(TOKEN, INSTANCE, '04tfj000000NNITAA4', api), false);
});

test('package: falls back to direct version check when 04t is unknown', async () => {
  const api = createStubSfApi({
    toolingQuery: async (t, u, soql) =>
      soql.includes('InstalledSubscriberPackage WHERE SubscriberPackageVersionId') ? [{ Id: 'x' }] : [],
  });
  assert.equal(await checkPackageInstalled(TOKEN, INSTANCE, '04tfj000000NNITAA4', api), true);
});

test('package: query failure returns false (never throws)', async () => {
  const api = createStubSfApi({ toolingQuery: async () => { throw new Error('INVALID_SESSION_ID'); } });
  assert.equal(await checkPackageInstalled(TOKEN, INSTANCE, '04tfj000000NNITAA4', api), false);
});

// ── checkAgentforceSettings (Agentforce Agent + Einstein toggles) ─────────
// Both toggles are Metadata-API-only; the check proxies via BotDefinition.
test('settings: enabled when the BotDefinition Tooling object is queryable', async () => {
  const api = createStubSfApi({
    toolingQuery: async () => [{ Id: '0B7x', Type: 'Agent' }],
  });
  const res = await checkAgentforceSettings(TOKEN, INSTANCE, api);
  assert.equal(res.enabled, true);
});

test('settings: not enabled when the Tooling object is unsupported', async () => {
  const api = createStubSfApi({
    toolingQuery: async () => {
      throw new Error("sObject type 'BotDefinition' is not supported");
    },
  });
  const res = await checkAgentforceSettings(TOKEN, INSTANCE, api);
  assert.equal(res.enabled, false);
  assert.match(res.reason, /not enabled/);
});

test('settings: recognizes the real SfApiError shape (error text in body)', async () => {
  // sfApi throws SfApiError with message "Tooling query failed (400)" and the
  // Salesforce errorCode/message inside err.body — the production shape.
  const api = createStubSfApi({
    toolingQuery: async () => {
      const err = new Error('Tooling query failed (400)');
      err.body = [{ errorCode: 'INVALID_TYPE', message: "sObject type 'BotDefinition' is not supported" }];
      throw err;
    },
  });
  const res = await checkAgentforceSettings(TOKEN, INSTANCE, api);
  assert.equal(res.enabled, false);
});

test('settings: transient failure degrades to unknown, never throws', async () => {
  const api = createStubSfApi({
    toolingQuery: async () => {
      throw new Error('INVALID_SESSION_ID');
    },
  });
  const res = await checkAgentforceSettings(TOKEN, INSTANCE, api);
  assert.equal(res.enabled, null);
});

// ── discoverPermissionSets (EC-18) ────────────────────────────────────────
test('discovers dynamic + fallback permission sets and groups', async () => {
  const api = createStubSfApi({
    query: async (t, u, soql) => {
      if (soql.includes('PermissionSetGroup')) return [{ Id: '0PGgroup', DeveloperName: 'AgentforceBase' }];
      if (soql.includes("Name IN ('AgentforceServiceAgentBase'")) {
        return [
          { Id: '0psFallbackBase' },
          { Id: '0psFallbackUser' },
        ];
      }
      return [
        { Id: '0psDynamic1', Name: 'AgentforceServiceAgentUser', Label: 'Agentforce User' },
        { Id: '0psOther', Name: 'Unrelated', Label: 'Something' },
      ];
    },
  });
  const ids = await discoverPermissionSets(TOKEN, INSTANCE, api);
  assert.ok(ids.includes('0psDynamic1'), 'dynamic match by Name');
  assert.ok(ids.includes('0psFallbackBase'), 'explicit fallback list');
  assert.ok(ids.includes('0PGgroup'), 'permission set group');
  assert.ok(!ids.includes('0psOther'), 'unrelated sets excluded');
});

// ── findOrCreateAgentUser (EC-17) ─────────────────────────────────────────
test('reactivates an existing but deactivated Einstein Agent User', async () => {
  // profile query (first), then existing-user lookup
  const queries = [
    [{ Id: '0PGprofile' }],
    [{ Id: '005user', Username: 'agent@x.com', IsActive: false }],
  ];
  let patched = null;
  const api = createStubSfApi({
    query: async () => queries.shift() || [],
    patch: async (t, u, path, body) => { patched = { path, body }; },
  });
  const user = await findOrCreateAgentUser(TOKEN, INSTANCE, api);
  assert.equal(user.userId, '005user');
  assert.deepEqual(patched, { path: 'User/005user', body: { IsActive: true } });
});

test('creates a new Einstein Agent User when none exists', async () => {
  const queries = [
    [{ Id: '0PGprofile' }],   // profile
    [],                       // no existing user
    [{ Id: '00Dorg' }],       // org info
  ];
  let created = null;
  const api = createStubSfApi({
    query: async () => queries.shift() || [],
    post: async (t, u, name, body) => { created = { name, body }; return { id: '005new' }; },
  });
  const user = await findOrCreateAgentUser(TOKEN, INSTANCE, api);
  assert.equal(user.userId, '005new');
  assert.equal(created.name, 'User/');
  assert.equal(created.body.IsActive, true);
});

// ── assignPermissionSets (tolerates DUPLICATE_VALUE) ──────────────────────
test('assignment tolerates DUPLICATE_VALUE and uses PermissionSetGroupId for 0PG ids', async () => {
  const posts = [];
  let successCount = 0;
  const api = createStubSfApi({
    post: async (t, u, name, body) => {
      posts.push(body);
      // First assignment succeeds; the group assignment is already assigned.
      if (body.PermissionSetGroupId) {
        throw { body: [{ errorCode: 'DUPLICATE_VALUE' }] };
      }
      successCount += 1;
      return { id: 'x' };
    },
  });
  const count = await assignPermissionSets(TOKEN, INSTANCE, '005admin', ['0psA', '0PGgroup'], api);
  assert.equal(count, 1, 'only successful assignments count; DUPLICATE_VALUE is tolerated');
  assert.equal(successCount, 1);
  assert.deepEqual(posts[0], { AssigneeId: '005admin', PermissionSetId: '0psA' });
  assert.deepEqual(posts[1], { AssigneeId: '005admin', PermissionSetGroupId: '0PGgroup' });
});

// ── runPreFlightCheck state machine (plan §12.4) ──────────────────────────
test('full happy path: state=ok, both capabilities ok, provisioning done', async () => {
  const queries = new Map([
    [/UserLicense/, [{ TotalLicenses: 10, UsedLicenses: 2 }]],
    [/Profile WHERE Name/, [{ Id: '0PGprofile' }]],
    [/FROM User/, [{ Id: '005user', Username: 'agent@x.com', IsActive: true }]],
    [/FROM Organization/, [{ Id: '00Dorg', IsSandbox: false }]],
    [/PermissionSetGroup/, [{ Id: '0PGgroup', MasterLabel: 'Agentforce' }]],
    [/PermissionSet WHERE Label/, [{ Id: '0psA', Name: 'AgentforceServiceAgentBase', Label: 'A' }]],
    [/Name IN \(/, []],
  ]);
  const api = createStubSfApi({
    query: async (t, u, soql) => {
      for (const [re, rows] of queries) if (re.test(soql)) return rows;
      return [];
    },
    toolingQuery: async () => {
      return [{ Id: '0A1' }]; // installed
    },
    post: async () => ({ id: '005new' }),
    userinfo: async () => ({ user_id: '005admin' }),
  });

  const res = await runPreFlightCheck(TOKEN, INSTANCE, { api, packageVersionId: '04tfj000000NNITAA4' });
  assert.equal(res.state, 'ok');
  assert.equal(res.capability.agents, 'ok');
  assert.equal(res.capability.org_change, 'ok');
  assert.equal(res.checks.package.installed, true);
  assert.equal(res.checks.settings.agentforceEnabled, true);
  assert.equal(res.checks.provisioning.permissionsAssigned, true);
  assert.equal(res.agentUsername, 'agent@x.com');
  assert.equal(res.checks.orgType.detected, 'production');
});

test('package missing: state=attention, org_change blocked, provisioning skipped (EC-14)', async () => {
  const api = createStubSfApi({
    query: async () => [{ TotalLicenses: 10, UsedLicenses: 2 }],
    toolingQuery: async () => [], // not installed
  });
  const res = await runPreFlightCheck(TOKEN, INSTANCE, { api });
  assert.equal(res.state, 'attention');
  assert.equal(res.checks.package.installed, false);
  assert.equal(res.capability.agents, 'attention');
  assert.equal(res.capability.org_change, 'attention');
  assert.equal(res.agentUsername, null, 'provisioning must be skipped when package missing');
});

test('settings disabled: agents attention, org_change ok, provisioning skipped', async () => {
  const api = createStubSfApi({
    query: async (t, u, soql) => {
      if (soql.includes('UserLicense')) return [{ TotalLicenses: 5, UsedLicenses: 1 }];
      return [];
    },
    toolingQuery: async (t, u, soql) => {
      // Package installed (any tooling query), but BotDefinition is unknown →
      // the Agentforce/Einstein settings proxy reports disabled.
      if (soql.includes('BotDefinition')) {
        throw new Error("sObject type 'BotDefinition' is not supported");
      }
      return [{ Id: '0A1' }];
    },
  });
  const res = await runPreFlightCheck(TOKEN, INSTANCE, { api, packageVersionId: '04tfj000000NNITAA4' });
  assert.equal(res.state, 'attention');
  assert.equal(res.capability.agents, 'attention');
  assert.equal(res.capability.org_change, 'ok', 'settings never gate org changes');
  assert.equal(res.checks.settings.agentforceEnabled, false);
  assert.match(res.checks.settings.reason, /Enable Agentforce Agent and Einstein/);
  assert.equal(res.agentUsername, null, 'provisioning skipped when settings disabled');
});

test('license unsupported but package present: org_change stays ok, agents attention (EC-16)', async () => {
  const api = createStubSfApi({
    query: async () => [], // no Einstein Agent license row
    toolingQuery: async () => [{ Id: '0A1' }], // installed
  });
  const res = await runPreFlightCheck(TOKEN, INSTANCE, { api });
  assert.equal(res.state, 'attention');
  assert.equal(res.capability.agents, 'attention');
  assert.equal(res.capability.org_change, 'ok', 'EC-16: org changes must not depend on the Agentforce license');
  assert.match(res.checks.license.reason, /not found/);
});

test('invalid instance URL fails fast before any API calls', async () => {
  await assert.rejects(() => runPreFlightCheck(TOKEN, 'http://evil.com', {}), /Invalid or unsafe/);
});

test('sandbox detection (EC-13): IsSandbox=true yields sandbox', async () => {
  const api = createStubSfApi({
    query: async () => [{ IsSandbox: true }],
  });
  const res = await runPreFlightCheck(TOKEN, INSTANCE, { api });
  assert.equal(res.checks.orgType.detected, 'sandbox');
});
