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

test('package: ECA fallback reports installed when the package row is absent but the ECA exists', async () => {
  // Unmanaged install / pinned-id mismatch: InstalledSubscriberPackage has no
  // row, but the External Client Application (the OAuth client OrgForge uses) is
  // present → the connector IS set up → installed. ExternalClientApplication
  // is a STANDARD REST object, so the fallback queries api.query (a Tooling
  // query returns "sObject type not supported" in real orgs).
  const api = createStubSfApi({
    toolingQuery: async () => [], // no managed-package row
    query: async (t, u, soql) =>
      soql.includes('ExternalClientApplication') ? [{ Id: '0J4eca' }] : [],
  });
  assert.equal(await checkPackageInstalled(TOKEN, INSTANCE, '04tfj000000NNITAA4', api), true);
});

test('package: ECA fallback keeps missing when neither package row nor ECA exists', async () => {
  const api = createStubSfApi({ toolingQuery: async () => [], query: async () => [] });
  assert.equal(await checkPackageInstalled(TOKEN, INSTANCE, '04tfj000000NNITAA4', api), false);
});

test('package: ECA query failure degrades to the package verdict (non-fatal)', async () => {
  const api = createStubSfApi({
    toolingQuery: async () => [], // package row absent
    query: async (t, u, soql) => {
      if (soql.includes('ExternalClientApplication')) {
        throw new Error('INSUFFICIENT_ACCESS');
      }
      return [];
    },
  });
  assert.equal(await checkPackageInstalled(TOKEN, INSTANCE, '04tfj000000NNITAA4', api), false);
});

test('package: ECA fallback applies in the full preflight run (attention → ok)', async () => {
  // The exact user scenario: the package row is missing (unmanaged install or
  // id mismatch) but the ECA exists — the preflight must now report the
  // connector installed instead of leaving the org stuck on "setup needed".
  const api = createStubSfApi({
    query: async (t, u, soql) => {
      if (soql.includes('ExternalClientApplication')) return [{ Id: '0J4eca' }]; // ECA present (standard REST)
      if (soql.includes('UserLicense')) return [{ TotalLicenses: 10, UsedLicenses: 2 }];
      if (soql.includes('PermissionSetGroup')) return [{ Id: '0PGg', MasterLabel: 'Agentforce' }];
      if (soql.includes('PermissionSet WHERE Label')) return [{ Id: '0psA', Name: 'AgentforceServiceAgentBase', Label: 'A' }];
      if (soql.includes('PermissionSet WHERE Name IN')) return [];
      if (soql.includes('Profile WHERE Name')) return []; // no Einstein Agent User profile → settings gated
      if (soql.includes('FROM User')) return [{ Id: '005u', Username: 'agent@x.com', IsActive: true }];
      if (soql.includes('FROM Organization')) return [{ Id: '00D', IsSandbox: false }];
      return [];
    },
    toolingQuery: async () => [], // no managed-package row (unmanaged install)
    post: async () => ({ id: '005new' }),
    userinfo: async () => ({ user_id: '005admin' }),
  });
  const res = await runPreFlightCheck(TOKEN, INSTANCE, { api, packageVersionId: '04tfj000000NNITAA4' });
  assert.equal(res.checks.package.installed, true, 'ECA fallback flips the package verdict');
  assert.equal(res.capability.org_change, 'ok', 'org_change no longer blocked by the false negative');
  assert.equal(res.state, 'attention', 'agents still gated by the disabled Agentforce settings');
});

// ── checkAgentforceSettings (Agentforce Agent + Einstein toggles) ─────────
// Both toggles are Metadata-API-only; the check uses the Einstein Agent User
// profile (standard REST) as the authoritative probe, with BotDefinition
// (Tooling) as a best-effort fallback only.
test('settings: enabled when the Einstein Agent User profile exists (primary probe)', async () => {
  const api = createStubSfApi({
    query: async () => [{ Id: '00eprofile' }],
  });
  const res = await checkAgentforceSettings(TOKEN, INSTANCE, api);
  assert.equal(res.enabled, true);
});

test('settings: not enabled when the profile query succeeds with no rows', async () => {
  const api = createStubSfApi({
    query: async () => [],
  });
  const res = await checkAgentforceSettings(TOKEN, INSTANCE, api);
  assert.equal(res.enabled, false);
  assert.match(res.reason, /not enabled/);
});

test('settings: profile present wins even when BotDefinition is unsupported (production regression)', async () => {
  // Regression test for the reported bug: the org HAS the Einstein Agent
  // User profile (Agentforce enabled) yet the BotDefinition Tooling probe
  // returns "not supported". The old code read that as disabled and stuck
  // the agents capability on attention. The profile is authoritative.
  const api = createStubSfApi({
    query: async () => [{ Id: '00eprofile' }],
    toolingQuery: async () => {
      throw new Error("sObject type 'BotDefinition' is not supported");
    },
  });
  const res = await checkAgentforceSettings(TOKEN, INSTANCE, api);
  assert.equal(res.enabled, true);
});

test('settings: BotDefinition unsupported degrades to unknown, not disabled, when profile is unprobeable', async () => {
  // Profile query itself failed (restricted surface) AND BotDefinition is
  // "not supported" — cannot distinguish "settings off" from "probe
  // unavailable" → unknown (null), never a false disabled.
  const api = createStubSfApi({
    query: async () => {
      throw new Error('INSUFFICIENT_ACCESS');
    },
    toolingQuery: async () => {
      throw new Error("sObject type 'BotDefinition' is not supported");
    },
  });
  const res = await checkAgentforceSettings(TOKEN, INSTANCE, api);
  assert.equal(res.enabled, null);
});

test('settings: BotDefinition fallback queryable when profile probe fails → enabled', async () => {
  const api = createStubSfApi({
    query: async () => {
      throw new Error('INSUFFICIENT_ACCESS');
    },
    toolingQuery: async () => [{ Id: '0B7x', Type: 'Agent' }],
  });
  const res = await checkAgentforceSettings(TOKEN, INSTANCE, api);
  assert.equal(res.enabled, true);
});

test('settings: recognizes the real SfApiError shape (error text in body)', async () => {
  // sfApi throws SfApiError with message "Tooling query failed (400)" and the
  // Salesforce errorCode/message inside err.body — the production shape. With
  // the profile probe unavailable, this degrades to unknown, not disabled.
  const api = createStubSfApi({
    query: async () => {
      throw new Error('INSUFFICIENT_ACCESS');
    },
    toolingQuery: async () => {
      const err = new Error('Tooling query failed (400)');
      err.body = [{ errorCode: 'INVALID_TYPE', message: "sObject type 'BotDefinition' is not supported" }];
      throw err;
    },
  });
  const res = await checkAgentforceSettings(TOKEN, INSTANCE, api);
  assert.equal(res.enabled, null);
});

test('settings: transient failure degrades to unknown, never throws', async () => {
  const api = createStubSfApi({
    query: async () => {
      throw new Error('INVALID_SESSION_ID');
    },
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
    // Only the license query returns rows — everything else (including the
    // ECA fallback, which queries ExternalClientApplication via api.query)
    // returns empty so the package verdict stays "missing".
    query: async (t, u, soql) => (soql.includes('UserLicense') ? [{ TotalLicenses: 10, UsedLicenses: 2 }] : []),
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
