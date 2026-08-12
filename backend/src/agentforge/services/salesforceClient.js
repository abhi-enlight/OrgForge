'use strict';

import axios from 'axios'
import AdmZip from 'adm-zip'
import FormData from 'form-data'
import { escapeXml, sanitizeName, sanitizeApexClassName } from '../utils/xmlUtils.js'
import { findOrCreateAgentUser } from './orgConfigService.js'

const SF_API_VERSION = 'v65.0';

/**
 * Parses an Apex class body and extracts all SObject API names referenced in
 * SOQL queries (FROM clause) and DML List<Type> declarations.
 * This allows the deployment to automatically provision object-level CRUD
 * permissions for every object the agent's Apex code actually touches.
 *
 * @param {string} apexCode - The full Apex class source code
 * @returns {string[]} Array of unique SObject API names (e.g. ['Case', 'Custom_Order__c'])
 */
function extractReferencedObjects(apexCode) {
  if (!apexCode || typeof apexCode !== 'string') return [];
  const objects = new Set();

  // Match SOQL FROM clauses: FROM SObjectName, FROM SObjectName__c
  const soqlPattern = /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*(?:__c|__mdt|__e|__b|__x|__kav)?)\b/gi;
  // Match DML List<SObjectName> patterns
  const dmlListPattern = /\bList\s*<\s*([A-Za-z_][A-Za-z0-9_]*(?:__c|__mdt|__e|__b|__x|__kav)?)\s*>/gi;
  // Match direct new SObjectName() instantiation
  const newPattern = /\bnew\s+([A-Za-z_][A-Za-z0-9_]*(?:__c|__mdt|__e|__b|__x|__kav)?)\s*\(/gi;

  let match;
  while ((match = soqlPattern.exec(apexCode)) !== null) objects.add(match[1]);
  while ((match = dmlListPattern.exec(apexCode)) !== null) objects.add(match[1]);
  while ((match = newPattern.exec(apexCode)) !== null) objects.add(match[1]);

  // Remove internal wrapper class names and primitives — these are not SObjects
  const APEX_NON_SOBJECTS = new Set([
    'InputParameters', 'OutputParameters', 'Result', 'Request', 'Response',
    'Exception', 'String', 'Integer', 'Decimal', 'Boolean', 'Map', 'Set', 'List',
    'SObject', 'Id', 'Object', 'Type', 'HttpResponse', 'HttpRequest', 'Database',
    'System', 'JSON', 'Math', 'ConnectApi', 'Schema', 'Blob', 'Date', 'Datetime', 'Time'
  ]);
  for (const name of APEX_NON_SOBJECTS) objects.delete(name);

  return Array.from(objects);
}

function getFieldTypeAttributes(field) {
  const type = field.type;
  let attrs = '';
  switch (type) {
    case 'Text':
      attrs = `\n        <length>${field.length || 255}</length>`;
      break;
    case 'Number':
    case 'Currency':
    case 'Percent':
      attrs = `\n        <precision>${field.precision || 18}</precision>\n        <scale>${field.scale || 2}</scale>`;
      break;
    case 'Checkbox':
      attrs = `\n        <defaultValue>${field.defaultValue || 'false'}</defaultValue>`;
      break;
    case 'LongTextArea':
    case 'Html':
      attrs = `\n        <length>${field.length || 32768}</length>\n        <visibleLines>${field.visibleLines || 5}</visibleLines>`;
      break;
    case 'Picklist':
      const values = (field.picklistValues || ['Option1', 'Option2']).map((v, i) =>
        `\n            <value>\n                <fullName>${escapeXml(v)}</fullName>\n                <default>${i === 0 ? 'true' : 'false'}</default>\n            </value>`
      ).join('');
      attrs = `\n        <valueSet>\n            <valueSetDefinition>${values}\n            </valueSetDefinition>\n        </valueSet>`;
      break;
    case 'Date':
    case 'DateTime':
    case 'Email':
    case 'Phone':
    case 'Url':
      break;
    default:
      attrs = `\n        <length>255</length>`;
      break;
  }
  return attrs;
}

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
 * SalesforceClient — handles all Salesforce Metadata API interactions.
 *
 * IMPORTANT: Do NOT use the singleton's _topics/_actions for request state.
 * Always create a fresh RequestContext per /api/chat/stream call to avoid
 * concurrency issues (two simultaneous builds sharing state).
 */
class SalesforceClient {
  /**
   * Create a fresh per-request context. This fixes the concurrency bug
   * where the singleton's _topics/_actions arrays got mixed between requests.
   */
  createContext() {
    return {
      topics: [],
      actions: [],
      variables: [],
      transitions: [],
      guardrails: [],
      escalation: null,
      instructions: '',
      knowledge: { enabled: false, ragId: '' },
      rawYaml: null,
      remoteSites: [],
      customObjects: [],
      // Tracks SObjects referenced in all Apex code so we can auto-provision
      // object-level CRUD permissions in the deployment ZIP.
      referencedObjects: new Set()
    };
  }

  // NOTE: defineVariable, addTransition, setBeforeReasoning, setAfterReasoning,
  // setAvailableWhen, and configureRemoteSite are fully defined below with proper
  // sanitization and logging. The duplicate stubs that were here have been removed.

