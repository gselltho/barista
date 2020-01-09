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
import { green, bold, red } from 'chalk';
import { Version, parseVersionName } from './parse-version';
import { shouldRelease } from './release-check';
import { CHANGELOG_FILE_NAME } from './changelog';
import { extractReleaseNotes } from './extract-release-notes';
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from './git/github-urls';
import { npmPublish } from './npm/npm-client';
import { CircleCiApi } from './circle-ci-api/circle-ci-api';
import {
  NO_VALID_RELEASE_BRANCH_ERROR,
  UNCOMMITED_CHANGES_ERROR,
  GET_INVALID_PACKAGE_JSON_VERSION_ERROR,
  GET_UNSUCCESSFUL_GITHUB_STATUS_ERROR,
  GET_LOCAL_DOES_NOT_MATCH_UPSTREAM,
  BUNDLE_VERSION_ERROR,
} from './release-errors';
import { GitClient } from './git/git-client';
import * as OctokitApi from '@octokit/rest';
import { createReleaseTag, pushReleaseTag } from './tagging';
import { promptConfirmReleasePublish } from './prompts';
import { downloadFile, extractTarFile } from './file-operations';
import { tryJsonParse, PackageJson } from '../../util/json-utils';

const TAR_DESTINATION = resolve(process.cwd(), 'tmp');
const BUNDLE_NAME = 'barista-components.tar.gz';

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
  await downloadFile(TAR_DESTINATION, circleArtitfact[0].url);
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

/**
 * Verifies that there are no uncommited changes
 * @throws Will throw an error if there are uncommited changes
 */
function verifyNoUncommittedChanges(git: GitClient): void {
  if (git.hasUncommittedChanges()) {
    throw new Error(UNCOMMITED_CHANGES_ERROR);
  }
}

/**
 * Reads the package json in the given baseDir
 * and tries to parse the version as a semantic version
 * @throws Will throw if no package.json is found or the version cannot be parsed
 */
export async function determineVersion(baseDir: string): Promise<Version> {
  const packageJsonPath = join(baseDir, 'package.json');

  let parsedVersion;

  const packageJson = await tryJsonParse<PackageJson>(packageJsonPath);

  parsedVersion = parseVersionName(packageJson.version);
  if (!parsedVersion) {
    throw new Error(GET_INVALID_PACKAGE_JSON_VERSION_ERROR(packageJson));
  }
  return parsedVersion;
}

/**
 * Verifies that the github status for the latest local commit passed
 * @throws Will throw if the state is not successful
 */
export async function verifyGithubStatus(
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

/**
 * Verifies that all commits have been pushed to the upstream
 * @throws Will throw an error if the local commit does not match the latest
 * upstream commit
 */
export function verifyLocalCommitsMatchUpstream(
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

/**
 * Checks whether the version in the package.json in the
 * given path matches the version given.
 */
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

/**
 * Publishes the specified package.
 * @throws Will throw if an error occurs during publishing
 */
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

/** Entry-point for the create release script. */
if (require.main === module) {
  publishRelease(join(__dirname, '../../'))
    .then()
    .catch(error => {
      console.log(red(error));
      process.exit(0);
    });
}
