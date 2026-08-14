import { sfApi } from './sfApi.js';

// D7: single unified ECA = Agentforge's package. Check by SubscriberPackageId
// (any installed version counts — EC-15). Default is Agentforge's known ECA
// version id; override via FORGE_ECA_PACKAGE_VERSION_ID if the unified ECA
// ships a new version.
const DEFAULT_PACKAGE_VERSION_ID =
  process.env.FORGE_ECA_PACKAGE_VERSION_ID || '04tfj000000NNITAA4';

// ── Shared state machine (plan §12.4) ─────────────────────────────────────
// checking → ok | attention(missing_package | license_unsupported |
//            provisioning | disconnected) | error

export function validateInstanceUrl(url) {
  if (!url || typeof url !== 'string') throw new Error('Missing instanceUrl');
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const allowed =
      host === 'login.salesforce.com' ||
      host === 'test.salesforce.com' ||
      host.endsWith('.salesforce.com') ||
      host.endsWith('.force.com') ||
      host.endsWith('.cloudforce.com') ||
      host.endsWith('.my.salesforce.com');
    if (!allowed) throw new Error('Invalid instanceUrl hostname');
    if (parsed.protocol !== 'https:') throw new Error('instanceUrl must be https');
  } catch (err) {
    throw new Error('Invalid or unsafe instanceUrl: ' + err.message);
  }
}

/** Einstein Agent license availability (plan §12.4.2, EC-16). */
export async function checkLicenseAvailability(token, instanceUrl, api = sfApi) {
  try {
    const records = await api.query(
      token,
      instanceUrl,
      "SELECT TotalLicenses, UsedLicenses FROM UserLicense WHERE Name = 'Einstein Agent'"
    );
    if (records.length === 0) {
      return { supported: false, reason: 'Einstein Agent license not found in this org.' };
    }
    const license = records[0];
    const available = Number(license.TotalLicenses || 0) - Number(license.UsedLicenses || 0);
    if (available <= 0) {
      return { supported: false, reason: 'No available Einstein Agent licenses (all are used).' };
    }
    return { supported: true, available };
  } catch (err) {
    console.error('[diagnostics] Error checking license:', err.message);
    return { supported: false, reason: 'Failed to verify Einstein Agent license availability.' };
  }
}

export async function getEinsteinAgentProfileId(token, instanceUrl, api = sfApi) {
  const records = await api.query(
    token,
    instanceUrl,
    "SELECT Id FROM Profile WHERE Name = 'Einstein Agent User' LIMIT 1"
  );
  return records.length > 0 ? records[0].Id : null;
}

/**
 * Discover Agentforce permission sets + groups (EC-18): dynamic LIKE discovery
 * with an explicit fallback list of the three mandatory DeveloperNames.
 */
export async function discoverPermissionSets(token, instanceUrl, api = sfApi) {
  const permSetIds = new Set();

  try {
    const permSets = await api.query(
      token,
      instanceUrl,
      "SELECT Id, Name, Label FROM PermissionSet WHERE Label LIKE '%Agentforce%' OR Label LIKE '%Einstein%'"
    );
    for (const ps of permSets) {
      if (
        ps.Name.includes('AgentforceServiceAgentBase') ||
        ps.Name.includes('AgentforceServiceAgentUser') ||
        ps.Name.includes('EinsteinGPTPromptTemplateUser') ||
        ps.Name === 'Agentforge_Generated_Actions'
      ) {
        permSetIds.add(ps.Id);
      }
    }
  } catch (err) {
    console.error('[diagnostics] Error discovering permission sets:', err.message);
  }

  try {
    const groups = await api.query(
      token,
      instanceUrl,
      "SELECT Id, DeveloperName, MasterLabel FROM PermissionSetGroup WHERE MasterLabel LIKE '%Agentforce%'"
    );
    for (const psg of groups) permSetIds.add(psg.Id);
  } catch (err) {
    console.error('[diagnostics] Error discovering permission set groups:', err.message);
  }

  // Explicit fallback by exact DeveloperName (survives label renames).
  try {
    const mandatory = await api.query(
      token,
      instanceUrl,
      "SELECT Id, Name FROM PermissionSet WHERE Name IN ('AgentforceServiceAgentBase', 'AgentforceServiceAgentUser', 'EinsteinGPTPromptTemplateUser')"
    );
    for (const ps of mandatory) permSetIds.add(ps.Id);
  } catch (err) {
    console.error('[diagnostics] Error querying mandatory permission sets:', err.message);
  }

  return Array.from(permSetIds);
}

