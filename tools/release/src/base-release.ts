/**
 * @license
 * Copyright 2019 Dynatrace LLC
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { red, italic, green } from 'chalk';
import { GitClient } from './git/git-client';
import * as OctokitApi from '@octokit/rest';
import {
  GITHUB_REPO_OWNER,
  getGithubBranchCommitsUrl,
  GITHUB_REPO_NAME,
} from './git/github-urls';
import { prompt } from 'inquirer';

interface PackageJson {
  version: string;
}

export class BaseReleaseTask {
  /** Serialized package.json of the specified project. */
  packageJson: PackageJson;

  /** Instance of a wrapper that can execute Git commands. */
  git: GitClient;

  /** Octokit API instance that can be used to make Github API calls. */
  githubApi: OctokitApi = new OctokitApi();

  constructor(public projectDir: string) {
    this.git = new GitClient(projectDir);
  }

  /** Verifies that there are no uncommitted changes in the project. */
  protected verifyNoUncommittedChanges(): void {
    if (this.git.hasUncommittedChanges()) {
      console.error(
        red(
          `  ✘ Cannot stage release. ` +
            `There are changes which are not committed and should be stashed.`,
        ),
      );
      process.exit(1);
    }
  }

  /**
   * Verifies that the local branch is up to date with the given publish branch.
   */
  protected verifyLocalCommitsMatchUpstream(publishBranch: string): void {
    const upstreamCommitSha = this.git.getRemoteCommitSha(publishBranch);
    const localCommitSha = this.git.getLocalCommitSha('HEAD');
    // Check if the current branch is in sync with the remote branch.
    if (upstreamCommitSha !== localCommitSha) {
      console.error(
        red(
          `  ✘ The current branch is not in sync with ` +
            `the remote branch. Please make sure your local branch "${italic(
              publishBranch,
            )}" is up ` +
            `to date.`,
        ),
      );
      process.exit(1);
    }
  }

  /** Verifies that the latest commit of the current branch is passing all Github statuses. */
  protected async _verifyPassingGithubStatus(
    branchName: string,
  ): Promise<void> {
    const commitRef = this.git.getLocalCommitSha('HEAD');
    const githubCommitsUrl = getGithubBranchCommitsUrl(
      GITHUB_REPO_OWNER,
      GITHUB_REPO_NAME,
      branchName,
    );
    const { state } = (await this.githubApi.repos.getCombinedStatusForRef({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      ref: commitRef,
    })).data;

    if (state === 'failure') {
      console.error(
        red(
          `  ✘   Cannot stage release. Commit "${commitRef}" does not pass all github ` +
            `status checks. Please make sure this commit passes all checks before re-running.`,
        ),
      );
      console.error(red(`      Please have a look at: ${githubCommitsUrl}`));

      if (
        await this._promptConfirm(
          'Do you want to ignore the Github status and proceed?',
        )
      ) {
        console.info(
          green(
            `  ⚠   Upstream commit is failing CI checks, but status has been ` +
              `forcibly ignored.`,
          ),
        );
        return;
      }
      process.exit(1);
    } else if (state === 'pending') {
      console.error(
        red(
          `  ✘   Commit "${commitRef}" still has pending github statuses that ` +
            `need to succeed before staging a release.`,
        ),
      );
      console.error(red(`      Please have a look at: ${githubCommitsUrl}`));

      if (
        await this._promptConfirm(
          'Do you want to ignore the Github status and proceed?',
        )
      ) {
        console.info(
          green(
            `  ⚠   Upstream commit is pending CI, but status has been ` +
              `forcibly ignored.`,
          ),
        );
        return;
      }
      process.exit(0);
    }

    console.info(
      green(`  ✓   Upstream commit is passing all github status checks.`),
    );
  }

  /** Prompts the user with a confirmation question and a specified message. */
  protected async _promptConfirm(message: string): Promise<boolean> {
    return (await prompt<{ result: boolean }>({
      type: 'confirm',
      name: 'result',
      message: message,
    })).result;
  }
}
