/**
 * Unit tests for metadataTransport.js
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFullName, metadataTransport } from './metadataTransport.js';
import AdmZip from 'adm-zip';

describe('deriveFullName', () => {
  it('derives ValidationRule name', () => {
    assert.equal(
      deriveFullName('force-app/main/default/objects/Account/validationRules/MyRule.validationRule-meta.xml'),
      'Account.MyRule'
    );
  });

  it('derives CustomField name', () => {
    assert.equal(
      deriveFullName('force-app/main/default/objects/Contact/fields/Active__c.field-meta.xml'),
      'Contact.Active__c'
    );
  });

  it('derives CustomObject name', () => {
    assert.equal(
      deriveFullName('force-app/main/default/objects/Custom__c/Custom__c.object-meta.xml'),
      'Custom__c'
    );
  });

  it('derives ApexClass name', () => {
    assert.equal(
      deriveFullName('force-app/main/default/classes/MyService.cls'),
      'MyService'
    );
  });

  it('derives ApexTrigger name', () => {
    assert.equal(
      deriveFullName('force-app/main/default/triggers/AccountTrigger.trigger'),
      'AccountTrigger'
    );
  });

  it('returns null for empty or invalid paths', () => {
    assert.equal(deriveFullName(''), null);
    assert.equal(deriveFullName(null), null);
    assert.equal(deriveFullName(undefined), null);
  });
});

describe('assembleDeploymentZip', () => {
  it('throws on missing content or filePath', () => {
    assert.throws(() => metadataTransport.assembleDeploymentZip([{ metadataType: 'ApexClass' }]));
    assert.throws(() => metadataTransport.assembleDeploymentZip([{ filePath: 'a.cls' }]));
  });

  it('throws on unknown metadata type', () => {
    assert.throws(
      () => metadataTransport.assembleDeploymentZip([{ filePath: 'a', content: 'c', metadataType: 'UnknownType' }]),
      /Unknown metadata type/
    );
  });

  it('throws if it cannot derive full name and it is not provided', () => {
    assert.throws(
      () => metadataTransport.assembleDeploymentZip([{ filePath: 'foo/.xml', content: 'c', metadataType: 'ApexClass' }]),
      /Could not derive/
    );
  });

  it('assembles a valid zip with package.xml and artifact (source-format layout)', () => {
    const buffer = metadataTransport.assembleDeploymentZip([
      {
        filePath: 'force-app/main/default/classes/MyService.cls',
        metadataType: 'ApexClass',
        content: 'public class MyService {}'
      }
    ]);
    
    assert.ok(Buffer.isBuffer(buffer));
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().map(e => e.entryName);
    
    assert.ok(entries.includes('package.xml'));
    // Salesforce derives the package root from the FIRST zip entry — the
    // manifest must come first or the dry-run fails with "No package.xml
    // found" against the first top-level directory.
    assert.equal(entries[0], 'package.xml');
    // MDAPI deploy zips use the source-format layout at the zip root — the
    // force-app/main/default prefix is stripped.
    assert.ok(entries.includes('classes/MyService.cls'));
    assert.ok(!entries.includes('force-app/main/default/classes/MyService.cls'));
    
    const packageXml = zip.readAsText('package.xml');
    assert.match(packageXml, /<name>ApexClass<\/name>/);
    assert.match(packageXml, /<members>MyService<\/members>/);
  });

  it('emits package.xml before every artifact regardless of input order', () => {
    const buffer = metadataTransport.assembleDeploymentZip([
      {
        filePath: 'force-app/main/default/objects/Account/fields/Active__c.field-meta.xml',
        metadataType: 'CustomField',
        content: '<CustomField><fullName>Active__c</fullName><label>Active</label><type>Checkbox</type></CustomField>'
      },
      {
        filePath: 'force-app/main/default/classes/MyService.cls',
        metadataType: 'ApexClass',
        content: 'public class MyService {}'
      }
    ]);

    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().map(e => e.entryName);

    assert.equal(entries[0], 'package.xml');
    assert.equal(entries.length, 3);
    assert.ok(entries.includes('objects/Account.object'));
    assert.ok(entries.includes('classes/MyService.cls'));
  });

  it('folds decomposed CustomField into a metadata-format CustomObject container', () => {
    const buffer = metadataTransport.assembleDeploymentZip([
      {
        filePath: 'force-app/main/default/objects/Support_Ticket__c/fields/Status__c.field-meta.xml',
        metadataType: 'CustomField',
        content: `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
  <fullName>Status__c</fullName>
  <label>Status</label>
  <type>Picklist</type>
  <valueSet>
    <restricted>true</restricted>
    <valueSetDefinition>
      <sorted>false</sorted>
      <value><fullName>Open</fullName><default>true</default><label>Open</label></value>
    </valueSetDefinition>
  </valueSet>
</CustomField>`
      }
    ]);

    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().map(e => e.entryName);

    // The SOAP deploy() call expects child types inline in objects/<Object>.object
    // — the decomposed .field-meta.xml path must NOT be shipped.
    assert.ok(entries.includes('objects/Support_Ticket__c.object'));
    assert.ok(!entries.some(e => e.includes('.field-meta.xml')));
    assert.ok(!entries.some(e => e.startsWith('unpackaged/')));

    const container = zip.readAsText('objects/Support_Ticket__c.object');
    assert.match(container, /<CustomObject xmlns="http:\/\/soap\.sforce\.com\/2006\/04\/metadata">/);
    assert.match(container, /<fields>/);
    assert.match(container, /<fullName>Status__c<\/fullName>/);
    assert.match(container, /<type>Picklist<\/type>/);
    assert.match(container, /<value><fullName>Open<\/fullName>/);

    const packageXml = zip.readAsText('package.xml');
    assert.match(packageXml, /<name>CustomField<\/name>/);
    assert.match(packageXml, /<members>Support_Ticket__c\.Status__c<\/members>/);
  });

  it('merges multiple child artifacts (fields + validation rules) into one container', () => {
    const buffer = metadataTransport.assembleDeploymentZip([
      {
        filePath: 'force-app/main/default/objects/Account/fields/Active__c.field-meta.xml',
        metadataType: 'CustomField',
        content: '<CustomField><fullName>Active__c</fullName><label>Active</label><type>Checkbox</type></CustomField>'
      },
      {
        filePath: 'force-app/main/default/objects/Account/validationRules/Rule1.validationRule-meta.xml',
        metadataType: 'ValidationRule',
        content: '<ValidationRule><fullName>Rule1</fullName><errorConditionFormula>Active__c = true</errorConditionFormula><errorMessage>Nope</errorMessage></ValidationRule>'
      }
    ]);

    const zip = new AdmZip(buffer);
    const container = zip.readAsText('objects/Account.object');

    assert.ok(container.includes('<fields>'));
    assert.ok(container.includes('<validationRules>'));
    assert.match(container, /<fullName>Active__c<\/fullName>/);
    assert.match(container, /<fullName>Rule1<\/fullName>/);
    assert.equal((container.match(/<fields>/g) || []).length, 1);
    assert.equal((container.match(/<validationRules>/g) || []).length, 1);

    const packageXml = zip.readAsText('package.xml');
    assert.match(packageXml, /<members>Account\.Active__c<\/members>/);
    assert.match(packageXml, /<members>Account\.Rule1<\/members>/);
  });

  it('flattens CustomObject source files to objects/<Name>.object and strips -meta from generic types', () => {
    const buffer = metadataTransport.assembleDeploymentZip([
      {
        filePath: 'force-app/main/default/objects/Custom__c/Custom__c.object-meta.xml',
        metadataType: 'CustomObject',
        content: '<?xml version="1.0" encoding="UTF-8"?><CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"><label>Custom</label></CustomObject>'
      },
      {
        filePath: 'force-app/main/default/flows/MyFlow.flow-meta.xml',
        metadataType: 'Flow',
        content: '<?xml version="1.0" encoding="UTF-8"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><description>hi</description></Flow>'
      }
    ]);

    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().map(e => e.entryName);

    assert.ok(entries.includes('objects/Custom__c.object'));
    assert.ok(!entries.includes('objects/Custom__c/Custom__c.object-meta.xml'));
    assert.ok(entries.includes('flows/MyFlow.flow'));
    assert.ok(!entries.includes('flows/MyFlow.flow-meta.xml'));
  });

  it('folds a no-declaration, leading-whitespace CustomField artifact correctly', () => {
    const buffer = metadataTransport.assembleDeploymentZip([
      {
        filePath: 'force-app/main/default/objects/Account/fields/Active__c.field-meta.xml',
        metadataType: 'CustomField',
        content: '\n  <CustomField><fullName>Active__c</fullName><label>Active</label><type>Checkbox</type></CustomField>\n'
      }
    ]);

    const zip = new AdmZip(buffer);
    const container = zip.readAsText('objects/Account.object');
    assert.ok(container.includes('<fields>'));
    assert.ok(!container.includes('<CustomField>'));
    assert.match(container, /<fullName>Active__c<\/fullName>/);
  });

  it('rejects CustomField XML with an unsupported <type> at packaging time', () => {
    assert.throws(
      () => metadataTransport.assembleDeploymentZip([
        {
          filePath: 'force-app/main/default/objects/Support_Ticket__c/fields/Status__c.field-meta.xml',
          metadataType: 'CustomField',
          content: '<CustomField><fullName>Status__c</fullName><type>Text Area</type></CustomField>'
        }
      ]),
      /Unsupported custom field type "Text Area"/
    );
  });

  it('does not reject destructiveChanges.xml manifests (DELETE_CUSTOM_FIELD)', () => {
    const buffer = metadataTransport.assembleDeploymentZip([
      {
        filePath: 'force-app/main/default/destructiveChanges.xml',
        metadataType: 'CustomField',
        fullName: 'Support_Ticket__c.Status__c',
        content: `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>Support_Ticket__c.Status__c</members>
    <name>CustomField</name>
  </types>
  <version>61.0</version>
</Package>`
      }
    ]);

    const zip = new AdmZip(buffer);
    assert.ok(zip.getEntries().some(e => e.entryName === 'destructiveChanges.xml'));
    const packageXml = zip.readAsText('package.xml');
    assert.match(packageXml, /<members>Support_Ticket__c\.Status__c<\/members>/);
  });
  
  it('escapes XML characters in package.xml', () => {
    const buffer = metadataTransport.assembleDeploymentZip([
      {
        filePath: 'force-app/main/default/classes/MyService.cls',
        metadataType: 'ApexClass',
        content: 'public class MyService {}',
        fullName: 'Evil&<Name'
      }
    ]);
    
    const zip = new AdmZip(buffer);
    const packageXml = zip.readAsText('package.xml');
    assert.match(packageXml, /<members>Evil&amp;&lt;Name<\/members>/);
  });
});