/** Find-or-create the Einstein Agent user, reactivating if deactivated (EC-17). */
export async function findOrCreateAgentUser(token, instanceUrl, api = sfApi) {
  try {
    const profileId = await getEinsteinAgentProfileId(token, instanceUrl, api);
    if (!profileId) throw new Error('Einstein Agent User profile not found in this org.');

    const existingUsers = await api.query(
      token,
      instanceUrl,
      `SELECT Id, Username, IsActive FROM User WHERE ProfileId = '${profileId}' LIMIT 1`
    );

    if (existingUsers.length > 0) {
      const user = existingUsers[0];
      if (!user.IsActive) {
        await api.patch(token, instanceUrl, `User/${user.Id}`, { IsActive: true });
      }
      return { userId: user.Id, username: user.Username };
    }

    const orgInfo = await api.query(token, instanceUrl, 'SELECT Id, Name FROM Organization LIMIT 1');
    const orgId = orgInfo[0].Id;
    const uniqueUsername = `agentforge.user.${Date.now()}@${orgId}.com`;

    const newUser = {
      FirstName: 'Agentforge',
      LastName: 'Service Agent',
      Alias: 'agentf',
      Email: 'agentforge@example.com',
      Username: uniqueUsername,
      ProfileId: profileId,
      TimeZoneSidKey: 'America/Los_Angeles',
      LocaleSidKey: 'en_US',
      EmailEncodingKey: 'UTF-8',
      LanguageLocaleKey: 'en_US',
      IsActive: true,
    };

    const createRes = await api.post(token, instanceUrl, 'User/', newUser);
    return { userId: createRes.id, username: uniqueUsername };
  } catch (err) {
    console.error('[diagnostics] Error provisioning agent user:', err.message);
    if (err.body) console.error(err.body);
    throw new Error('Failed to provision Einstein Agent User. Please check org licenses.');
  }
}

/**
 * Assign permission sets (or groups, prefix 0PG) to a user, tolerating
 * DUPLICATE_VALUE (already-assigned) errors (plan §12.4.4).
 */
export async function assignPermissionSets(token, instanceUrl, userId, permSetIds, api = sfApi) {
  let assignedCount = 0;
  for (const psId of permSetIds) {
    try {
      const isGroup = psId.startsWith('0PG');
      const assignObj = isGroup ? { AssigneeId: userId, PermissionSetGroupId: psId }
                                : { AssigneeId: userId, PermissionSetId: psId };
      await api.post(token, instanceUrl, 'PermissionSetAssignment/', assignObj);
      assignedCount++;
    } catch (err) {
      const dup = err.body?.[0]?.errorCode === 'DUPLICATE_VALUE';
      if (!dup) {
        console.error(
          `[diagnostics] Failed to assign permission set ${psId} to user ${userId}:`,
          err.body || err.message
        );
      }
    }
  }
  return assignedCount;
}

export async function getCurrentUserId(token, instanceUrl, api = sfApi) {
  const info = await api.userinfo(token, instanceUrl);
  return info.user_id;
}

/**
 * Check the unified ECA package is installed by SubscriberPackageId — ANY
 * installed version counts (EC-14/EC-15). Resolves a version id (04t) to its
 * SubscriberPackageId (033) first (Agentforge logic), with a direct fallback.
 */
