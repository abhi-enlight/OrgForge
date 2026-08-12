/**
 * Unit tests for staticAnalysis.js (REF-03 lightweight Apex analyzer)
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeApexArtifacts } from './staticAnalysis.js';

function apexArtifact(content, filePath = 'classes/MyClass.cls') {
  return { filePath, metadataType: 'ApexClass', content };
}

describe('analyzeApexArtifacts — clean code passes', () => {
  it('returns no violations for safe Apex (with sharing + bind variables)', () => {
    const code = `
public with sharing class AccountService {
  public static List<Account> findByName(String name) {
    return [SELECT Id, Name FROM Account WHERE Name = :name];
  }
  public static void insertAccount(Account a) { insert a; }
}`;
    const result = analyzeApexArtifacts([apexArtifact(code)]);
    assert.equal(result.hasHighViolations, false);
    assert.deepEqual(result.violations, []);
  });

  it('ignores non-Apex artifacts (validation rules, fields)', () => {
    const result = analyzeApexArtifacts([
      { filePath: 'objects/Opp/validationRules/R.validationRule-meta.xml', metadataType: 'ValidationRule', content: '<ValidationRule/>' },
      { filePath: 'objects/Opp/fields/F.field-meta.xml', metadataType: 'CustomField', content: '<CustomField/>' }
    ]);
    assert.equal(result.hasHighViolations, false);
  });

  it('handles empty / undefined artifact lists', () => {
    assert.equal(analyzeApexArtifacts(undefined).hasHighViolations, false);
    assert.equal(analyzeApexArtifacts([]).hasHighViolations, false);
    assert.equal(analyzeApexArtifacts([null, { metadataType: 'ApexClass' }]).hasHighViolations, false);
  });
});

describe('analyzeApexArtifacts — REF-03 violations', () => {
  it('flags SOQL built by string concatenation (ApexSOQLInjection)', () => {
    const code = `
public with sharing class SearchService {
  public static List<Account> search(String term) {
    String q = 'SELECT Id FROM Account WHERE Name LIKE \'%' + term + '%\'';
    return Database.query(q);
  }
}`;
    const result = analyzeApexArtifacts([apexArtifact(code)]);
    assert.equal(result.hasHighViolations, true);
    assert.ok(result.violations.some(v => v.rule === 'ApexSOQLInjection'));
    assert.ok(result.violations.every(v => v.severity === 'HIGH'));
  });

  it('flags hardcoded credentials (AvoidHardcodedCredentials)', () => {
    const code = `
public without sharing class LegacyConnector {
  private static final String API_KEY = 'dummy_secret_token_value_for_testing';
  public static void call() {}
}`;
    const result = analyzeApexArtifacts([apexArtifact(code)]);
    assert.equal(result.hasHighViolations, true);
    assert.ok(result.violations.some(v => v.rule === 'AvoidHardcodedCredentials'));
  });

  it('flags externally-reachable DML class without sharing (ApexSharingViolations)', () => {
    const code = `
public class LeakyService {
  @AuraEnabled
  public static void deleteAccounts(List<Id> ids) {
    delete [SELECT Id FROM Account WHERE Id IN :ids];
  }
}`;
    const result = analyzeApexArtifacts([apexArtifact(code)]);
    assert.equal(result.hasHighViolations, true);
    assert.ok(result.violations.some(v => v.rule === 'ApexSharingViolations'));
  });

  it('does not flag DML in a class that declares sharing', () => {
    const code = `
public with sharing class SafeService {
  @AuraEnabled
  public static void deleteAccounts(List<Id> ids) {
    delete [SELECT Id FROM Account WHERE Id IN :ids];
  }
}`;
    const result = analyzeApexArtifacts([apexArtifact(code)]);
    assert.equal(result.hasHighViolations, false);
  });

  it('flags System.debug of secrets (SystemDebugSecrets)', () => {
    const code = `
public with sharing class Logger {
  public static void log(String token) { System.debug('Auth token: ' + token); }
}`;
    const result = analyzeApexArtifacts([apexArtifact(code)]);
    assert.equal(result.hasHighViolations, true);
    assert.ok(result.violations.some(v => v.rule === 'SystemDebugSecrets'));
  });

  it('reports the offending file path for traceability', () => {
    const result = analyzeApexArtifacts([apexArtifact('String secret = \'hunter2secret\';', 'classes/Vault.cls')]);
    assert.equal(result.violations[0].filePath, 'classes/Vault.cls');
  });
});
