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

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { bold, cyan, green, italic, red, yellow } from 'chalk';

import { promptAndGenerateChangelog, CHANGELOG_FILE_NAME } from './changelog';
import { getReleaseCommit } from './release-check';
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from './git/github-urls';
import { promptForNewVersion } from './new-version-prompt';
import { Version, parseVersionName } from './parse-version';
import { getAllowedPublishBranch } from './publish-branch';
import { BaseReleaseTask } from './base-release';

class StageReleaseTask extends BaseReleaseTask {
  /** Path to the project package JSON. */
  packageJsonPath: string;

  /** Parsed current version of the project. */
  currentVersion: Version;

  constructor(public projectDir: string) {
    super(projectDir);

    this.packageJsonPath = join(projectDir, 'package.json');

    if (!existsSync(this.packageJsonPath)) {
      console.error(
        red(
          `The specified directory is not referring to a project directory. ` +
            `There must be a ${italic(
              'package.json',
            )} file in the project directory.`,
        ),
      );
      process.exit(1);
    }

    this.packageJson = JSON.parse(readFileSync(this.packageJsonPath, 'utf-8'));
    this.currentVersion = parseVersionName(this.packageJson.version)!;

    if (!this.currentVersion) {
      console.error(
        red(
          `Cannot parse current version in ${italic('package.json')}. Please ` +
            `make sure "${this.packageJson.version}" is a valid ` +
            `Semver version.`,
        ),
      );
      process.exit(1);
    }
  }

  async run(): Promise<void> {
    console.log();
    console.log(cyan('-----------------------------------------------------'));
    console.log(cyan('  Dynatrace Barista Components stage release script'));
    console.log(cyan('-----------------------------------------------------'));
    console.log();

    const newVersion = await promptForNewVersion(this.currentVersion);
    const newVersionName = newVersion.format();
    const needsVersionBump = !newVersion.equals(this.currentVersion);
    const stagingBranch = `release-stage/${newVersionName}`;

    console.log();

    this.verifyNoUncommittedChanges();

    // Branch that will be used to stage the release for the
    // new selected version.
    const publishBranch = this._switchToPublishBranch(newVersion);

    this.verifyLocalCommitsMatchUpstream(publishBranch);
    await this._verifyPassingGithubStatus(publishBranch);

    if (!this.git.checkoutNewBranch(stagingBranch)) {
      console.error(
        red(
          `Could not create release staging branch: ${stagingBranch}. ` +
            `Aborting...`,
        ),
      );
      process.exit(1);
    }

    if (needsVersionBump) {
      this.updatePackageJsonVersion(newVersionName);

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
      join(this.projectDir, CHANGELOG_FILE_NAME),
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
      !(await this._promptConfirm(
        'Do you want to proceed and commit the changes?',
      ))
    ) {
      console.log();
      console.log(yellow('Aborting release staging...'));
      process.exit(1);
    }

    this.git.stageAllChanges();

    if (needsVersionBump) {
      this.git.createNewCommit(getReleaseCommit(newVersionName));
    } else {
      this.git.createNewCommit(`chore: Update changelog for ${newVersionName}`);
    }

    console.info();
    console.info(
      green(`  ✓   Created the staging commit for: "${newVersionName}".`),
    );
    console.info();

    // Pushing
    if (!this.git.pushBranchOrTagToRemote(stagingBranch)) {
      console.error(
        red(
          `Could not push release staging branch "${stagingBranch}" to remote`,
        ),
      );
      process.exit(1);
    }
    console.info(
      green(
        `  ✓   Pushed release staging branch "${stagingBranch}" to remote.`,
      ),
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
      console.error(
        red(
          `Could not push create a pull-request for release staging branch "${stagingBranch}"` +
            `Please create the pull-request named "${prTitle}" by hand.`,
        ),
      );
      process.exit(1);
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
  private _switchToPublishBranch(newVersion: Version): string {
    const allowedBranch = getAllowedPublishBranch(newVersion);
    const currentBranchName = this.git.getCurrentBranch();

    // If current branch already matches one of the allowed publish branches,
    // just continue by exiting this function and returning the currently
    // used publish branch.
    if (allowedBranch === currentBranchName) {
      console.log(
        green(`  ✓   Using the "${italic(currentBranchName)}" branch.`),
      );
      return currentBranchName;
    } else {
      if (!this.git.checkoutBranch(allowedBranch)) {
        console.error(
          red(
            `  ✘   Could not switch to the "${italic(allowedBranch)}" ` +
              `branch.`,
          ),
        );
        console.error(
          red(
            `      Please ensure that the branch exists or manually switch ` +
              `to the branch.`,
          ),
        );
        process.exit(1);
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
  private updatePackageJsonVersion(newVersionName: string): void {
    const newPackageJson = { ...this.packageJson, version: newVersionName };
    writeFileSync(
      this.packageJsonPath,
      `${JSON.stringify(newPackageJson, null, 2)}\n`,
    );
  }
}

/** Entry-point for the release staging script. */
if (require.main === module) {
  new StageReleaseTask(join(__dirname, '../../../')).run();
}