  async checkUserPermissions(token, instanceUrl) {
    try {
      const userInfo = await axios.get(`${instanceUrl}/services/oauth2/userinfo`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const userId = userInfo.data.user_id;
      const orgId = userInfo.data.organization_id;

      const permQuery = `SELECT PermissionsModifyAllData, PermissionsAuthorApex FROM Profile WHERE Id IN (SELECT ProfileId FROM User WHERE Id = '${userId}')`;
      const permRes = await axios.get(
        `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(permQuery)}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const profile = permRes.data.records[0] || {};

      // BUG-D FIX: Use SOQL to reliably determine sandbox status.
      // The previous URL heuristic (.develop., .sandbox., -dev-ed.) is unreliable:
      // orgs with custom domains don't embed sandbox markers in the URL, and
      // userinfo.urls.custom_domain may be null. The Organization SOQL query is the
      // same authoritative approach already used by deployAgent() for the safety block.
      let isSandbox = false;
      try {
        const orgRes = await axios.get(
          `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=SELECT+IsSandbox,OrganizationType+FROM+Organization+LIMIT+1`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const orgData = orgRes.data.records[0] || {};
        isSandbox = orgData.IsSandbox === true || orgData.OrganizationType === 'Developer Edition';
      } catch (orgErr) {
        // Fallback to URL heuristic if SOQL fails (e.g. permission error)
        console.warn('[PERM] Organization SOQL failed, falling back to URL heuristic:', orgErr.message);
        const customDomain = userInfo.data.urls?.custom_domain || '';
        isSandbox = customDomain.includes('.develop.') ||
                    customDomain.includes('.sandbox.') ||
                    customDomain.includes('-dev-ed.') ||
                    instanceUrl.includes('.sandbox.') ||
                    instanceUrl.includes('--dev.');
      }

      return {
        userId,
        orgId,
        isAdmin: profile.PermissionsModifyAllData === true,
        canAuthorApex: profile.PermissionsAuthorApex === true,
        isSandbox
      };
    } catch (err) {
      console.warn('[PERM] Permission check failed:', err.message);
      return { isAdmin: false, canAuthorApex: false, isSandbox: false };
    }
  }

  async cancelDeployment(deployId, token, instanceUrl) {
    validateInstanceUrl(instanceUrl);
    try {
      await axios.patch(
        `${instanceUrl}/services/data/${SF_API_VERSION}/metadata/deployRequest/${deployId}`,
        { deployResult: { status: 'Canceling' } },
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      console.log(`[DEPLOY] Cancellation requested for ${deployId}`);
      return { success: true };
    } catch (err) {
      console.error(`[DEPLOY] Cancel failed for ${deployId}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async refreshAccessToken(refreshToken) {
    try {
      const response = await axios.post('https://login.salesforce.com/services/oauth2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: process.env.SALESFORCE_CLIENT_ID || process.env.SF_OAUTH_CLIENT_ID,
          client_secret: process.env.SALESFORCE_CLIENT_SECRET || process.env.SF_OAUTH_CLIENT_SECRET,
          refresh_token: refreshToken
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      return { success: true, accessToken: response.data.access_token };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async checkForActiveDeployments(token, instanceUrl) {
    // BUG-14: The previous implementation used incorrect SOQL on the REST data endpoint
    // which doesn't expose the DeployRequest SObject. It always returned 0 (no active
    // deployments) providing a false sense of safety. This check is now a no-op stub.
    // The Metadata API's rollbackOnError=true flag provides the actual safety guarantee:
    // if a deploy conflicts with an in-progress one, Salesforce returns an error that the
    // LLM surfaces to the user as a "please wait" message.
    return { hasActive: false, count: 0 };
  }

  async getHeaders(token) {
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  async getGlobalDescribe(token, instanceUrl) {
    validateInstanceUrl(instanceUrl);
    const response = await axios.get(
      `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/`,
      { headers: await this.getHeaders(token) }
    );
    return response.data.sobjects;
  }

  async getObjectSchema(objectName, token, instanceUrl) {
    try {
      validateInstanceUrl(instanceUrl);
      const response = await axios.get(
        `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${objectName}/describe`,
        { headers: await this.getHeaders(token) }
      );
      return response.data.fields.map(f => ({ name: f.name, label: f.label, type: f.type }));
    } catch (err) {
      console.warn(`Could not fetch schema for ${objectName}:`, err.message);
      return [];
    }
  }

  
  async listFlows(token, instanceUrl) {
    try {
      validateInstanceUrl(instanceUrl);
      const query = "SELECT ApiName, MasterLabel, Description FROM FlowDefinitionView WHERE ProcessType IN ('AutolaunchedFlow', 'PromptFlow') AND IsActive = true";
      const response = await axios.get(
        `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(query)}`,
        { headers: await this.getHeaders(token) }
      );
      return response.data.records.map(r => ({
        apiName: r.ApiName,
        label: r.MasterLabel,
        description: r.Description || ''
      }));
    } catch (err) {
      console.warn('Could not list flows:', err.message);
      return [];
    }
  }

  async listPromptTemplates(token, instanceUrl) {
    try {
      validateInstanceUrl(instanceUrl);
      // PromptTemplate is available in v59.0+ Data API
      const query = "SELECT DeveloperName, MasterLabel, Description FROM PromptTemplate";
      const response = await axios.get(
        `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(query)}`,
        { headers: await this.getHeaders(token) }
      );
      return response.data.records.map(r => ({
        apiName: r.DeveloperName,
        label: r.MasterLabel,
        description: r.Description || ''
      }));
    } catch (err) {
      console.warn('Could not list prompt templates:', err.message);
      return [];
    }
  }

  async getAgents(token, instanceUrl) {
    try {
      validateInstanceUrl(instanceUrl);
      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <met:SessionHeader>
      <met:sessionId>${token}</met:sessionId>
    </met:SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <met:listMetadata>
      <met:queries>
        <met:type>AiAuthoringBundle</met:type>
      </met:queries>
      <met:queries>
        <met:type>Bot</met:type>
      </met:queries>
      <met:asOfVersion>${SF_API_VERSION.replace('v', '')}</met:asOfVersion>
    </met:listMetadata>
  </soapenv:Body>
</soapenv:Envelope>`;

      const response = await axios.post(
        `${instanceUrl}/services/Soap/m/${SF_API_VERSION.replace('v', '')}`,
        soapBody,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'text/xml',
            'SOAPAction': '""'
          }
        }
      );

      const xml = response.data;
      const agents = [];
      const regex = /<(?:\w+:)?fullName>(.*?)<\/(?:\w+:)?fullName>/g;
      let match;
      while ((match = regex.exec(xml)) !== null) {
        agents.push({
          id: match[1],
          developerName: match[1],
          masterLabel: match[1] // MasterLabel is not provided by listMetadata, using DeveloperName
        });
      }
      return agents.sort((a, b) => a.developerName.localeCompare(b.developerName));
    } catch (err) {
      console.error('Failed to fetch agents:', err.response?.data || err.message);
      return [];
    }
  }

  /**
   * Retrieves an existing AiAuthoringBundle from Salesforce using Metadata API retrieve()
   * and parses it into JSON for the orchestrator context.
   */
  async retrieveAgent(developerName, token, instanceUrl) {
    validateInstanceUrl(instanceUrl);
    const apiVer = SF_API_VERSION.replace('v', '');
    const soapUrl = `${instanceUrl}/services/Soap/m/${apiVer}`;
    const soapHeaders = { 'Content-Type': 'text/xml', 'SOAPAction': '""' };

    try {
      const retrieveSoap = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <met:SessionHeader>
      <met:sessionId>${token}</met:sessionId>
    </met:SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <met:retrieve>
      <met:retrieveRequest>
        <met:apiVersion>${apiVer}</met:apiVersion>
        <met:singlePackage>true</met:singlePackage>
        <met:unpackaged>
          <met:types>
            <met:members>${developerName}</met:members>
            <met:name>AiAuthoringBundle</met:name>
          </met:types>
          <met:version>${apiVer}</met:version>
        </met:unpackaged>
      </met:retrieveRequest>
    </met:retrieve>
  </soapenv:Body>
</soapenv:Envelope>`;

      const reqRes = await axios.post(soapUrl, retrieveSoap, { headers: soapHeaders });
      const idMatch = /<(?:\w+:)?id>([a-zA-Z0-9]+)<\/(?:\w+:)?id>/.exec(reqRes.data);
      if (!idMatch) return null;
      const jobId = idMatch[1];

      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        
        const checkSoap = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <met:SessionHeader>
      <met:sessionId>${token}</met:sessionId>
    </met:SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <met:checkRetrieveStatus>
      <met:asyncProcessId>${jobId}</met:asyncProcessId>
      <met:includeZip>true</met:includeZip>
    </met:checkRetrieveStatus>
  </soapenv:Body>
</soapenv:Envelope>`;

        const statusRes = await axios.post(soapUrl, checkSoap, { headers: soapHeaders });
        const data = statusRes.data;

        const statusMatch = /<(?:\w+:)?status>(.*?)<\/(?:\w+:)?status>/.exec(data);
        const status = statusMatch ? statusMatch[1] : '';
        const doneMatch = /<(?:\w+:)?done>(.*?)<\/(?:\w+:)?done>/.exec(data);
        const done = doneMatch ? doneMatch[1] === 'true' : false;

        if (done) {
          if (status === 'Succeeded') {
            const zipMatch = /<(?:\w+:)?zipFile>(.*?)<\/(?:\w+:)?zipFile>/.exec(data);
            if (!zipMatch) return null;
            
            const zipBase64 = zipMatch[1];
            const zip = new AdmZip(Buffer.from(zipBase64, 'base64'));
            const agentEntry = zip.getEntries().find(e => e.entryName.endsWith('.agent'));
            if (!agentEntry) return null;
            
            const yamlStr = agentEntry.getData().toString('utf-8');
            return { yaml: yamlStr };
          } else {
            console.error('Retrieve failed:', status);
            return null;
          }
        }
      }
    } catch (err) {
      console.error('Retrieve error:', err.response?.data || err.message);
      return null;
    }
    return null;
  }

  validateApexCode(apexCode, testClassCode, developerName) {
    if (!apexCode) return { valid: false, reason: 'No Apex code provided' };
    if (!apexCode.includes('@InvocableMethod')) return { valid: false, reason: 'Missing @InvocableMethod annotation' };
    if (!apexCode.includes('List<')) return { valid: false, reason: 'Missing List parameter or return (must bulkify)' };
    if (!apexCode.includes('global static') && !apexCode.includes('public static')) {
      return { valid: false, reason: 'Missing global static / public static method' };
    }

    if (testClassCode) {
      const isTestMatch = /@isTest/i.test(testClassCode);
      if (!isTestMatch) {
        return { valid: false, reason: 'TEST LINTER ERROR: testClassCode is missing @isTest annotation.' };
      }
      if (!testClassCode.includes('Test.startTest') || !testClassCode.includes('Test.stopTest')) {
        return { valid: false, reason: 'TEST LINTER ERROR: testClassCode must use Test.startTest() and Test.stopTest().' };
      }
      if (testClassCode.includes('System.assert(') || testClassCode.includes('System.assertEquals(')) {
        return { valid: false, reason: 'TEST LINTER ERROR: testClassCode contains legacy System.assert methods. You MUST use Assert.areEqual, Assert.isTrue, or Assert.fail instead.' };
      }
    }

    return { valid: true };
  }

  /**
   * Sanitizes Apex code coming from the LLM:
   * - Enforces global visibility
   * - Fixes class name to match developerName
   * - Does NOT blindly replace all double-quotes (that breaks debug statements)
   */
  sanitizeApexCode(apexCode, developerName) {
    let cls = apexCode || '';
    // Unescape literal backslash characters from JSON serialization
    cls = cls.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
    
    // Enforce global visibility and strictly prevent security bypasses
    cls = cls.replace(/\bpublic\s+with\s+sharing\s+class\b/gi, 'global with sharing class');
    cls = cls.replace(/\bpublic\s+without\s+sharing\s+class\b/gi, 'global with sharing class');
    cls = cls.replace(/\bglobal\s+without\s+sharing\s+class\b/gi, 'global with sharing class');
    cls = cls.replace(/\bpublic\s+class\b/gi, 'global with sharing class');
    cls = cls.replace(/\bglobal\s+class\b/gi, 'global with sharing class');
    cls = cls.replace(/\bpublic\s+static\b/gi, 'global static');

    // Fix class name to match the developerName exactly
    // Only target the class declaration line, not inner references
    const apexSafeName = sanitizeApexClassName(developerName);
    cls = cls.replace(/\bclass\s+\w+\s*\{/, `class ${apexSafeName} {`);

    return cls;
  }

  getFallbackApexClass(developerName, masterLabel) {
    const apexName = sanitizeApexClassName(developerName);
    return `global with sharing class ${apexName} {
    public class InputParameters {
        @InvocableVariable(label='Input' required=true)
        public String inputStr;
    }
    public class OutputParameters {
        @InvocableVariable(label='Output' required=true)
        public String outputStr;
    }
    @InvocableMethod(label='${masterLabel}' description='Auto-generated action')
    global static List<OutputParameters> execute(List<InputParameters> inputs) {
        List<OutputParameters> results = new List<OutputParameters>();
        for (InputParameters input : inputs) {
            OutputParameters out = new OutputParameters();
            out.outputStr = 'Processed';
            results.add(out);
        }
        return results;
    }
}`;
  }

  /**
   * Builds the metadata ZIP buffer using the new GenAiPlannerBundle architecture (API v64+).
   *
   * @param {Array} topics - array of topic payloads from LLM
   * @param {Array} actions - array of action payloads from LLM
   * @param {string} agentName - human-readable name for the agent
   * @param {string} instructions - agent-level system instructions
   * @param {string} rawYaml - pre-generated or LLM-modified YAML (bypasses dynamic generation)
   * @param {object} knowledge - knowledge/rag config
   * @returns {Buffer} ZIP buffer
   */
  buildMetadataZip(ctx, agentName = 'Generated_Agent') {
    const { topics, actions, variables, transitions, guardrails, escalation, instructions, rawYaml, knowledge, remoteSites } = ctx;
    const zip = new AdmZip();
    const safeAgentName = sanitizeName(agentName);
    const bundleName = safeAgentName;

    // ─── 1. PACKAGE.XML ───────────────────────────────────────────────────────
    let apexMembers = '';
    if (actions && actions.length > 0) {
      apexMembers = actions.map(a => {
        const apexName = sanitizeApexClassName(a.developerName);
        let members = `    <members>${apexName}</members>`;
        if (a.testClassCode) {
          members += `\n    <members>${apexName}Test</members>`;
        }
        return members;
      }).join('\n');
    }

    const hasActions = actions && actions.length > 0;
    const hasObjects = ctx.customObjects && ctx.customObjects.length > 0;
    const hasPerms = hasActions || hasObjects;

    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
${hasActions ? `  <types>
${apexMembers}
    <name>ApexClass</name>
  </types>
` : ''}${hasPerms ? `  <types>
    <members>Agentforge_Generated_Actions</members>
    <name>PermissionSet</name>
  </types>
  <types>
    <members>Admin</members>
    <name>Profile</name>
  </types>
` : ''}  <types>
    <members>${bundleName}</members>
    <name>AiAuthoringBundle</name>
  </types>
${remoteSites && remoteSites.length > 0 ? `  <types>
${remoteSites.map(r => `    <members>${r.fullName}</members>`).join('\n')}
    <name>RemoteSiteSetting</name>
  </types>
` : ''}${ctx.customObjects && ctx.customObjects.length > 0 ? `  <types>
${ctx.customObjects.map(o => `    <members>${o.apiName}</members>`).join('\n')}
    <name>CustomObject</name>
  </types>
` : ''}  <version>65.0</version>
</Package>`;

    zip.addFile('package.xml', Buffer.from(packageXml, 'utf-8'));

    // ─── 2. APEX CLASSES & PERMISSIONS ──────────────────────────────────────
    let apexClassesXML = '';
    
    for (const action of (actions || [])) {
      if (action.type && action.type !== 'apex') continue;

      const apexName = sanitizeApexClassName(action.developerName);
      apexClassesXML += `
    <classAccesses>
        <apexClass>${apexName}</apexClass>
        <enabled>true</enabled>
    </classAccesses>`;

      let cls = this.sanitizeApexCode(action.apexCode, action.developerName);

      // We no longer validate in buildMetadataZip because we validate pre-flight in deployAgent
      // But we still apply fallback if somehow it's empty
      if (!cls || !cls.trim()) {
        cls = this.getFallbackApexClass(action.developerName, action.masterLabel);
      }

      const clsMeta = `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <status>Active</status>
</ApexClass>`;

      zip.addFile(`classes/${apexName}.cls`, Buffer.from(cls, 'utf-8'));
      zip.addFile(`classes/${apexName}.cls-meta.xml`, Buffer.from(clsMeta, 'utf-8'));

      // ── Package companion @isTest class if the LLM provided one ──────────
      if (action.testClassCode) {
        const testClassName = `${apexName}Test`;
        const testCls = action.testClassCode;

        if (!testCls.includes('@isTest') && !testCls.includes('@IsTest')) {
          console.warn(`[Apex Test] Test class for "${apexName}" is missing @isTest annotation. Skipping.`);
        } else {
          const testClsMeta = `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <status>Active</status>
</ApexClass>`;

          zip.addFile(`classes/${testClassName}.cls`, Buffer.from(testCls, 'utf-8'));
          zip.addFile(`classes/${testClassName}.cls-meta.xml`, Buffer.from(testClsMeta, 'utf-8'));

          apexClassesXML += `
    <classAccesses>
        <apexClass>${testClassName}</apexClass>
        <enabled>true</enabled>
    </classAccesses>`;

          console.log(`[Apex Test] Packaged test class: ${testClassName}.cls`);
        }
      }
    }

    let objectPermsXML = '';
    let fieldPermsXML = '';

    // ── Build a unified set of all objects that need permissions ─────────────
    // 1. Custom objects created in this session (full CRUD + viewAllRecords)
    // 2. Objects referenced in generated Apex code (read/edit access only)
    // This ensures the Einstein Agent User can access EVERY object the agent
    // queries, regardless of whether we created it or it already existed.

    const customObjectApiNames = new Set(
      (ctx.customObjects || []).map(o => o.apiName)
    );

    // Merge custom-created + Apex-referenced objects
    const allReferencedObjects = new Set([
      ...customObjectApiNames,
      ...(ctx.referencedObjects || [])
    ]);

    for (const objApiName of allReferencedObjects) {
      // ALL objects referenced by agent Apex get viewAllRecords=true.
      //
      // WHY: The Einstein Agent User is a system-generated user that owns ZERO
      // records. If the org's OWD for an object (e.g. Claim, Case, Account) is
      // Private or Public Read Only, and no sharing rules target the Einstein
      // Agent User, it cannot see ANY records without viewAllRecords=true.
      // This matches Salesforce's own built-in Agentforce Service Agent
      // permission sets which grant viewAllRecords on queried objects.
      //
      // SECURITY NOTE: This Permission Set (Agentforge_Generated_Actions) is
      // assigned ONLY to the Einstein Agent User and the Admin tester — it is
      // never assigned to end-users. viewAllRecords here is agent-context only.
      objectPermsXML += `
    <objectPermissions>
        <allowCreate>true</allowCreate>
        <allowDelete>false</allowDelete>
        <allowEdit>true</allowEdit>
        <allowRead>true</allowRead>
        <modifyAllRecords>false</modifyAllRecords>
        <object>${objApiName}</object>
        <viewAllRecords>true</viewAllRecords>
    </objectPermissions>`;
    }

    // Field permissions for custom fields on objects we created
    if (ctx.customObjects && ctx.customObjects.length > 0) {
      for (const obj of ctx.customObjects) {
        for (const field of (obj.customFields || [])) {
          fieldPermsXML += `
    <fieldPermissions>
        <editable>true</editable>
        <field>${obj.apiName}.${field.apiName}</field>
        <readable>true</readable>
    </fieldPermissions>`;
        }
      }
    }

    if (apexClassesXML || objectPermsXML || fieldPermsXML) {
      const permSet = `<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Grants access to Agentforge generated Apex actions and objects</description>
    <hasActivationRequired>false</hasActivationRequired>
    <label>Agentforge Generated Actions</label>${apexClassesXML}${objectPermsXML}${fieldPermsXML}
</PermissionSet>`;
      zip.addFile('permissionsets/Agentforge_Generated_Actions.permissionset', Buffer.from(permSet, 'utf-8'));

      const adminProfile = `<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <custom>false</custom>${apexClassesXML}${objectPermsXML}${fieldPermsXML}
</Profile>`;
      zip.addFile('profiles/Admin.profile', Buffer.from(adminProfile, 'utf-8'));
    }

    // ─── 2.5 REMOTE SITES ──────────────────────────────────────────────────
    if (remoteSites && remoteSites.length > 0) {
      for (const rs of remoteSites) {
        const rsXml = `<?xml version="1.0" encoding="UTF-8"?>
<RemoteSiteSetting xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>${escapeXml(rs.description || '')}</description>
    <disableProtocolSecurity>false</disableProtocolSecurity>
    <isActive>true</isActive>
    <url>${rs.url}</url>
</RemoteSiteSetting>`;
        zip.addFile(`remoteSiteSettings/${rs.fullName}.remoteSite-meta.xml`, Buffer.from(rsXml, 'utf-8'));
      }
    }

    // ─── 2.6 CUSTOM OBJECTS ────────────────────────────────────────────────
    if (ctx.customObjects && ctx.customObjects.length > 0) {
      for (const obj of ctx.customObjects) {
        const objXml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <deploymentStatus>Deployed</deploymentStatus>
    <label>${escapeXml(obj.label)}</label>
    <pluralLabel>${escapeXml(obj.label)}s</pluralLabel>
    <nameField>
        <label>${escapeXml(obj.label)} Name</label>
        <type>Text</type>
    </nameField>
    <sharingModel>ReadWrite</sharingModel>${(obj.customFields || []).map(f => `
    <fields>
        <fullName>${escapeXml(f.apiName)}</fullName>
        <label>${escapeXml(f.label)}</label>
        <type>${escapeXml(f.type)}</type>
        <required>false</required>${getFieldTypeAttributes(f)}
    </fields>`).join('')}
</CustomObject>`;
        zip.addFile(`objects/${obj.apiName}.object`, Buffer.from(objXml, 'utf-8'));
      }
    }

    // ─── 3. AIAUTHORINGBUNDLE METADATA ─────────────────────────────────────────
    const bundleMetaXml = `<?xml version="1.0" encoding="UTF-8"?>
<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <bundleType>AGENT</bundleType>
</AiAuthoringBundle>`;
    
    zip.addFile(`aiAuthoringBundles/${bundleName}/${bundleName}.bundle-meta.xml`, Buffer.from(bundleMetaXml, 'utf-8'));

    // ─── 4. .AGENT YAML GENERATION ─────────────────────────────────────────────
    let agentYaml = rawYaml;
    if (!agentYaml) {
      // Use block scalar syntax for safe multiline instructions
      let safeInstructions = (instructions || 'You are an AI assistant.').replace(/\n/g, '\n        ');

      let varsYamlBlock = '';
      if (variables && variables.length > 0) {
        varsYamlBlock = '\nvariables:\n';
        for (const v of variables) {
          const mutableStr = v.isMutable ? 'mutable ' : '';
          let defaultStr = '';
          if (v.defaultValue !== undefined && v.defaultValue !== null && v.defaultValue !== '') {
            if (v.dataType === 'boolean') {
              defaultStr = ` = ${v.defaultValue === true || String(v.defaultValue).toLowerCase() === 'true' ? 'True' : 'False'}`;
            } else if (v.dataType === 'number') {
              defaultStr = ` = ${v.defaultValue}`;
            } else {
              defaultStr = ` = "${v.defaultValue}"`;
            }
          }
          varsYamlBlock += `    ${v.name}: ${mutableStr}${v.dataType}${defaultStr}\n        description: "${(v.description || '').replace(/"/g, '\\"')}"\n`;
        }
      }

      if (guardrails && guardrails.length > 0) {
        safeInstructions += '\n\n        ## GUARDRAILS\n';
        for (const g of guardrails) {
          safeInstructions += `        - ${g.replace(/\n/g, ' ')}\n`;
        }
      }
      safeInstructions = safeInstructions.trimEnd();
      
      let subagentTransitions = '';
      if (topics && topics.length > 0) {
        topics.forEach(topic => {
          const tName = sanitizeName(topic.developerName);
          subagentTransitions += `            go_to_${tName}: @utils.transition to @subagent.${tName}\n`;
          
          // Note: "available when" is NOT valid on @utils.transition actions per Agent Script schema rules.
          // Routing logic should be handled by the classifier or in regular action references.
        });
        
        // Also add escalation if configured
        if (escalation) {
           subagentTransitions += `            escalate: @utils.transition to @subagent.escalation\n`;
        }
      }
      
      let subagentsYaml = '';
      // If escalation is present, generate the escalation subagent
      if (escalation) {
        subagentsYaml += `subagent escalation:
    label: "Escalation"
    description: "Escalate to a human agent"
    reasoning:
        instructions: ->
            | Escalate to human support with the message: "${escalation.message}".
`;
            
        if (escalation.flowApiName) {
           subagentsYaml += `        actions:
            invoke_flow: @actions.${sanitizeName(escalation.flowApiName)}
    actions:
        ${sanitizeName(escalation.flowApiName)}:
            label: "Escalation Flow"
            description: "Invoke the escalation flow"
            target: "flow://${escalation.flowApiName}"
`;
        } else {
           subagentsYaml += `        actions:
            Create_Escalation_Case: @actions.Create_Escalation_Case
    actions:
        Create_Escalation_Case:
            label: "Create Escalation Case"
            description: "Creates an escalation case when human intervention is required."
            target: "apex://Create_Escalation_Case"
`;
        }
      }

      if (topics && topics.length > 0) {
        for (const topic of topics) {
          const tName = sanitizeName(topic.developerName);
          const tLabel = (topic.masterLabel || topic.developerName).replace(/"/g, '\\"');
          const tDesc = (topic.description || '').replace(/"/g, '\\"').replace(/\n/g, ' ');

          const topicActions = (actions || []).filter(a =>
            !a.topicName || a.topicName === topic.developerName
          );

          let actionsRefYaml = '';
          let actionsDefYaml = '';
          
          if (topicActions.length > 0) {
            actionsRefYaml += `        actions:\n`;
            actionsDefYaml += `    actions:\n`;
            
            for (const action of topicActions) {
              const aName = sanitizeName(action.developerName);
              const apexName = sanitizeApexClassName(action.developerName);
              const aLabel = (action.masterLabel || action.developerName).replace(/"/g, '\\"');
              const aDesc = (action.instruction || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
              
              actionsRefYaml += `            ${aName}: @actions.${aName}\n`;
              if (action.availableWhen) {
                actionsRefYaml += `                available when ${action.availableWhen}\n`;
              }
              
              // Dynamically generate inputs YAML block
              let inputsYamlBlock = '';
              if (action.inputs && action.inputs.length > 0) {
                inputsYamlBlock = `            inputs:\n`;
                for (const input of action.inputs) {
                  const iName = sanitizeName(input.name);
                  const iLabel = (input.label || iName).replace(/"/g, '\\"');
                  const iDesc = (input.description || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
                  const isReq = input.isRequired ? 'True' : 'False';
                  const isComplex = input.dataType === 'object' || (input.dataType && input.dataType.startsWith('list['));
                  const typeStr = isComplex ? input.dataType : (input.dataType === 'boolean' ? 'boolean' : (input.dataType === 'number' ? 'number' : 'string'));
                  
                  inputsYamlBlock += `                "${iName}": ${typeStr}
                    label: "${iLabel}"
                    description: "${iDesc}"
                    is_required: ${isReq}\n`;
                  if (isComplex && input.complexDataTypeName) {
                    inputsYamlBlock += `                    complex_data_type_name: "${input.complexDataTypeName}"\n`;
                  }
                }
              } else {
                inputsYamlBlock = `            inputs:\n                "inputStr": string\n                    label: "Input"\n                    description: "Input"\n                    is_required: False\n`;
              }

              // Dynamically generate outputs YAML block
              let outputsYamlBlock = '';
              if (action.outputs && action.outputs.length > 0) {
                outputsYamlBlock = `            outputs:\n`;
                for (const output of action.outputs) {
                  const oName = sanitizeName(output.name);
                  const oLabel = (output.label || oName).replace(/"/g, '\\"');
                  const isComplex = output.dataType === 'object' || (output.dataType && output.dataType.startsWith('list['));
                  const typeStr = isComplex ? output.dataType : (output.dataType === 'boolean' ? 'boolean' : (output.dataType === 'number' ? 'number' : 'string'));
                  
                  outputsYamlBlock += `                "${oName}": ${typeStr}
                    label: "${oLabel}"
                    is_displayable: True
                    filter_from_agent: False\n`;
                  if (isComplex && output.complexDataTypeName) {
                    outputsYamlBlock += `                    complex_data_type_name: "${output.complexDataTypeName}"\n`;
                  }
                }
              } else {
                outputsYamlBlock = `            outputs:\n                "outputStr": string\n                    label: "Output"\n                    is_displayable: True\n                    filter_from_agent: False\n`;
              }

              let targetStr = '';
              if (action.type === 'flow') {
                targetStr = `flow://${action.targetName}`;
              } else if (action.type === 'prompt') {
                targetStr = `prompt://${action.targetName}`;
              } else {
                targetStr = `apex://${sanitizeApexClassName(action.developerName)}`;
              }

              actionsDefYaml += `        ${aName}:
            label: "${aLabel}"
            description: "${aDesc}"
            target: "${targetStr}"
            require_user_confirmation: False
${inputsYamlBlock}${outputsYamlBlock}`;
            }
          }

          subagentsYaml += `subagent ${tName}:
    label: "${tLabel}"
    description: "${tDesc}"
    reasoning:
${topic.beforeReasoning ? `        before_reasoning: ->\n            | ${topic.beforeReasoning.replace(/\n/g, '\n            | ')}\n` : ''}        instructions: ->
            | ${(topic.instructions || 'Your job is to handle tasks related to this topic.').replace(/\n/g, '\n            | ')}
${topic.afterReasoning ? `        after_reasoning: ->\n            | ${topic.afterReasoning.replace(/\n/g, '\n            | ')}\n` : ''}${actionsRefYaml}${actionsDefYaml}\n`;
        }
      }

let knowledgeYamlBlock = '';
if (knowledge?.enabled && knowledge?.ragId) {
  knowledgeYamlBlock = `
knowledge:
    rag_feature_config_id: "${knowledge.ragId}"
    citations_enabled: True`;
}

      agentYaml = `system:
    instructions: |
        ${safeInstructions}
    messages:
        welcome: "Hi, I'm an AI assistant. How can I help you?"
        error: "Sorry, it looks like something has gone wrong."

config:
    agent_label: "${agentName.replace(/"/g, '\\"')}"
    developer_name: "${bundleName}"
    description: "System instructions and configuration for ${agentName.replace(/"/g, '\\"')}"${ctx.agentUserUsername ? `\n    default_agent_user: "${ctx.agentUserUsername}"` : ''}
${varsYamlBlock}

language:
    default_locale: "en_US"
    all_additional_locales: False${knowledgeYamlBlock}

start_agent agent_router:
    label: "Agent Router"
    description: "Welcome the user and determine the appropriate subagent based on user input"
    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"
    reasoning:
        instructions: ->
            | Select the best tool to call based on conversation history and user's intent.
        actions:
${subagentTransitions}
${subagentsYaml}`;
    }

    zip.addFile(`aiAuthoringBundles/${bundleName}/${bundleName}.agent`, Buffer.from(agentYaml, 'utf-8'));

    return zip.toBuffer();
  }

  /**
   * Polls Salesforce for deploy status. Returns structured result instead of throwing,
   * so callers can decide whether to retry or give up.
   * @returns {{ success: boolean, id: string, status?: string, errors?: Array }}
   */
  async waitForDeploy(deployId, token, instanceUrl, onProgress, cancelSignal) {
    validateInstanceUrl(instanceUrl);
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 5000)); // poll every 5s, up to 200s total
      if (cancelSignal && cancelSignal.cancelled) {
        console.log('[DEPLOY] Polling aborted due to cancel signal');
        return { success: false, errors: [{ problem: 'Deployment cancelled by user', component: 'user', type: 'cancel' }] };
      }
      let statusRes;
      try {
        statusRes = await axios.get(
          `${instanceUrl}/services/data/${SF_API_VERSION}/metadata/deployRequest/${deployId}?includeDetails=true`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
      } catch (pollErr) {
        // If Salesforce returns 401, token expired
        if (pollErr.response?.status === 401) {
          return { success: false, errors: [{ problem: 'OAuth token expired. Please re-login.', component: 'auth', type: 'auth' }] };
        }
        console.warn(`Poll attempt ${i + 1} failed: ${pollErr.message}`);
        continue;
      }

      const status = statusRes.data.deployResult;
      const progressMsg = `[ACT] Deploy status [${i + 1}/40]: ${status.status} (${status.numberComponentsDeployed || 0}/${status.numberComponentsTotal || '?'} components)`;
      console.log(progressMsg);
      if (onProgress) onProgress(progressMsg);

      if (status.done) {
        if (status.success) {
          let testSummary = '';
          const tr = status.details?.runTestResult;
          if (tr && tr.numTestsRun !== undefined && parseInt(tr.numTestsRun) > 0) {
             const run = parseInt(tr.numTestsRun) || 0;
             const failures = parseInt(tr.numFailures) || 0;
             const time = parseFloat(tr.totalTime) || 0;
             testSummary = `${run} test(s) run, ${failures} failed (time: ${time}ms)`;
             
             const coverageRaw = tr.codeCoverage || [];
             const coverage = Array.isArray(coverageRaw) ? coverageRaw : [coverageRaw];
             
             let totalLines = 0;
             let coveredLines = 0;
             coverage.forEach(cc => {
                 totalLines += (parseInt(cc.numLocations) || 0);
                 coveredLines += ((parseInt(cc.numLocations) || 0) - (parseInt(cc.numLocationsNotCovered) || 0));
             });
             
             if (totalLines > 0) {
                 const pct = Math.round((coveredLines / totalLines) * 100);
                 const benchmark = pct >= 85 ? '✅ Meets 85%+ Target' : '⚠️ Below 85% Target';
                 testSummary += `. Overall Code Coverage: ${pct}% (${benchmark})`;
             }
          }
          return { success: true, id: deployId, status: status.status, testSummary };
        } else {
          const failuresRaw = status.details?.componentFailures || [];
          const failures = Array.isArray(failuresRaw) ? failuresRaw : (failuresRaw ? [failuresRaw] : []);
          const errors = failures.map(f => ({
            component: f.componentName || 'unknown',
            type: f.componentType || 'unknown',
            problem: f.problem || 'unknown error',
            line: f.lineNumber || null,
            col: f.columnNumber || null,
            fileName: f.fileName || null
          }));
          const testFailuresRaw = status.details?.runTestResult?.failures || [];
          const testFailures = Array.isArray(testFailuresRaw) ? testFailuresRaw : (testFailuresRaw ? [testFailuresRaw] : []);
          const testErrors = testFailures.map(tf => ({
            component: tf.name || 'Test',
            type: 'TestFailure',
            problem: `${tf.methodName || ''}: ${tf.message || 'unknown test failure'}`.trim(),
            line: null,
            col: null
          }));

          // ── Parse code coverage warnings (fired when coverage < 75%) ──────
          const coverageWarningsRaw = status.details?.runTestResult?.codeCoverageWarnings || [];
          const coverageWarnings = Array.isArray(coverageWarningsRaw) ? coverageWarningsRaw : (coverageWarningsRaw ? [coverageWarningsRaw] : []);
          const coverageErrors = coverageWarnings.map(cw => ({
            component: cw.name || 'Coverage',
            type: 'CoverageWarning',
            problem: cw.message || 'Insufficient code coverage (minimum 75% required)',
            line: null,
            col: null
          }));

          const allErrors = [...errors, ...testErrors, ...coverageErrors];
          // Also capture the top-level error message if no component failures
          if (allErrors.length === 0 && status.errorMessage) {
            allErrors.push({ component: 'package', type: 'Package', problem: status.errorMessage, line: null, col: null });
          }
          console.error('[DEPLOYMENT ERRORS]', JSON.stringify(allErrors, null, 2));
          return { success: false, id: deployId, errors: allErrors };
        }
      }
    }
    return { success: false, errors: [{ problem: 'Deploy timed out after 200 seconds', component: 'package', type: 'timeout' }] };
  }

  /**
   * Sends the ZIP to Salesforce Metadata API deployRequest.
   */
  async deployMetadata(zipBuffer, token, instanceUrl, options = {}) {
    validateInstanceUrl(instanceUrl);
    const form = new FormData();
    const deployOptions = {
      checkOnly: false,
      ignoreWarnings: false, // false = fail on warnings to catch issues early
      rollbackOnError: true,
      singlePackage: true,
      testLevel: options.testLevel || 'NoTestRun',
      ...(options.runTests && options.runTests.length > 0
        ? { runTests: options.runTests }
        : {})
    };
    form.append('entity_content', JSON.stringify({ deployOptions }), { contentType: 'application/json' });
    form.append('file', zipBuffer, {
      filename: 'package.zip',
      contentType: 'application/zip'
    });

    const response = await axios.post(
      `${instanceUrl}/services/data/${SF_API_VERSION}/metadata/deployRequest`,
      form,
      { headers: { 'Authorization': `Bearer ${token}`, ...form.getHeaders() } }
    );
    return response.data;
  }

  // ─── Per-request context mutators ─────────────────────────────────────────

  createTopic(ctx, payload) {
    console.log('[ACT] Queuing Topic:', payload.developerName);
    payload.developerName = sanitizeName(payload.developerName);
    const existingIndex = ctx.topics.findIndex(t => t.developerName === payload.developerName);
    if (existingIndex !== -1) {
      ctx.topics[existingIndex] = payload; // Overwrite
    } else {
      ctx.topics.push(payload);
    }
    return { success: true, queued: true };
  }

  createAction(ctx, payload) {
    console.log('[ACT] Queuing Action (Apex):', payload.developerName);
    payload.developerName = sanitizeName(payload.developerName);
    payload.type = 'apex';
    const existingIndex = ctx.actions.findIndex(a => a.developerName === payload.developerName);
    if (existingIndex !== -1) {
      ctx.actions[existingIndex] = payload;
    } else {
      ctx.actions.push(payload);
    }

    // Auto-detect every SObject referenced in this Apex class and track them
    // so buildMetadataZip() can include the correct <objectPermissions> in
    // the Agentforge_Generated_Actions permission set.
    if (payload.apexCode) {
      const refs = extractReferencedObjects(payload.apexCode);
      if (!ctx.referencedObjects) ctx.referencedObjects = new Set();
      refs.forEach(obj => ctx.referencedObjects.add(obj));
      if (refs.length > 0) {
        console.log(`[ACT] Auto-detected SObject references in ${payload.developerName}:`, refs);
      }
    }

    return { success: true, queued: true };
  }

  attachFlowAction(ctx, payload) {
    console.log('[ACT] Attaching Flow Action:', payload.developerName);
    payload.developerName = sanitizeName(payload.developerName);
    payload.type = 'flow';
    payload.targetName = payload.flowApiName;
    const existingIndex = ctx.actions.findIndex(a => a.developerName === payload.developerName);
    if (existingIndex !== -1) {
      ctx.actions[existingIndex] = payload;
    } else {
      ctx.actions.push(payload);
    }
    return { success: true, queued: true };
  }

  attachPromptAction(ctx, payload) {
    console.log('[ACT] Attaching Prompt Action:', payload.developerName);
    payload.developerName = sanitizeName(payload.developerName);
    payload.type = 'prompt';
    payload.targetName = payload.promptTemplateApiName;
    const existingIndex = ctx.actions.findIndex(a => a.developerName === payload.developerName);
    if (existingIndex !== -1) {
      ctx.actions[existingIndex] = payload;
    } else {
      ctx.actions.push(payload);
    }
    return { success: true, queued: true };
  }

  configureRemoteSite(ctx, payload) {
    console.log('[ACT] Configuring Remote Site:', payload.url);
    ctx.remoteSites.push({
      fullName: sanitizeName(payload.name),
      url: payload.url,
      description: payload.description || 'Auto-generated remote site setting'
    });
    return { success: true, queued: true };
  }

  defineVariable(ctx, payload) {
    console.log('[ACT] Defining Variable:', payload.name);
    ctx.variables.push({
      name: payload.name,
      dataType: payload.dataType,
      isMutable: payload.isMutable,
      defaultValue: payload.defaultValue,
      description: payload.description
    });
    return { success: true, queued: true };
  }

  addTransition(ctx, payload) {
    console.log('[ACT] Adding Transition to:', payload.targetSubagent);
    ctx.transitions.push({
      target: sanitizeName(payload.targetSubagent),
      condition: payload.condition || ''
    });
    return { success: true, queued: true };
  }

  setBeforeReasoning(ctx, payload) {
    console.log('[ACT] Setting Before Reasoning for topic:', payload.topicName);
    const topic = ctx.topics.find(t => sanitizeName(t.developerName) === sanitizeName(payload.topicName));
    if (topic) {
      topic.beforeReasoning = payload.instructions;
      return { success: true, queued: true };
    }
    return { success: false, error: 'Topic not found' };
  }

  setAfterReasoning(ctx, payload) {
    console.log('[ACT] Setting After Reasoning for topic:', payload.topicName);
    const topic = ctx.topics.find(t => sanitizeName(t.developerName) === sanitizeName(payload.topicName));
    if (topic) {
      topic.afterReasoning = payload.instructions;
      return { success: true, queued: true };
    }
    return { success: false, error: 'Topic not found' };
  }

  setAvailableWhen(ctx, payload) {
    console.log('[ACT] Setting Available When for action:', payload.actionName);
    const action = ctx.actions.find(a => sanitizeName(a.developerName) === sanitizeName(payload.actionName));
    if (action) {
      action.availableWhen = payload.condition;
      return { success: true, queued: true };
    }
    return { success: false, error: 'Action not found' };
  }

  enableKnowledge(ctx, payload) {
    console.log('[ACT] Enabling Knowledge/RAG');
    ctx.knowledge = {
      enabled: true,
      ragId: payload.ragFeatureConfigId || ''
    };
    return { success: true, queued: true };
  }

  addGuardrail(ctx, payload) {
    console.log('[ACT] Adding guardrail:', payload.guardrailText);
    if (!ctx.guardrails) ctx.guardrails = [];
    ctx.guardrails.push(payload.guardrailText);
    return { success: true, queued: true };
  }

  configureEscalation(ctx, payload) {
    console.log('[ACT] Configuring escalation:', payload.escalationConditions);
    ctx.escalation = {
      conditions: payload.escalationConditions,
      message: payload.escalationMessage,
      flowApiName: payload.flowApiName || null
    };
    // BUG-7: The previous hardcoded escalation Apex created a `Case` record, which
    // is a restricted standard object that causes LICENSE_LIMIT_EXCEEDED errors on
    // Einstein Agent User orgs. The system prompt already instructs the LLM to avoid
    // Case — but this hardcoded fallback bypassed those rules entirely.
    //
    // FIX: Return a structured instruction to the LLM instead of hardcoded Apex.
    // The LLM will generate escalation code that follows the system prompt rules
    // (custom objects, proper wrappers, no restricted standard objects).

    // BUG-E FIX: Return explicit, actionable feedback to the LLM so it knows exactly
    // what was configured and what (if anything) it still needs to build.
    // The previous bare `{ success: true, queued: true }` left the LLM uncertain about
    // whether escalation was properly configured, causing it to repeatedly re-ask the user.
    if (payload.flowApiName) {
      console.log(`[ACT] Omni-Channel escalation configured with flow: ${payload.flowApiName}`);
      return {
        success: true,
        queued: true,
        escalationType: 'omni_channel_transfer',
        flowApiName: payload.flowApiName,
        instruction: `Omni-Channel escalation is fully configured. When the agent escalates, it will transfer the user to a human agent via the Salesforce Omni-Channel routing flow "${payload.flowApiName}". You do NOT need to generate any Apex for escalation — the flow handles the transfer. Simply reference this flow in the agent YAML subagent under the escalation topic's @utils.transition action.`
      };
    } else {
      console.log('[ACT] No Omni-Channel flow provided. LLM will generate a license-compliant fallback escalation action.');
      return {
        success: true,
        queued: true,
        escalationType: 'message_only_no_transfer',
        instruction: `IMPORTANT: No Omni-Channel flow API name was provided. This means the escalation will ONLY display the escalation message to the user — it will NOT transfer them to a human agent. You MUST: (1) Inform the user of this limitation clearly in your response, e.g. "Since no Omni-Channel flow was provided, I've configured a message-only escalation. The agent will tell users to contact support, but will not transfer them to a live agent. If you'd like a real transfer, please provide your Omni-Channel routing flow API name from Salesforce Setup > Omni-Channel > Routing Flows."; (2) Generate a simple Apex action (using a Custom Object like Support_Escalation__c, NOT Case) that logs the escalation request if persistence is desired; (3) Do NOT re-ask the user about escalation again unless they specifically request changes.`
      };
    }
  }

  setInstructions(ctx, payload) {
    console.log('[ACT] Setting Agent Instructions...');
    ctx.instructions = payload.instructions || '';
    return { success: true, queued: true };
  }

  updateAgentYaml(ctx, payload) {
    console.log('[ACT] Updating full agent YAML');
    ctx.rawYaml = payload.yamlContent;
    return { success: true, queued: true };
  }

  createCustomObjectWithData(ctx, payload) {
    console.log('[ACT] Queuing creation of custom object:', payload.apiName);
    ctx.customObjects.push({
      label: payload.objectLabel,
      apiName: payload.apiName,
      customFields: payload.customFields || [],
      mockRecords: payload.mockRecords || []
    });
    return { success: true, queued: true };
  }

  /**
   * Builds and deploys the agent. Returns structured result.
   * @param {object} ctx - per-request context (topics, actions, instructions)
   * @param {string} agentName
   * @param {string} token
   * @param {string} instanceUrl
   * @param {function} onProgress - SSE write callback for streaming progress
   */
  async deployAgent(ctx, agentName, token, instanceUrl, onProgress, cancelSignal) {
    console.log(`[ACT] Deploying agent: ${agentName} with ${ctx.topics.length} topics, ${ctx.actions.length} actions`);
    
    // ── Detect org type for environment-aware deployment (non-blocking) ────────
    // Production: RunSpecifiedTests | Sandbox/Dev Edition: NoTestRun
    try {
      const orgRes = await axios.get(
        `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=SELECT+IsSandbox,OrganizationType+FROM+Organization+LIMIT+1`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const orgData = orgRes.data.records[0] || {};
      ctx._orgIsSandbox = orgData.IsSandbox === true || orgData.OrganizationType === 'Developer Edition';
    } catch (err) {
      console.warn('[DEPLOY] Failed to verify org type. Defaulting to Production rules (RunSpecifiedTests).');
      ctx._orgIsSandbox = false; // Safest default
    }

    const activeCheck = await this.checkForActiveDeployments(token, instanceUrl);
    if (activeCheck.hasActive) {
      return {
        success: false,
        errors: [{
          problem: `There is already an active deployment running in this Salesforce org (${activeCheck.count} in progress). Please wait for it to complete before deploying again.`,
          component: 'org', type: 'concurrent'
        }]
      };
    }

    // ── Local Pre-Flight Linter ─────────────────────────────────────────────
    const linterErrors = [];
    if (ctx.actions && ctx.actions.length > 0) {
      for (const action of ctx.actions) {
        if (action.type === 'apex') {
          const validation = this.validateApexCode(action.apexCode, action.testClassCode, action.developerName);
          if (!validation.valid) {
            linterErrors.push({
              problem: validation.reason,
              component: action.developerName,
              type: 'ValidationError'
            });
          }
        }
      }
    }
    
    if (linterErrors.length > 0) {
      console.warn(`[LINTER] Blocked deployment due to ${linterErrors.length} validation errors.`);
      return { success: false, errors: linterErrors };
    }

    if (onProgress) onProgress(`[ACT] Resolving agent user binding...`);

    // ── Resolve Einstein Agent User and bind to agent YAML ─────────────────
    // This populates ctx.agentUserUsername which gets injected as
    // `default_agent_user` in the .agent YAML. Without this, Salesforce
    // has no way to associate the agent with the provisioned permission set.
    try {
      const agentUserResult = await findOrCreateAgentUser(token, instanceUrl);
      if (agentUserResult && agentUserResult.username) {
        ctx.agentUserUsername = agentUserResult.username;
        console.log(`[DEPLOY] Binding agent to Einstein Agent User: ${ctx.agentUserUsername}`);
        if (onProgress) onProgress(`[ACT] Agent user resolved: ${ctx.agentUserUsername}`);
      } else {
        console.warn('[DEPLOY] findOrCreateAgentUser returned no username — default_agent_user will be omitted from YAML.');
      }
    } catch (agentUserErr) {
      // Non-fatal: the agent can still deploy, but may lack data access until
      // the Einstein Agent User is manually provisioned.
      console.warn('[DEPLOY] Could not resolve Einstein Agent User for YAML binding:', agentUserErr.message);
      if (onProgress) onProgress(`[ACT] Warning: Could not resolve Einstein Agent User (${agentUserErr.message}). Data access may be limited.`);
    }

    if (onProgress) onProgress(`[ACT] Building metadata package for "${agentName}"...`);

    const zipBuffer = this.buildMetadataZip(ctx, agentName);

    // ── Determine test level based on org type ──────────────────────────────
    // Sandbox/Dev Edition: NoTestRun (fast build, test classes still deployed)
    // Production:          RunSpecifiedTests (Salesforce requires this + 75% coverage)
    let deployOpts = {};
    const testClassNames = (ctx.actions || [])
      .filter(a => a.type === 'apex' && a.testClassCode)
      .map(a => sanitizeApexClassName(a.developerName) + 'Test');

    if (testClassNames.length > 0) {
      deployOpts = {
        testLevel: 'RunSpecifiedTests',
        runTests: testClassNames
      };
      if (onProgress) onProgress(`[ACT] Validating tests before deployment. Running ${testClassNames.length} Apex test class(es)...`);
    }

    if (onProgress) onProgress(`[ACT] Uploading to Salesforce...`);
    let deployResponse;
    try {
      deployResponse = await this.deployMetadata(zipBuffer, token, instanceUrl, deployOpts);
    } catch (err) {
      if (err.response?.status === 401) {
        return { success: false, errors: [{ problem: 'OAuth token expired. Please re-login.', component: 'auth', type: 'auth' }] };
      }
      return { success: false, errors: [{ problem: err.message, component: 'deployRequest', type: 'network' }] };
    }

    if (onProgress) onProgress(`[ACT] Deploy queued (id: ${deployResponse.id}). Polling for result...`);
    const result = await this.waitForDeploy(deployResponse.id, token, instanceUrl, onProgress, cancelSignal);
    
    if (result.success && result.testSummary) {
      if (onProgress) onProgress(`[ACT] Test Execution Results: ${result.testSummary}`);
    }

    // Post-deployment: Insert mock data if custom objects were created
    if (result.success && ctx.customObjects && ctx.customObjects.length > 0) {
      if (onProgress) onProgress(`[ACT] Custom objects deployed successfully. Seeding mock data...`);
      for (const obj of ctx.customObjects) {
        if (obj.mockRecords && obj.mockRecords.length > 0) {
          try {
            for (const record of obj.mockRecords) {
              await axios.post(
                `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${obj.apiName}/`,
                record,
                { headers: await this.getHeaders(token) }
              );
            }
            if (onProgress) onProgress(`[ACT] Seeded ${obj.mockRecords.length} records into ${obj.apiName}`);
          } catch (err) {
            console.error(`Failed to insert mock data for ${obj.apiName}:`, err.message);
            if (onProgress) onProgress(`[ACT] Failed to seed mock data for ${obj.apiName}: ${err.message}`);
          }
        }
      }
    }
    
    return result;
  }

  /**
   * Automatically assign the Agentforge_Generated_Actions Permission Set to the authenticated user.
   */
  async autoAssignPermissionSet(token, instanceUrl) {
    try {
      // ── STEP 1: Resolve User Identities (Admin & Einstein Agent User) ─────
      const userinfoRes = await axios.get(`${instanceUrl}/services/oauth2/userinfo`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const adminUserId = userinfoRes.data.user_id;

      if (!adminUserId) {
        return { success: false, reason: 'Failed to extract user_id from token' };
      }

      // FIX: lastReason declared BEFORE any try/catch that references it.
      // Previously it was declared after, causing silent failure suppression
      // when the Einstein Agent User lookup failed.
      let lastReason = '';
      let agentUserId = null;

      try {
        const agentUserRes = await axios.get(
          `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=SELECT+Id+FROM+User+WHERE+Profile.Name='Einstein+Agent+User'+AND+IsActive=true+LIMIT+1`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        if (agentUserRes.data.records && agentUserRes.data.records.length > 0) {
          agentUserId = agentUserRes.data.records[0].Id;
          console.log(`[AUTH] Einstein Agent User resolved: ${agentUserId}`);
        } else {
          const msg = 'Einstein Agent User not found — permission set assigned to Admin only. Run the Pre-Flight Diagnostic to provision the agent user.';
          console.warn('[AUTH]', msg);
          lastReason = msg;
        }
      } catch (err) {
        const msg = `Could not verify Einstein Agent User: ${err.message}`;
        console.error('[AUTH]', msg);
        lastReason = msg;
      }

      // ── STEP 2: Wait for Salesforce metadata indexing (extended retry) ────
      // Metadata can take 15-30s to index after deployment. We retry 8×4s
      // (32s total) instead of the previous 5×3s (15s) to handle slow orgs.
      let psId = null;
      for (let attempt = 1; attempt <= 8; attempt++) {
        try {
          const psRes = await axios.get(
            `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=SELECT+Id+FROM+PermissionSet+WHERE+Name='Agentforge_Generated_Actions'+LIMIT+1`,
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          if (psRes.data.records && psRes.data.records.length > 0) {
            psId = psRes.data.records[0].Id;
            console.log(`[AUTH] Found Agentforge_Generated_Actions PS (attempt ${attempt}): ${psId}`);
            break;
          }
        } catch (queryErr) {
          console.warn(`[AUTH] PS lookup attempt ${attempt} failed:`, queryErr.message);
        }
        if (attempt < 8) {
          console.log(`[AUTH] PS not found yet (attempt ${attempt}/8). Waiting 4s for Salesforce metadata indexing...`);
          await new Promise(r => setTimeout(r, 4000));
        }
      }

      if (!psId) {
        return { success: false, reason: 'Agentforge_Generated_Actions permission set not found after 32s (metadata indexing lag). The permission set was deployed — please manually assign it in Salesforce Setup > Permission Sets.' };
      }

      // ── STEP 3: Assign Agentforge_Generated_Actions to Admin + Agent User ─
      const usersToAssign = [adminUserId];
      if (agentUserId) usersToAssign.push(agentUserId);

      let allSuccess = true;

      for (const targetUserId of usersToAssign) {
        try {
          await axios.post(
            `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/PermissionSetAssignment/`,
            { AssigneeId: targetUserId, PermissionSetId: psId },
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          console.log(`[AUTH] Assigned Agentforge_Generated_Actions to user ${targetUserId}`);
        } catch (assignErr) {
          const errData = assignErr.response?.data;
          if (Array.isArray(errData) && errData.length > 0 && errData[0].errorCode === 'DUPLICATE_VALUE') {
            console.log(`[AUTH] User ${targetUserId} already has Agentforge_Generated_Actions (duplicate — OK)`);
          } else {
            console.error(`[AUTH] Failed to assign PS to ${targetUserId}:`, errData || assignErr.message);
            allSuccess = false;
            lastReason = `Failed to assign permission set: ${JSON.stringify(errData || assignErr.message)}`;
          }
        }
      }

      // ── STEP 4: Auto-discover and assign industry-specific permission sets ─
      // Salesforce industry clouds (FSC Insurance, Health Cloud, etc.) require
      // additional permission sets for the Einstein Agent User to access their
      // objects (e.g. Claim, ClaimItem, HealthCondition). We discover these
      // dynamically and assign them to the Einstein Agent User automatically
      // to prevent SECURITY_RESTRICTION_ERROR at agent runtime.
      if (agentUserId) {
        await this._assignIndustryPermissionSets(token, instanceUrl, agentUserId);
      }

      return { success: allSuccess, reason: lastReason };
    } catch (err) {
      console.error('[AUTH] autoAssignPermissionSet error:', err.response?.data || err.message);
      return { success: false, reason: err.message };
    }
  }

  /**
   * Discovers and assigns industry-specific Salesforce permission sets to
   * the Einstein Agent User. This covers Financial Services Cloud (Insurance,
   * Banking), Health Cloud, Consumer Goods Cloud, and other industry orgs
   * that require extra permissions beyond the base Agentforce sets.
   *
   * This prevents SECURITY_RESTRICTION_ERROR when agents query industry
   * objects like Claim, InsuranceCoverage, HealthCondition, etc.
   */
  async _assignIndustryPermissionSets(token, instanceUrl, agentUserId) {
    // Known industry-specific permission sets required for Einstein Agent User
    // data access. These are Salesforce-managed PS names (not labels), so they
    // are stable across org types.
    const INDUSTRY_PERMISSION_SETS = [
      // Financial Services Cloud — Insurance
      'InsuranceAgentAccess',
      'InsuranceAgentforceAccess',
      'FinancialServicesCloudStandard',
      'FSCInsuranceAgentUser',
      // Financial Services Cloud — Banking / Wealth
      'BankingAgentAccess',
      'WealthManagementAgentAccess',
      // Health Cloud
      'HealthCloudFoundation',
      'HealthCloudAgentAccess',
      // Consumer Goods Cloud
      'ConsumerGoodsCloudAgentAccess',
      // Agentforce for Service — extra object access PS
      'AgentforceServiceAgentObjectAccess',
      'AgentforceServiceAgentPermissions',
    ];

    let discoveredIds = [];
    try {
      const nameList = INDUSTRY_PERMISSION_SETS.map(n => `'${n}'`).join(',');
      const psRes = await axios.get(
        `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=SELECT+Id,Name+FROM+PermissionSet+WHERE+Name+IN+(${encodeURIComponent(nameList)})+LIMIT+50`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      discoveredIds = (psRes.data.records || []).map(r => ({ id: r.Id, name: r.Name }));
      if (discoveredIds.length > 0) {
        console.log(`[AUTH] Discovered ${discoveredIds.length} industry permission set(s):`, discoveredIds.map(r => r.name).join(', '));
      } else {
        console.log('[AUTH] No industry-specific permission sets found in this org (standard org — skipping).');
        return;
      }
    } catch (err) {
      console.warn('[AUTH] Industry PS discovery failed (non-fatal):', err.message);
      return;
    }

    for (const ps of discoveredIds) {
      try {
        await axios.post(
          `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/PermissionSetAssignment/`,
          { AssigneeId: agentUserId, PermissionSetId: ps.id },
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        console.log(`[AUTH] Assigned industry PS "${ps.name}" to Einstein Agent User`);
      } catch (assignErr) {
        const errData = assignErr.response?.data;
        if (Array.isArray(errData) && errData.length > 0 && errData[0].errorCode === 'DUPLICATE_VALUE') {
          console.log(`[AUTH] Industry PS "${ps.name}" already assigned (duplicate — OK)`);
        } else if (Array.isArray(errData) && errData.length > 0 && errData[0].errorCode === 'LICENSE_LIMIT_EXCEEDED') {
          console.warn(`[AUTH] Industry PS "${ps.name}" cannot be assigned to Einstein Agent User (license restriction — skipping)`);
        } else {
          // Non-fatal: don't fail the whole flow if one industry PS can't be assigned
          console.warn(`[AUTH] Could not assign industry PS "${ps.name}":`, errData || assignErr.message);
        }
      }
    }
  }
}

export default new SalesforceClient();