export async function checkPackageInstalled(token, instanceUrl, packageVersionId, api = sfApi) {
  try {
    // 1. Resolve 04t version -> 033 SubscriberPackageId.
    let subscriberPackageId = packageVersionId;
    if (packageVersionId.startsWith('04t')) {
      const versionRecords = await api.toolingQuery(
        token,
        instanceUrl,
        `SELECT SubscriberPackageId FROM SubscriberPackageVersion WHERE Id = '${packageVersionId}'`
      );
      if (versionRecords.length > 0) {
        subscriberPackageId = versionRecords[0].SubscriberPackageId;
      } else {
        // Version id unknown to the tooling surface — try a direct version
        // match. A HIT returns immediately; a miss falls through to the
        // package + ECA checks below (the ECA fallback must apply on this
        // path too — an unresolved 04t is exactly when ids may have drifted).
        const direct = await api.toolingQuery(
          token,
          instanceUrl,
          `SELECT Id FROM InstalledSubscriberPackage WHERE SubscriberPackageVersionId = '${packageVersionId}'`
        );
        if (Array.isArray(direct) && direct.length > 0) return true;
      }
    }

    // 2. Any installed version of this package?
    const installed = await api.toolingQuery(
      token,
      instanceUrl,
      `SELECT Id FROM InstalledSubscriberPackage WHERE SubscriberPackageId = '${subscriberPackageId}'`
    );
    if (Array.isArray(installed) && installed.length > 0) return true;

    // 3. ECA fallback — closes the false "missing" verdicts when the
    //    connector is installed as an UNMANAGED package (never listed in
    //    InstalledSubscriberPackage) or the pinned 033/04t ids don't match the
    //    version the admin installed. The External Client Application is the
    //    signal that actually matters — it is the OAuth client Forge
    //    authenticates through, and it exists in exactly the orgs where the
    //    connector was set up. Best-effort: a query failure (unsupported
    //    surface) keeps the package verdict instead of flipping it.
    //
    //    IMPORTANT: ExternalClientApplication is a STANDARD REST object, NOT
    //    a Tooling object — a Tooling query returns 400 INVALID_TYPE "sObject
    //    type 'ExternalClientApplication' is not supported" in every real
    //    org, so the fallback must use the standard query surface (api.query)
    //    or it can never match.
    try {
      const eca = await api.query(
        token,
        instanceUrl,
        "SELECT Id FROM ExternalClientApplication WHERE DeveloperName = 'OrgForge_ECA' LIMIT 1"
      );
      if (Array.isArray(eca) && eca.length > 0) return true;
    } catch (ecaErr) {
      console.warn('[diagnostics] ECA fallback check unavailable (non-fatal):', ecaErr.message);
    }

    return false;
  } catch (err) {
    console.error('[diagnostics] Error checking package installation:', err.message);
    return false;
  }
}

/**
 * Best-effort Agentforce + Einstein settings check.
 *
 * Both Setup toggles the user must flip to BUILD agents — "Agentforce Agent"
 * (EinsteinCopilotSettings.enableEinsteinGptCopilot) and "Einstein"
 * (EinsteinGptSettings.enableEinsteinGptPlatform) — are Metadata-API-only
 * `.settings` types and CANNOT be queried via standard SOQL or the Tooling
 * API query endpoint. This uses the closest cheap runtime proxy.
 *
 * PRIMARY signal (authoritative): the `Einstein Agent User` profile. It is a
 * standard REST object, queryable in every org, and per provisioning
 * (getEinsteinAgentProfileId) it only exists once the Agentforce/Einstein
 * settings are on — so its presence is the definitive "settings enabled"
 * verdict.
 *
 * FALLBACK (only if the Profile query itself fails, e.g. restricted access):
 * the BotDefinition Tooling object Agentforce populates when the agent
 * platform is enabled. NOTE: "sObject type not supported" on BotDefinition
 * is NOT treated as "disabled" — some fully-enabled orgs don't expose
 * BotDefinition on the Tooling surface at all (observed in production), so
 * that error alone cannot distinguish "settings off" from "probe
 * unavailable". A genuine absence is only confirmed by the Profile query
 * succeeding with zero rows; anything else degrades to unknown (null) and
 * never fails the preflight — provisioning remains the stronger runtime
 * signal.
 *
 * @param {string} token - Salesforce access token
 * @param {string} instanceUrl - https Salesforce instance URL
 * @param {object} [api] - injectable sfApi (tests)
 * @returns {Promise<{enabled: boolean|null, reason: string}>}
 */
