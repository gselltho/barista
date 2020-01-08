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
import { green, bold, italic, yellow } from 'chalk';
import { Version, parseVersionName } from './parse-version';
import { shouldRelease } from './release-check';
import { CHANGELOG_FILE_NAME } from './changelog';
import { ReleaseNotes, extractReleaseNotes } from './extract-release-notes';
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from './git/github-urls';
import { promises as fs, createWriteStream, existsSync } from 'fs';
import { npmPublish } from './npm/npm-client';
import { CircleCiApi } from './circle-ci-api/circle-ci-api';
import Axios from 'axios';
import {
  NO_VALID_RELEASE_BRANCH_ERROR,
  UNCOMMITED_CHANGES_ERROR,
  GET_INVALID_PACKAGE_JSON_VERSION_ERROR,
  GET_UNSUCCESSFUL_GITHUB_STATUS_ERROR,
  GET_LOCAL_DOES_NOT_MATCH_UPSTREAM,
  BUNDLE_VERSION_ERROR,
  GET_LOCAL_TAG_EXISTS_BUT_NO_BUMP_ERROR,
  GET_TAG_ALREADY_EXISTS,
  GET_TAG_ALREADY_EXISTS_ON_REMOTE,
  GET_TAG_PUSH_ERROR,
} from './release-errors';
import { ExecOptions, exec } from 'child_process';
import { GitClient } from './git/git-client';
import * as OctokitApi from '@octokit/rest';
import { prompt } from 'inquirer';

const TAR_DESTINATION = resolve(process.cwd(), 'tmp');
const BUNDLE_NAME = 'barista-components.gz';

/**
 * The function to publish a release -
 * requires user interaction/input through command line prompts.
 */
export async function publishRelease(projectDir: string): Promise<void> {
  console.log();
  console.log(green('-----------------------------------------'));
  console.log(green(bold('  Dynatrace Barista components release script')));
  console.log(green('-----------------------------------------'));
  console.log();

  const circleCiApi: CircleCiApi = new CircleCiApi('my-token');
  /** Instance of a wrapper that can execute Git commands. */
  const gitClient: GitClient = new GitClient(projectDir);

  /** Octokit API instance that can be used to make Github API calls. */
  const githubApi = new OctokitApi();

  // determine version
  const version = await determineVersion(process.cwd());

  // verify if we should release
  if (!shouldRelease(gitClient, version)) {
    throw new Error(NO_VALID_RELEASE_BRANCH_ERROR);
  }

  // check that the build was successful
  await verifyGithubStatus(gitClient, githubApi);

  // verify uncommited changes
  verifyNoUncommittedChanges(gitClient);

  const currentBranch = gitClient.getCurrentBranch();

  // verify local commits match upstream
  verifyLocalCommitsMatchUpstream(gitClient, currentBranch);

  // request build id for commit on remote
  const circleArtitfact = await circleCiApi
    .getArtifactUrlForBranch(currentBranch)
    .toPromise();

  // download the tar file
  await downloadTarFile(TAR_DESTINATION, circleArtitfact[0].url);
  const extractedPath = join(TAR_DESTINATION, 'extracted');
  // extract tar file
  await extractTarFile(extractedPath, BUNDLE_NAME);

  // check release bundle (verify version in package.json)
  await verifyBundle(version, extractedPath);

  // extract release notes
  const releaseNotes = extractReleaseNotes(
    CHANGELOG_FILE_NAME,
    version.format(),
  );
  const tagName = version.format();
  // create release tag
  createReleaseTag(tagName, releaseNotes, gitClient);

  // push release tag to github
  pushReleaseTag(tagName, gitClient);

  // safety net - confirm publish again
  await promptConfirmReleasePublish();

  // confirm npm publish
  publishPackageToNpm('DUMMY_PATH');

  console.log(green(bold(`  ✓   Published successfully`)));

  // publish TADA!🥳
}

function verifyNoUncommittedChanges(git: GitClient): void {
  if (git.hasUncommittedChanges()) {
    throw new Error(UNCOMMITED_CHANGES_ERROR);
  }
}

async function determineVersion(baseDir: string): Promise<Version> {
  const packageJsonPath = join(baseDir, 'package.json');

  let parsedVersion;

  const packageJson = await tryJsonParse<PackageJson>(packageJsonPath);

  parsedVersion = parseVersionName(packageJson.version);
  if (!parsedVersion) {
    throw new Error(GET_INVALID_PACKAGE_JSON_VERSION_ERROR(packageJson));
  }
  return parsedVersion;
}

