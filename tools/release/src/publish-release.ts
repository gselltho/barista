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

import { join, resolve } from 'path';
import { green, bold, red, italic, yellow } from 'chalk';
import { Version, parseVersionName } from './parse-version';
import { shouldRelease } from './release-check';
import { CHANGELOG_FILE_NAME } from './changelog';
import { ReleaseNotes, extractReleaseNotes } from './extract-release-notes';
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from './git/github-urls';
import {
  promises as fs,
  createReadStream,
  createWriteStream,
  readFile,
  readFileSync,
  writeFile,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { npmPublish } from './npm/npm-client';
import { BaseReleaseTask } from './base-release';
import { CircleCiApi } from './circle-ci-api/circle-ci-api';
import Axios from 'axios';
import {
  NO_VALID_RELEASE_BRANCH_MSG,
  getInvalidPackageJsonVersionError,
  getUnsucessfulGithubStatusError,
  getLocalTagAlreadyExistsButDoesNotMatchError,
  getTagAlreadyExistsError,
  getTagPushError,
  getTagAlreadyExistsOnRemoteError,
  BUNDLE_VERSION_ERROR_MSG,
} from './release-errors';
import { spawnSync, ExecOptions, exec } from 'child_process';

const BUNDLE_PATH = 'dist/release';

/**
 * Class that can be instantiated in order to create a new release. The tasks requires user
 * interaction/input through command line prompts.
 */
export class PublishReleaseTask extends BaseReleaseTask {
  /** Path to the release output of the project. */
  releaseOutputPath: string;

  circleCiApi: CircleCiApi = new CircleCiApi('my-token');

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
      throw new Error(NO_VALID_RELEASE_BRANCH_MSG);
    }

    // check that the build was successful
    await this.verifyGithubStatus();

    // verify uncommited changes
    this.verifyNoUncommittedChanges();

    const currentBranch = this.git.getCurrentBranch();

    // get last commit from branch
    this.verifyLocalCommitsMatchUpstream(currentBranch);

    // request build id for commit on remote
    const circleArtitfact = await this.circleCiApi
      .getArtifactUrlForBranch(currentBranch)
      .toPromise();

    // download artifact from circle
    await this._downloadTarFile(circleArtitfact[0].url);

    await this._extractTarFile();

    // check release bundle (verify version in package.json)
    this.verifyBundle(version, 'DUMMY_PATH');

    // extract release notes
    const releaseNotes = extractReleaseNotes(
      CHANGELOG_FILE_NAME,
      version.format(),
    );
    const tagName = version.format();
    // // create release tag
    this.createReleaseTag(tagName, releaseNotes);

    // // push release tag to github
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
      throw getInvalidPackageJsonVersionError(packageJson);
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
      throw getUnsucessfulGithubStatusError(commitSha);
    }
  }

  private async verifyBundle(
    version: Version,
    bundlePath: string,
  ): Promise<void> {
    const bundlePackageJson = await tryJsonParse<PackageJson>(
      join(bundlePath, 'package.json'),
    );
    const parsedBundleVersion = parseVersionName(bundlePackageJson.version);
    if (!parsedBundleVersion || !parsedBundleVersion.equals(version)) {
      throw new Error(BUNDLE_VERSION_ERROR_MSG);
    }
  }

  private createReleaseTag(tagName: string, releaseNotes: ReleaseNotes): void {
    if (this.git.hasLocalTag(tagName)) {
      const expectedSha = this.git.getLocalCommitSha('HEAD');

      if (this.git.getShaOfLocalTag(tagName) !== expectedSha) {
        throw getLocalTagAlreadyExistsButDoesNotMatchError(tagName);
      }

      console.log(
        green(`  ✓   Release tag already exists: "${italic(tagName)}"`),
      );
    } else if (this.git.createTag(tagName, releaseNotes.releaseTitle)) {
      console.log(green(`  ✓   Created release tag: "${italic(tagName)}"`));
    } else {
      throw getTagAlreadyExistsError(tagName);
    }
  }

  /** Pushes the release tag to the remote repository. */
  private pushReleaseTag(tagName: string): void {
    const remoteTagSha = this.git.getRemoteCommitSha(tagName);
    const expectedSha = this.git.getLocalCommitSha('HEAD');

    // The remote tag SHA is empty if the tag does not exist in the remote repository.
    if (remoteTagSha) {
      if (remoteTagSha !== expectedSha) {
        throw getTagAlreadyExistsOnRemoteError(tagName);
      }

      console.log(
        green(
          `  ✓   Release tag already exists remotely: "${italic(tagName)}"`,
        ),
      );
      return;
    }

    if (!this.git.pushBranchOrTagToRemote(tagName)) {
      throw getTagPushError(tagName);
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

  private async _downloadTarFile(url: string): Promise<void> {
    const destination = resolve(process.cwd(), 'dist');
    const writer = createWriteStream(destination);

    const response = await Axios({
      url,
      method: 'GET',
      responseType: 'stream',
    });

    response.data.pipe(writer);

    return new Promise((res, reject) => {
      writer.on('finish', res);
      writer.on('error', reject);
    });
  }

  private async _extractTarFile(): Promise<void> {
    await fs.mkdir(resolve(process.cwd(), 'tmp'), { recursive: true });
    await executeCommand(
      `tar -xzf ${resolve(
        process.cwd(),
        'dist',
        'barista-components.gz',
      )} -C tmp`,
    );
  }
}

/** Publishes the specified package. */
function publishPackageToNpm(bundlePath: string): void {
  console.info(green('  📦   Publishing barista-components..'));

  const errorOutput = npmPublish(bundlePath);

  if (errorOutput) {
    throw new Error(
      `  ✘   An error occurred while publishing barista-components.`,
    );
  }

  console.info(green('  ✓   Successfully published'));
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
  peerDependencies?: {
    [key: string]: string;
  };
  dependencies?: {
    [key: string]: string;
  };
}

/**
 * Spawns a shell then executes the command within that shell
 */
export async function executeCommand(
  command: string,
  cwd?: string,
): Promise<string> {
  const maxBuffer = 1024 * 1024 * 10;

  const options: ExecOptions = {
    cwd: cwd || process.cwd(),
    maxBuffer,
  };

  return new Promise((resolve, reject) => {
    exec(command, options, (err, stdout, stderr) => {
      if (err !== null) {
        reject(stdout);
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Entry-point for the create release script. */
if (require.main === module) {
  new PublishReleaseTask(join(__dirname, '../../'))
    .run()
    .then()
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