export async function checkAgentforceSettings(token, instanceUrl, api = sfApi) {
  // Primary probe: the Einstein Agent User profile only exists once the
  // Agentforce/Einstein settings are on (getEinsteinAgentProfileId depends on
  // exactly this). Standard REST query — works in every org, unlike the
  // BotDefinition Tooling proxy, which some fully-enabled orgs don't expose.
  try {
    const profiles = await api.query(
      token,
      instanceUrl,
      "SELECT Id FROM Profile WHERE Name = 'Einstein Agent User' LIMIT 1"
    );
    if (profiles.length > 0) return { enabled: true, reason: '' };
    return {
      enabled: false,
      reason: 'Agentforce / Einstein settings are not enabled in this org.',
    };
  } catch (err) {
    // Profile query failed (e.g. insufficient access) — fall back to the
    // BotDefinition Tooling proxy as a best-effort second signal. Unlike the
    // original implementation, "sObject type not supported" here is treated
    // as UNKNOWN (null), not disabled: we observed production orgs where
    // Agentforce is enabled yet BotDefinition is not exposed on the Tooling
    // surface, so that error cannot be trusted as a "settings off" verdict.
    console.warn('[diagnostics] Profile probe failed, falling back to BotDefinition:', err.message);
  }

  try {
    await api.toolingQuery(
      token,
      instanceUrl,
      "SELECT Id FROM BotDefinition WHERE Type = 'Agent' LIMIT 1"
    );
    return { enabled: true, reason: '' };
  } catch (err) {
    // SfApiError's message is only "Tooling query failed (400)" — the real
    // Salesforce error text lives in err.body. Match both so a genuinely
    // restricted surface is reported as unknown rather than a false disabled.
    const bodyText = JSON.stringify(err?.body ?? '');
    const message = String(err?.message || err || '') + ' ' + bodyText;
    const unsupported =
      /not supported|INVALID_TYPE|INVALID_OBJECT|No such.*object|Unknown.*sObject/i.test(message);
    if (unsupported) {
      return {
        enabled: null,
        reason: 'Could not verify Agentforce settings in this org (probe not exposed).',
      };
    }
    return { enabled: null, reason: 'Could not verify Agentforce settings in this org.' };
  }
}

/** Detect the real org type (Organization.IsSandbox) and correct a wrong pick (EC-13). */
export async function detectOrgType(token, instanceUrl, api = sfApi) {
  try {
    const records = await api.query(token, instanceUrl, 'SELECT IsSandbox FROM Organization LIMIT 1');
    const isSandbox = records.length > 0 && records[0].IsSandbox === true;
    return { detected: isSandbox ? 'sandbox' : 'production' };
  } catch (err) {
    console.error('[diagnostics] Org-type detection failed (non-fatal):', err.message);
    return { detected: null };
  }
}

/**
 * Run the full Pre-Flight Check + provisioning (port of Agentforge's
 * orgConfigService.runPreFlightCheck, plan §12.4).
 *
 * Result carries the shared state machine plus the capability split (EC-16):
 *   - capability.agents:     needs license + package + Agentforce/Einstein
 *                            settings + provisioning
 *   - capability.org_change: needs package + valid token only
 *
 * @param {string} token - Salesforce access token
 * @param {string} instanceUrl - https Salesforce instance URL
 * @param {object} [opts]
 * @param {object} [opts.api] - injectable sfApi (tests)
 * @param {string} [opts.packageVersionId] - ECA version id (D7 default)
 * @returns {Promise<object>} diagnostics result
 */
