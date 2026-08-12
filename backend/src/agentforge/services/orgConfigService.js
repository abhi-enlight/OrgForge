'use strict';

import axios from 'axios'
const SF_API_VERSION = 'v65.0';

/**
 * Validates the instance URL.
 */
function validateInstanceUrl(url) {
  if (!url || typeof url !== 'string') throw new Error('Missing instanceUrl');
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.salesforce.com') && !parsed.hostname.endsWith('.force.com')) {
      throw new Error('Invalid instanceUrl hostname');
    }
    if (parsed.protocol !== 'https:') throw new Error('instanceUrl must be https');
  } catch (err) {
    throw new Error('Invalid or unsafe instanceUrl: ' + err.message);
  }
}

/**
 * Helper to execute SOQL queries
 */
async function query(token, instanceUrl, soql) {
  const url = `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data.records;
}

/**
 * Check if the org has available Einstein Agent licenses.
 */
async function checkLicenseAvailability(token, instanceUrl) {
  try {
    const records = await query(token, instanceUrl, "SELECT TotalLicenses, UsedLicenses FROM UserLicense WHERE Name = 'Einstein Agent'");
    if (records.length === 0) {
      return { supported: false, reason: 'Einstein Agent license not found in this org.' };
    }
    
    const license = records[0];
    const available = license.TotalLicenses - license.UsedLicenses;
    
    if (available <= 0) {
      return { supported: false, reason: 'No available Einstein Agent licenses (all are used).' };
    }
    
    return { supported: true, available };
  } catch (error) {
    console.error('[orgConfigService] Error checking license:', error.message);
    // If we can't query licenses (maybe no permissions), we degrade gracefully
    return { supported: false, reason: 'Failed to verify Einstein Agent license availability.' };
  }
}

/**
 * Find the Einstein Agent User profile
 */
async function getEinsteinAgentProfileId(token, instanceUrl) {
  const records = await query(token, instanceUrl, "SELECT Id FROM Profile WHERE Name = 'Einstein Agent User' LIMIT 1");
  return records.length > 0 ? records[0].Id : null;
}

/**
 * Discover Agentforce related permission sets and groups
 */
async function discoverPermissionSets(token, instanceUrl) {
  const permSetIds = new Set();
  
  try {
    // 1. Dynamic discovery: Find Permission Sets by label
    const permSets = await query(token, instanceUrl, "SELECT Id, Name, Label FROM PermissionSet WHERE Label LIKE '%Agentforce%' OR Label LIKE '%Einstein%'");
    for (const ps of permSets) {
      // Focus on known standard ones or anything that looks like Agentforce base permissions
      if (ps.Name.includes('AgentforceServiceAgentBase') || 
          ps.Name.includes('AgentforceServiceAgentUser') || 
          ps.Name.includes('EinsteinGPTPromptTemplateUser') ||
          ps.Name === 'Agentforge_Generated_Actions') {
        permSetIds.add(ps.Id);
      }
    }
    
    // 2. Find Permission Set Groups (prefix is 0PG, not 0sg)
    const permSetGroups = await query(token, instanceUrl, "SELECT Id, DeveloperName, MasterLabel FROM PermissionSetGroup WHERE MasterLabel LIKE '%Agentforce%'");
    for (const psg of permSetGroups) {
      permSetIds.add(psg.Id);
    }
    
  } catch (error) {
    console.error('[orgConfigService] Error discovering permission sets:', error.message);
  }

  // 3. Explicit fallback: always query the three mandatory Agentforce permission sets by exact DeveloperName.
  //    The dynamic LIKE query above may miss these if Salesforce renames their labels in future releases.
  //    Source: `sf org create agent-user` CLI reference documentation.
  try {
    const mandatorySets = await query(token, instanceUrl,
      "SELECT Id, Name FROM PermissionSet WHERE Name IN ('AgentforceServiceAgentBase', 'AgentforceServiceAgentUser', 'EinsteinGPTPromptTemplateUser')");
    for (const ps of mandatorySets) {
      permSetIds.add(ps.Id);
    }
  } catch (error) {
    console.error('[orgConfigService] Error querying mandatory permission sets:', error.message);
  }
  
  return Array.from(permSetIds);
}

/**
 * Find or create the Einstein Agent User
 */
async function findOrCreateAgentUser(token, instanceUrl) {
  try {
    const profileId = await getEinsteinAgentProfileId(token, instanceUrl);
    if (!profileId) {
      throw new Error('Einstein Agent User profile not found in this org.');
    }

    // 1. See if one already exists
    const existingUsers = await query(token, instanceUrl, `SELECT Id, Username, IsActive FROM User WHERE ProfileId = '${profileId}' LIMIT 1`);
    
    if (existingUsers.length > 0) {
      const user = existingUsers[0];
      if (!user.IsActive) {
        // Activate the user
        await axios.patch(`${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/User/${user.Id}`, 
          { IsActive: true },
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );
      }
      return { userId: user.Id, username: user.Username };
    }
    
    // 2. We need to create a new one. Get org info to construct a unique username
    const orgInfo = await query(token, instanceUrl, "SELECT Id, Name FROM Organization LIMIT 1");
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
      IsActive: true
    };
    
    const createRes = await axios.post(`${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/User/`,
      newUser,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    
    return { userId: createRes.data.id, username: uniqueUsername };
  } catch (error) {
    console.error('[orgConfigService] Error provisioning agent user:', error.message);
    if (error.response && error.response.data) {
      console.error(error.response.data);
    }
    throw new Error('Failed to provision Einstein Agent User. Please check org licenses.');
  }
}

/**
 * Assign permission sets to a user (ignoring duplicates)
 */
async function assignPermissionSets(token, instanceUrl, userId, permSetIds) {
  let assignedCount = 0;
  for (const psId of permSetIds) {
    try {
      // PermissionSetGroup key prefix is '0PG' (not '0sg')
      // Source: Salesforce key prefix registry — PermissionSetGroup = 0PG
      const isGroup = psId.startsWith('0PG');
      const assignObj = {
        AssigneeId: userId
      };
      
      if (isGroup) {
        assignObj.PermissionSetGroupId = psId;
      } else {
        assignObj.PermissionSetId = psId;
      }
      
      await axios.post(`${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/PermissionSetAssignment/`,
        assignObj,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      assignedCount++;
    } catch (error) {
      // 200/201 is success. 400 with DUPLICATE_VALUE is also fine (already assigned).
      if (error.response && error.response.data && error.response.data[0] && error.response.data[0].errorCode === 'DUPLICATE_VALUE') {
        // already assigned, ignore
      } else {
        console.error(`[orgConfigService] Failed to assign permission set ${psId} to user ${userId}:`, error.response ? error.response.data : error.message);
      }
    }
  }
  return assignedCount;
}

/**
 * Get current admin user ID
 */
async function getCurrentUserId(token, instanceUrl) {
  const userInfo = await axios.get(`${instanceUrl}/services/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return userInfo.data.user_id;
}

/**
 * Check if the ECA package is installed using Tooling API
 */
async function checkPackageInstalled(token, instanceUrl, packageVersionId) {
  try {
    // 1. Get the SubscriberPackageId (033) for the given version (04t)
    const versionQuery = `SELECT SubscriberPackageId FROM SubscriberPackageVersion WHERE Id = '${packageVersionId}'`;
    const versionUrl = `${instanceUrl}/services/data/${SF_API_VERSION}/tooling/query?q=${encodeURIComponent(versionQuery)}`;
    
    const versionRes = await axios.get(versionUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!versionRes.data.records || versionRes.data.records.length === 0) {
      // If we can't find the version globally, fallback to checking version id directly
      const installQuery = `SELECT Id FROM InstalledSubscriberPackage WHERE SubscriberPackageVersionId = '${packageVersionId}'`;
      const installUrl = `${instanceUrl}/services/data/${SF_API_VERSION}/tooling/query?q=${encodeURIComponent(installQuery)}`;
      const installRes = await axios.get(installUrl, { headers: { Authorization: `Bearer ${token}` } });
      return installRes.data.records && installRes.data.records.length > 0;
    }
    
    const subscriberPackageId = versionRes.data.records[0].SubscriberPackageId;
    
    // 2. Check if ANY version of this package is installed
    const installQuery = `SELECT Id FROM InstalledSubscriberPackage WHERE SubscriberPackageId = '${subscriberPackageId}'`;
    const installUrl = `${instanceUrl}/services/data/${SF_API_VERSION}/tooling/query?q=${encodeURIComponent(installQuery)}`;
    const installRes = await axios.get(installUrl, { headers: { Authorization: `Bearer ${token}` } });
    
    return installRes.data.records && installRes.data.records.length > 0;
  } catch (error) {
    console.error('[orgConfigService] Error checking package installation:', error.message);
    return false;
  }
}

/**
 * Run the full Pre-Flight Check and Provisioning flow
 */
async function runPreFlightCheck(token, instanceUrl) {
  validateInstanceUrl(instanceUrl);
  
  const result = {
    packageInstalled: false,
    licenseSupported: false,
    licenseReason: '',
    agentUsername: null,
    permissionsAssigned: false,
    instanceUrl: instanceUrl
  };
  
  try {

    // Step 1: Check Einstein Agent license availability
    const licenseCheck = await checkLicenseAvailability(token, instanceUrl);
    result.licenseSupported = licenseCheck.supported;
    result.licenseReason = licenseCheck.reason;
    
    if (!licenseCheck.supported) {
      return result;
    }
    
    // Step 2: Check Package Installation (04tfj000000NNITAA4 is our known ECA package version ID)
    const isInstalled = await checkPackageInstalled(token, instanceUrl, '04tfj000000NNITAA4');
    result.packageInstalled = isInstalled;
    
    if (!isInstalled) {
      return result; // Stop early — remaining steps require the package
    }
    
    // Step 3: Discover Agentforce permission sets and groups
    const permSetIds = await discoverPermissionSets(token, instanceUrl);
    
    // Step 4: Find or create the Einstein Agent User
    const agentUser = await findOrCreateAgentUser(token, instanceUrl);
    result.agentUsername = agentUser.username;
    
    // Step 5: Assign permission sets to Agent User AND the current admin user
    if (permSetIds.length > 0) {
      await assignPermissionSets(token, instanceUrl, agentUser.userId, permSetIds);
      
      // Also assign to the Admin (current user) so they can test/preview agents
      const adminId = await getCurrentUserId(token, instanceUrl);
      await assignPermissionSets(token, instanceUrl, adminId, permSetIds);
      
      result.permissionsAssigned = true;
    }
    
    return result;
    
  } catch (error) {
    console.error('[orgConfigService] Pre-Flight Check failed:', error);
    result.error = error.message;
    return result;
  }
}

export { runPreFlightCheck,
  findOrCreateAgentUser };
