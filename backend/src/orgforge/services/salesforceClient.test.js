/**
 * Unit tests for salesforceClient.js
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeploySoapEnvelope, salesforceClient } from './salesforceClient.js';

describe('buildDeploySoapEnvelope', () => {
  it('emits singlePackage=true so Salesforce reads the manifest at the zip root', () => {
    const env = buildDeploySoapEnvelope('tok', 'aGk=', { checkOnly: true });
    assert.match(env, /<met:singlePackage>true<\/met:singlePackage>/);
  });

  it('includes session, base64 zip, checkOnly and testLevel', () => {
    const zipBase64 = Buffer.from('hello').toString('base64');
    const env = buildDeploySoapEnvelope('session-token', zipBase64, {
      checkOnly: true,
      testLevel: 'NoTestRun'
    });

    assert.match(env, /<met:sessionId>session-token<\/met:sessionId>/);
    assert.match(env, /<met:ZipFile>aGVsbG8=<\/met:ZipFile>/);
    assert.match(env, /<met:checkOnly>true<\/met:checkOnly>/);
    assert.match(env, /<met:testLevel>NoTestRun<\/met:testLevel>/);
  });

  it('defaults checkOnly to false when not set', () => {
    const env = buildDeploySoapEnvelope('tok', 'aGk=', {});
    assert.match(env, /<met:checkOnly>false<\/met:checkOnly>/);
  });

  it('honors an explicit singlePackage=false override', () => {
    const env = buildDeploySoapEnvelope('tok', 'aGk=', { singlePackage: false });
    assert.match(env, /<met:singlePackage>false<\/met:singlePackage>/);
  });

  it('emits RunLocalTests for production deployments (PRD FR-37 test level)', () => {
    const env = buildDeploySoapEnvelope('tok', 'aGk=', { checkOnly: false, testLevel: 'RunLocalTests' });
    assert.match(env, /<met:testLevel>RunLocalTests<\/met:testLevel>/);
  });

  it('emits DeployOptions elements in XSD sequence order (checkOnly, singlePackage, testLevel)', () => {
    const env = buildDeploySoapEnvelope('tok', 'aGk=', { checkOnly: true, testLevel: 'RunAllTestsInOrg' });
    const checkOnlyIdx = env.indexOf('<met:checkOnly>');
    const singlePackageIdx = env.indexOf('<met:singlePackage>');
    const testLevelIdx = env.indexOf('<met:testLevel>');
    assert.ok(checkOnlyIdx > -1 && singlePackageIdx > -1 && testLevelIdx > -1);
    assert.ok(
      checkOnlyIdx < singlePackageIdx && singlePackageIdx < testLevelIdx,
      `expected order checkOnly < singlePackage < testLevel, got ${checkOnlyIdx}, ${singlePackageIdx}, ${testLevelIdx}`
    );
  });
});

describe('salesforceClient.resolveBaseUrl', () => {
  it('routes production to login.salesforce.com', () => {
    assert.equal(salesforceClient.resolveBaseUrl('production'), 'https://login.salesforce.com');
  });

  it('routes sandbox to test.salesforce.com', () => {
    assert.equal(salesforceClient.resolveBaseUrl('sandbox'), 'https://test.salesforce.com');
  });

  it('routes scratch to the org instance URL and strips trailing slash', () => {
    assert.equal(
      salesforceClient.resolveBaseUrl('scratch', 'https://abc-dev-ed.scratch.my.salesforce.com/'),
      'https://abc-dev-ed.scratch.my.salesforce.com'
    );
  });

  it('throws a 400 error for scratch orgs without an instanceUrl', () => {
    assert.throws(
      () => salesforceClient.resolveBaseUrl('scratch'),
      (err) => err.status === 400 && /instanceUrl/.test(err.message)
    );
  });

  it('defaults to production base when no orgType given', () => {
    assert.equal(salesforceClient.resolveBaseUrl(), 'https://login.salesforce.com');
  });
});