export async function runPreFlightCheck(token, instanceUrl, opts = {}) {
  const api = opts.api || sfApi;
  const packageVersionId = opts.packageVersionId || DEFAULT_PACKAGE_VERSION_ID;

  validateInstanceUrl(instanceUrl);

  const result = {
    state: 'error',
    capability: { agents: 'attention', org_change: 'attention' },
    checks: {
      instanceUrl: { ok: true },
      license: { supported: false, reason: '' },
      package: { installed: false, reason: '' },
      settings: { agentforceEnabled: null, reason: '' },
      provisioning: { ok: false, agentUsername: null, permissionsAssigned: false, reason: '' },
      orgType: { detected: null, corrected: false },
    },
    agentUsername: null,
    checkedAt: new Date().toISOString(),
  };

  try {
    // Step 1: org-type detection (non-fatal, EC-13)
    const orgType = await detectOrgType(token, instanceUrl, api);
    result.checks.orgType = { ...result.checks.orgType, detected: orgType.detected };

    // Step 2: Einstein Agent license availability (EC-16)
    const licenseCheck = await checkLicenseAvailability(token, instanceUrl, api);
    result.checks.license.supported = licenseCheck.supported;
    result.checks.license.reason = licenseCheck.reason;

    // Step 3: package check by SubscriberPackageId (EC-14/EC-15)
    const isInstalled = await checkPackageInstalled(token, instanceUrl, packageVersionId, api);
    result.checks.package.installed = isInstalled;

    // Capability split (EC-16): org_change only needs the package.
    result.capability.org_change = isInstalled ? 'ok' : 'attention';

    // License unsupported → agents blocked, org_change unaffected. Provisioning
    // is skipped (it requires an available Agentforce license seat anyway).
    if (!licenseCheck.supported) {
      result.state = 'attention';
      result.capability.agents = 'attention';
      return result;
    }

    if (!isInstalled) {
      result.checks.package.reason = 'Connector package not installed.';
      result.state = 'attention';
      result.capability.agents = 'attention';
      return result;
    }

    // Step 4: Agentforce + Einstein settings. Both toggles are
    // Metadata-API-only (not SOQL-queryable) — the BotDefinition proxy in
    // checkAgentforceSettings is best-effort: `enabled: false` blocks agents,
    // `null` (couldn't verify) does not, so provisioning remains the stronger
    // runtime signal. org_change is never affected by these settings.
    const settingsCheck = await checkAgentforceSettings(token, instanceUrl, api);
    result.checks.settings.agentforceEnabled = settingsCheck.enabled;
    result.checks.settings.reason = settingsCheck.reason;

    if (settingsCheck.enabled === false) {
      result.checks.settings.reason =
        'Enable Agentforce Agent and Einstein in Setup → Agentforce, then re-run diagnostics.';
      result.state = 'attention';
      result.capability.agents = 'attention';
      return result;
    }

    // Step 5: discover permission sets + provision the agent user
    const permSetIds = await discoverPermissionSets(token, instanceUrl, api);
    const agentUser = await findOrCreateAgentUser(token, instanceUrl, api);
    result.agentUsername = agentUser.username;
    result.checks.provisioning.agentUsername = agentUser.username;

    if (permSetIds.length > 0) {
      await assignPermissionSets(token, instanceUrl, agentUser.userId, permSetIds, api);
      const adminId = await getCurrentUserId(token, instanceUrl, api);
      await assignPermissionSets(token, instanceUrl, adminId, permSetIds, api);
      result.checks.provisioning.permissionsAssigned = true;
    }
    result.checks.provisioning.ok = true;

    // All three passed → everything green.
    result.capability.agents = 'ok';
    result.state = 'ok';

    return result;
  } catch (err) {
    console.error('[diagnostics] Pre-Flight Check failed:', err);
    result.checks.provisioning.reason = err.message;
    result.state = 'error';
    return result;
  }
}
