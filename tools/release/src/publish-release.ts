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

import { join } from 'path';
import { green, bold, red, italic, yellow } from 'chalk';
import { Version, parseVersionName } from './parse-version';
import { shouldRelease } from './release-check';
import { CHANGELOG_FILE_NAME } from './changelog';
import { extractReleaseNotes, ReleaseNotes } from './extract-release-notes';
import { verifyPublishBranch } from './publish-branch';
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from './git/github-urls';
import { promises as fs } from 'fs';
import { npmPublish } from './npm/npm-client';
import { BaseReleaseTask } from './base-release';

const BUNDLE_PATH = 'dist/release';

/**
 * Class that can be instantiated in order to create a new release. The tasks requires user
 * interaction/input through command line prompts.
 */
class PublishReleaseTask extends BaseReleaseTask {
  /** Path to the release output of the project. */
  releaseOutputPath: string;

  constructor(public projectDir: string) {
    super(projectDir);
  }

  async run(): Promise<void> {
    console.log();
    console.log(green('-----------------------------------------'));
    console.log(green(bold('  Dynatrace Barista components release script')));
    console.log(green('-----------------------------------------'));
    console.log();

    // determine version
    const version = await this.determineVersion();

    // verify if we should release
    if (!shouldRelease(this.git, version)) {
      console.error(
        red('We are not on a valid release branch -- aborting release'),
      );
      process.exit(1);
      return;
    }

    // check that the build was successful
    await this.verifyGithubStatus();

    // verify uncommited changes
    this.verifyNoUncommittedChanges();

    // verify publish branch
    verifyPublishBranch(version, this.git);

    // get last commit from branch
    this.verifyLocalCommitsMatchUpstream(this.git.getCurrentBranch());

    // request build id for commit on remote

    // download artifact from circle

    // check release bundle (verify version in package.json)
    this.verifyBundle(version);

    // extract release notes
    const releaseNotes = extractReleaseNotes(
      CHANGELOG_FILE_NAME,
      version.format(),
    );
    const tagName = version.format();
    // create release tag
    this.createReleaseTag(tagName, releaseNotes);

    // push release tag to github
    this.pushReleaseTag(tagName);

    // safety net - confirm publish again
    await this._promptConfirmReleasePublish();

    // confirm npm publish
    publishPackageToNpm('DUMMY_PATH');

    console.log(green(bold(`  ✓   Published successfully`)));

    // publish TADA!🥳
  }

  private async determineVersion(): Promise<Version> {
    const packageJsonPath = join(this.projectDir, 'package.json');

    let parsedVersion;

    const packageJson = await tryJsonParse<PackageJson>(packageJsonPath);

    parsedVersion = parseVersionName(packageJson.version);
    if (!parsedVersion) {
      throw new Error(
        `Cannot parse current version in ${italic('package.json')}. Please ` +
          `make sure "${this.packageJson.version}" is a valid Semver version.`,
      );
    }
    return parsedVersion;
  }

  private async verifyGithubStatus(): Promise<void> {
    const commitSha = this.git.getLocalCommitSha('HEAD');
    const { state } = (await this.githubApi.repos.getCombinedStatusForRef({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      ref: commitSha,
    })).data;
    if (state !== 'success') {
      console.error(
        red(
          `The commit "${commitSha}" did not pass all github checks! Aborting...`,
        ),
      );
      process.exit(1);
    }
  }

  private async verifyBundle(version: Version): Promise<void> {
    const bundlePath = join(this.projectDir, BUNDLE_PATH);
    const bundleName = `barista-components-${version.format()}.tar`;

    // TODO untar
    const bundlePackageJson = await tryJsonParse<PackageJson>(
      join(bundlePath, bundleName, 'package.json'),
    );
    const parsedBundleVersion = parseVersionName(bundlePackageJson.version);
    if (!parsedBundleVersion || !parsedBundleVersion.equals(version)) {
      console.error(
        red(
          '  ✘ We detected a mismatch between the version in the package.json from the artifact' +
            'and the version in your current branch. Make sure that the downloaed artifact is the correct one.',
        ),
      );
      process.exit(1);
    }
  }

  private createReleaseTag(tagName: string, releaseNotes: ReleaseNotes): void {
    if (this.git.hasLocalTag(tagName)) {
      const expectedSha = this.git.getLocalCommitSha('HEAD');

      if (this.git.getShaOfLocalTag(tagName) !== expectedSha) {
        console.error(
          red(
            `  ✘   Tag "${tagName}" already exists locally, but does not refer ` +
              `to the version bump commit. Please delete the tag if you want to proceed.`,
          ),
        );
        process.exit(1);
      }

      console.log(
        green(`  ✓   Release tag already exists: "${italic(tagName)}"`),
      );
    } else if (this.git.createTag(tagName, releaseNotes.releaseTitle)) {
      console.log(green(`  ✓   Created release tag: "${italic(tagName)}"`));
    } else {
      console.error(
        red(
          `  ✘   Could not create the "${tagName}" tag.` +
            '    Please make sure there is no existing tag with the same name.',
        ),
      );
      process.exit(1);
    }
  }

  /** Pushes the release tag to the remote repository. */
  private pushReleaseTag(tagName: string): void {
    const remoteTagSha = this.git.getRemoteCommitSha(tagName);
    const expectedSha = this.git.getLocalCommitSha('HEAD');

    // The remote tag SHA is empty if the tag does not exist in the remote repository.
    if (remoteTagSha) {
      if (remoteTagSha !== expectedSha) {
        console.error(
          red(
            `  ✘   Tag "${tagName}" already exists on the remote, but does not ` +
              `refer to the version bump commit.`,
          ),
        );
        process.exit(1);
      }

      console.log(
        green(
          `  ✓   Release tag already exists remotely: "${italic(tagName)}"`,
        ),
      );
      return;
    }

    if (!this.git.pushBranchOrTagToRemote(tagName)) {
      console.error(red(`  ✘   Could not push the "${tagName}" tag upstream.`));
      process.exit(1);
    }

    console.log(green(`  ✓   Pushed release tag upstream.`));
  }

  /**
   * Prompts the user whether he is sure that the script should continue publishing
   * the release to NPM.
   */
  private async _promptConfirmReleasePublish(): Promise<void> {
    if (
      !(await this._promptConfirm('Are you sure that you want to release now?'))
    ) {
      console.log();
      console.log(yellow('Aborting publish...'));
      process.exit(0);
    }
  }
}

/** Publishes the specified package. */
function publishPackageToNpm(bundlePath: string): void {
  console.info(green('  📦   Publishing barista-components..'));

  const errorOutput = npmPublish(bundlePath);

  if (errorOutput) {
    throw new Error(
      red(`  ✘   An error occurred while publishing barista-components.`),
    );
  }

  console.info(green('  ✓   Successfully published'));
}

/** Entry-point for the create release script. */
if (require.main === module) {
  new PublishReleaseTask(join(__dirname, '../../')).run();
}

/** Tries to parse a json file and throws an error if parsing fails */
async function tryJsonParse<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path, { encoding: 'utf-8' }));
  } catch (err) {
    throw new Error(`Error while parsing json file at ${path}`);
  }
}

export interface PackageJson {
  version: string;
  peerDependencies: {
    [key: string]: string;
  };
  dependencies: {
    [key: string]: string;
  };
}
