import { App } from 'octokit';
import dotenv from 'dotenv';

dotenv.config();

class GithubService {
  constructor() {
    this.appId = process.env.GITHUB_APP_ID;
    this.privateKey = process.env.GITHUB_PRIVATE_KEY;
    this.appSlug = process.env.GITHUB_APP_SLUG || 'orgforge-audit-logger';
    
    if (this.appId && this.privateKey) {
      this.app = new App({
        appId: this.appId,
        privateKey: this.privateKey,
      });
    }
  }

  isConfigured() {
    return Boolean(this.app);
  }

  /**
   * Public installation URL for the GitHub App. The operator opens this to
   * install the OrgForge Audit Logger on their repo(s).
   */
  getInstallUrl() {
    return `https://github.com/apps/${this.appSlug}/installations/new`;
  }

  /**
   * List the repositories the given installation has granted this app access
   * to. Used so the operator can pick which repo receives the audit trail.
   */
  async listReposForInstallation(installationId) {
    if (!this.app) throw new Error('GitHub App is not configured in .env');
    const octokit = await this.app.getInstallationOctokit(installationId);
    // Installation tokens MUST use GET /installation/repositories (octokit
    // method listReposAccessibleToInstallation). The user-scoped variant
    // (listInstallationReposForAuthenticatedUser) requires a user-to-server
    // OAuth token AND the installation_id path parameter — with an
    // installation token it always throws (missing required parameter / 404),
    // which would break the repo-picker and connect flow entirely.
    // Ask for the max page size so an installation granting more than the
    // 30-repo default doesn't truncate the picker — and so /connect's repo
    // verification (repos.some) doesn't 403 on a granted repo beyond page 1.
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({ per_page: 100 });
    const repos = data.repositories || [];
    return repos.map((r) => ({ owner: r.owner?.login || r.owner?.name, name: r.name }));
  }

  async pushChangeRecord(installationId, repoOwner, repoName, fileName, content) {
    if (!this.app) {
      console.warn('GitHub App is not configured in .env. Skipping audit log push to GitHub.');
      return null;
    }

    try {
      const octokit = await this.app.getInstallationOctokit(installationId);
      
      const contentEncoded = Buffer.from(content).toString('base64');
      
      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner: repoOwner,
        repo: repoName,
        path: `orgforge-changes/${fileName}`,
        message: `Audit Log: ${fileName}`,
        content: contentEncoded,
        committer: {
          name: 'OrgForge Audit Logger [bot]',
          email: 'audit@orgforge.enlightlab.com'
        },
        author: {
          name: 'OrgForge Audit Logger [bot]',
          email: 'audit@orgforge.enlightlab.com'
        }
      });
      
      return response.data.commit.sha;
    } catch (error) {
      console.error('Failed to push change record to GitHub:', error);
      throw error;
    }
  }
}

export const githubService = new GithubService();
