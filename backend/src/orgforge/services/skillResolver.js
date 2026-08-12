import fs from 'fs';
import path from 'path';

class SkillResolver {
  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'data');
    this.skillsLockPath = path.join(this.dataDir, 'skills-lock.json');
    this.skillsRepoPath = path.join(this.dataDir, 'sf-skills', 'skills');
    
    this.lockData = null;
    this.loadLockData();
  }

  loadLockData() {
    try {
      if (fs.existsSync(this.skillsLockPath)) {
        const raw = fs.readFileSync(this.skillsLockPath, 'utf-8');
        this.lockData = JSON.parse(raw);
      }
    } catch (err) {
      console.error('Error loading skills-lock.json:', err);
    }
  }

  getSkillForOperation(operationType) {
    if (this.lockData && this.lockData.skills && this.lockData.skills[operationType]) {
      return this.lockData.skills[operationType];
    }
    // Full fallback map — covers all 24 whitelisted operations.
    // Used when skills-lock.json is absent (dev/CI environment) or the
    // entry for the requested operation is missing from the lock file.
    const fallbackMap = {
      // Validation Rules
      'CREATE_VALIDATION_RULE':  'platform-validation-rule-generate',
      'UPDATE_VALIDATION_RULE':  'platform-validation-rule-generate',
      'DELETE_VALIDATION_RULE':  'platform-metadata-deploy',
      // Custom Fields
      'CREATE_CUSTOM_FIELD':     'platform-custom-field-generate',
      'UPDATE_CUSTOM_FIELD':     'platform-custom-field-generate',
      'DELETE_CUSTOM_FIELD':     'platform-metadata-deploy',
      // Custom Objects
      'CREATE_CUSTOM_OBJECT':    'platform-custom-object-generate',
      'UPDATE_CUSTOM_OBJECT':    'platform-custom-object-generate',
      'DELETE_CUSTOM_OBJECT':    'platform-metadata-deploy',
      // Apex Classes
      'CREATE_APEX_CLASS':       'platform-apex-generate',
      'UPDATE_APEX_CLASS':       'platform-apex-generate',
      'DELETE_APEX_CLASS':       'platform-metadata-deploy',
      // Apex Triggers
      'CREATE_APEX_TRIGGER':     'platform-apex-generate',
      'UPDATE_APEX_TRIGGER':     'platform-apex-generate',
      'DELETE_APEX_TRIGGER':     'platform-metadata-deploy',
      // Permission Sets
      'CREATE_PERMISSION_SET':   'platform-permission-set-generate',
      'UPDATE_PERMISSION_SET':   'platform-permission-set-generate',
      'DELETE_PERMISSION_SET':   'platform-metadata-deploy',
      // Flows
      'CREATE_FLOW':             'automation-flow-generate',
      'UPDATE_FLOW':             'automation-flow-generate',
      'DELETE_FLOW':             'platform-metadata-deploy',
      // Custom Tabs
      'CREATE_CUSTOM_TAB':       'platform-custom-tab-generate',
      'UPDATE_CUSTOM_TAB':       'platform-custom-tab-generate',
      'DELETE_CUSTOM_TAB':       'platform-metadata-deploy',
      // Sharing Rules
      'CREATE_SHARING_RULE':     'platform-sharing-rules-generate',
      'UPDATE_SHARING_RULE':     'platform-sharing-rules-generate',
      'DELETE_SHARING_RULE':     'platform-metadata-deploy',
      // Record Types
      'CREATE_RECORD_TYPE':      'platform-custom-object-generate',
      'UPDATE_RECORD_TYPE':      'platform-custom-object-generate',
      'DELETE_RECORD_TYPE':      'platform-metadata-deploy',
      // List Views
      'CREATE_LIST_VIEW':        'platform-list-view-generate',
      'UPDATE_LIST_VIEW':        'platform-list-view-generate',
      'DELETE_LIST_VIEW':        'platform-metadata-deploy'
    };
    return fallbackMap[operationType] || 'platform-metadata-deploy';

  }

  resolveSkill(operationType) {
    const skillName = this.getSkillForOperation(operationType);
    const skillVersion = this.lockData && this.lockData.commit 
      ? `sha:${this.lockData.commit.substring(0, 7)}` 
      : 'v1.0.0-fallback';
      
    const skillPath = path.join(this.skillsRepoPath, skillName, 'SKILL.md');
    let content = `Instructions for ${skillName}...`;
    
    try {
      if (fs.existsSync(skillPath)) {
        content = fs.readFileSync(skillPath, 'utf-8');
      } else {
        console.warn(`Skill file not found at ${skillPath}`);
      }
    } catch (err) {
      console.error(`Error reading skill file ${skillPath}:`, err);
    }

    return {
      skillName,
      skillVersion,
      skillPath,
      content
    };
  }
}

export const skillResolver = new SkillResolver();
