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

import {
  tryJsonParse,
  PackageJson,
} from '@dynatrace/barista-components/tools/shared';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { bold, cyan, green, italic, red, yellow } from 'chalk';
import * as OctokitApi from '@octokit/rest';

import { promptAndGenerateChangelog, CHANGELOG_FILE_NAME } from './changelog';
import { getReleaseCommit } from './release-check';
import {
  GitClient,
  verifyNoUncommittedChanges,
  verifyLocalCommitsMatchUpstream,
  GITHUB_REPO_OWNER,
  GITHUB_REPO_NAME,
  verifyPassingGithubStatus,
} from './git';
import { promptForNewVersion } from './new-version-prompt';
import { Version, determineVersion } from './parse-version';
import { getAllowedPublishBranch } from './publish-branch';
import { promptConfirm } from './prompts';
import {
  GET_FAILED_CREATE_STAGING_BRANCH_ERROR,
  ABORT_RELEASE,
  GET_BRANCH_SWITCH_ERROR,
  GET_PUSH_RELEASE_BRANCH_ERROR,
  GET_PR_CREATION_ERROR,
} from './release-errors';

/** The root of the barista git repo where the git commands should be executed */
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();

async function stageRelease(): Promise<void> {
  console.log();
  console.log(cyan('-----------------------------------------------------'));
  console.log(cyan('  Dynatrace Angular Components stage release script'));
  console.log(cyan('-----------------------------------------------------'));
  console.log();

  // Instance of a wrapper that can execute Git commands.
  const gitClient = new GitClient(WORKSPACE_ROOT);

  // Octokit API instance that can be used to make Github API calls.
  const githubApi = new OctokitApi();

  // determine version
  const currentVersion = await determineVersion(WORKSPACE_ROOT);
  const packageJsonPath = join(WORKSPACE_ROOT, 'package.json');
  const packageJson = await tryJsonParse<PackageJson>(packageJsonPath);

  const newVersion = await promptForNewVersion(currentVersion);
  const newVersionName = newVersion.format();
  const needsVersionBump = !newVersion.equals(currentVersion);
  const stagingBranch = `release-stage/${newVersionName}`;

  console.log();

  verifyNoUncommittedChanges(gitClient);

  // Branch that will be used to stage the release for the
  // new selected version.
  const publishBranch = switchToPublishBranch(gitClient, newVersion);

  verifyLocalCommitsMatchUpstream(gitClient, publishBranch);
  await verifyPassingGithubStatus(gitClient, githubApi, publishBranch);

  if (!gitClient.checkoutNewBranch(stagingBranch)) {
    throw new Error(GET_FAILED_CREATE_STAGING_BRANCH_ERROR(stagingBranch));
  }

  if (needsVersionBump) {
    updatePackageJsonVersion(packageJson, packageJsonPath, newVersionName);

    console.log(
      green(
        `  ✓   Updated the version to "${bold(
          newVersionName,
        )}" inside of the ${italic('package.json')}`,
      ),
    );
    console.log();
  }

  await promptAndGenerateChangelog(
    join(WORKSPACE_ROOT, CHANGELOG_FILE_NAME),
    '',
  );

  console.log();
  console.log(
    green(`  ✓   Updated the changelog in "${bold(CHANGELOG_FILE_NAME)}"`),
  );
  console.log(
    yellow(
      `  ⚠   Please review CHANGELOG.md and ensure that the log ` +
        `contains only changes that apply to the public library release. ` +
        `When done, proceed to the prompt below.`,
    ),
  );
  console.log();

  if (
    !(await promptConfirm('Do you want to proceed and commit the changes?'))
  ) {
    throw new Error(yellow(ABORT_RELEASE));
  }

  gitClient.stageAllChanges();

  if (needsVersionBump) {
    gitClient.createNewCommit(getReleaseCommit(newVersionName));
  } else {
    gitClient.createNewCommit(`chore: Update changelog for ${newVersionName}`);
  }

  console.info();
  console.info(
    green(`  ✓   Created the staging commit for: "${newVersionName}".`),
  );
  console.info();

  // Pushing
  if (!gitClient.pushBranchOrTagToRemote(stagingBranch)) {
    throw new Error(red(GET_PUSH_RELEASE_BRANCH_ERROR(stagingBranch)));
  }
  console.info(
    green(`  ✓   Pushed release staging branch "${stagingBranch}" to remote.`),
  );

  const prTitle = needsVersionBump
    ? 'Bump version to ${version} w/ changelog'
    : 'Update changelog for ${newVersionName}';
  const { state } = (await this.githubApi.pulls.create({
    title: prTitle,
    head: stagingBranch,
    base: 'master',
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
  })).data;

  if (state === 'failure') {
    throw new Error(red(GET_PR_CREATION_ERROR(stagingBranch, prTitle)));
  }
  console.info(
    green(
      `  ✓   Created the pull-request "${prTitle}" for the release staging branch "${stagingBranch}".`,
    ),
  );
}

/**
 * Checks if the user is on an allowed publish branch
 * for the specified version.
 */
function switchToPublishBranch(git: GitClient, newVersion: Version): string {
  const allowedBranch = getAllowedPublishBranch(newVersion);
  const currentBranchName = git.getCurrentBranch();

  // If current branch already matches one of the allowed publish branches,
  // just continue by exiting this function and returning the currently
  // used publish branch.
  if (allowedBranch === currentBranchName) {
    console.log(
      green(`  ✓   Using the "${italic(currentBranchName)}" branch.`),
    );
    return currentBranchName;
  } else {
    if (!git.checkoutBranch(allowedBranch)) {
      throw new Error(red(GET_BRANCH_SWITCH_ERROR(allowedBranch)));
    }

    console.log(
      green(`  ✓   Switched to the "${italic(allowedBranch)}" branch.`),
    );
  }
  return allowedBranch;
}

/**
 * Updates the version of the project package.json and
 * writes the changes to disk.
 */
function updatePackageJsonVersion(
  packageJson: PackageJson,
  packageJsonPath: string,
  newVersionName: string,
): void {
  const newPackageJson = { ...packageJson, version: newVersionName };
  writeFileSync(
    packageJsonPath,
    `${JSON.stringify(newPackageJson, null, 2)}\n`,
  );
}

/** Entry-point for the release staging script. */
if (require.main === module) {
  stageRelease()
    .then()
    .catch(error => {
      console.log(error);
      // deliberately set to 0 so we don't have the error stacktrace in the console
      process.exit(0);
    });
}