async function verifyGithubStatus(
  git: GitClient,
  githubApi: OctokitApi,
): Promise<void> {
  const commitSha = git.getLocalCommitSha('HEAD');
  const { state } = (await githubApi.repos.getCombinedStatusForRef({
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
    ref: commitSha,
  })).data;
  if (state !== 'success') {
    throw new Error(GET_UNSUCCESSFUL_GITHUB_STATUS_ERROR(commitSha));
  }
}

function verifyLocalCommitsMatchUpstream(
  git: GitClient,
  publishBranch: string,
): void {
  const upstreamCommitSha = git.getRemoteCommitSha(publishBranch);
  const localCommitSha = git.getLocalCommitSha('HEAD');
  // Check if the current branch is in sync with the remote branch.
  if (upstreamCommitSha !== localCommitSha) {
    throw new Error(GET_LOCAL_DOES_NOT_MATCH_UPSTREAM(publishBranch));
  }
}

async function downloadTarFile(
  destination: string,
  url: string,
): Promise<void> {
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

async function extractTarFile(
  destination: string,
  filePath: string,
  clearDestination: boolean = true,
): Promise<void> {
  if (existsSync(destination) && clearDestination) {
    await fs.rmdir(destination);
  }
  await fs.mkdir(destination, { recursive: true });
  await executeCommand(`tar -xzf ${filePath} -C ${destination}`);
}

async function verifyBundle(
  version: Version,
  bundlePath: string,
): Promise<void> {
  const bundlePackageJson = await tryJsonParse<PackageJson>(
    join(bundlePath, 'package.json'),
  );
  const parsedBundleVersion = parseVersionName(bundlePackageJson.version);
  if (!parsedBundleVersion || !parsedBundleVersion.equals(version)) {
    throw new Error(BUNDLE_VERSION_ERROR);
  }
}

function createReleaseTag(
  tagName: string,
  releaseNotes: ReleaseNotes,
  git: GitClient,
): void {
  if (git.hasLocalTag(tagName)) {
    const expectedSha = git.getLocalCommitSha('HEAD');

    if (git.getShaOfLocalTag(tagName) !== expectedSha) {
      throw new Error(GET_LOCAL_TAG_EXISTS_BUT_NO_BUMP_ERROR(tagName));
    }

    console.log(
      green(`  ✓   Release tag already exists: "${italic(tagName)}"`),
    );
  } else if (git.createTag(tagName, releaseNotes.releaseTitle)) {
    console.log(green(`  ✓   Created release tag: "${italic(tagName)}"`));
  } else {
    throw new Error(GET_TAG_ALREADY_EXISTS(tagName));
  }
}

/** Pushes the release tag to the remote repository. */
function pushReleaseTag(tagName: string, git: GitClient): void {
  const remoteTagSha = git.getRemoteCommitSha(tagName);
  const expectedSha = git.getLocalCommitSha('HEAD');

  // The remote tag SHA is empty if the tag does not exist in the remote repository.
  if (remoteTagSha) {
    if (remoteTagSha !== expectedSha) {
      throw new Error(GET_TAG_ALREADY_EXISTS_ON_REMOTE(tagName));
    }

    console.log(
      green(`  ✓   Release tag already exists remotely: "${italic(tagName)}"`),
    );
    return;
  }

  if (!git.pushBranchOrTagToRemote(tagName)) {
    throw new Error(GET_TAG_PUSH_ERROR(tagName));
  }

  console.log(green(`  ✓   Pushed release tag upstream.`));
}

/**
 * Prompts the user whether he is sure that the script should continue publishing
 * the release to NPM.
 */
async function promptConfirmReleasePublish(): Promise<void> {
  if (!(await promptConfirm('Are you sure that you want to release now?'))) {
    console.log();
    console.log(yellow('Aborting publish...'));
    process.exit(0);
  }
}

/** Prompts the user with a confirmation question and a specified message. */
async function promptConfirm(message: string): Promise<boolean> {
  return (await prompt<{ result: boolean }>({
    type: 'confirm',
    name: 'result',
    message: message,
  })).result;
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
  publishRelease(join(__dirname, '../../'))
    .then()
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
