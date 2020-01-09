/**
 * @license
 * Copyright 2020 Dynatrace LLC
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
  PackageJson,
  tryJsonParse,
} from '@dynatrace/barista-components/tools/shared';
import * as OctokitApi from '@octokit/rest';
import { bold, green, red } from 'chalk';
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { CHANGELOG_FILE_NAME } from './changelog';
import { CircleCiApi } from './circle-ci-api/circle-ci-api';
import { extractReleaseNotes } from './extract-release-notes';
import { downloadFile, extractTarFile } from './file-operations';
import { GitClient } from './git/git-client';
import { verifyGithubStatus } from './git/verify-github-status';
import { npmPublish } from './npm/npm-client';
import { parseVersionName, Version } from './parse-version';
import { promptConfirmReleasePublish } from './prompts';
import { shouldRelease } from './release-check';
import {
  BUNDLE_VERSION_ERROR,
  GET_INVALID_PACKAGE_JSON_VERSION_ERROR,
  GET_LOCAL_DOES_NOT_MATCH_UPSTREAM,
  NO_TOKENS_PROVIDED_ERROR,
  NO_VALID_RELEASE_BRANCH_ERROR,
  UNCOMMITED_CHANGES_ERROR,
} from './release-errors';
import { createReleaseTag, pushReleaseTag } from './tagging';

// load the environment variables from the .env file in your workspace
dotenvConfig();

/** The root of the barista git repo where the git commands should be executed */
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();

/** The temporary folder where the dist should be unpacked */
const TAR_DESTINATION = join(WORKSPACE_ROOT, 'tmp');
const BUNDLE_NAME = 'barista-components.tar.gz';

/**
 * The function to publish a release -
 * requires user interaction/input through command line prompts.
 */
export async function publishRelease(): Promise<void> {
  /** Private token for the circle ci */
  const CIRCLE_CI_TOKEN = process.env.CIRCLE_CI_TOKEN;
  /** Token to publish in the registry */
  const NPM_PUBLISH_TOKEN = process.env.NPM_PUBLISH_TOKEN;

  if (!CIRCLE_CI_TOKEN || !NPM_PUBLISH_TOKEN) {
    throw new Error(NO_TOKENS_PROVIDED_ERROR);
  }

  console.info();
  console.info(green('-----------------------------------------'));
  console.info(green(bold('  Dynatrace Barista components release script')));
  console.info(green('-----------------------------------------'));
  console.info();

  // The ci api to get the latest build artifacts
  const circleCiApi = new CircleCiApi(CIRCLE_CI_TOKEN);

  // Instance of a wrapper that can execute Git commands.
  const gitClient = new GitClient(WORKSPACE_ROOT);

  // Octokit API instance that can be used to make Github API calls.
  const githubApi = new OctokitApi();

  // TODO: fabian.friedl do we really have to check the workspace package version?
  // we are releasing only the downloaded dist -> this package.json we have to check

  // determine version
  const version = await determineVersion(WORKSPACE_ROOT);

  // verify if we should release
  if (!shouldRelease(gitClient, version)) {
    throw new Error(NO_VALID_RELEASE_BRANCH_ERROR);
  }

  // check that the build was successful
  await verifyGithubStatus(gitClient, githubApi);

  // verify un-commited changes
  verifyNoUncommittedChanges(gitClient);

  const currentBranch = gitClient.getCurrentBranch();

  // verify local commits match upstream
  verifyLocalCommitsMatchUpstream(gitClient, currentBranch);

  // request build id for commit on remote
  const circleArtitfact = await circleCiApi
    .getArtifactUrlForBranch(currentBranch)
    .toPromise();

  console.log(circleArtitfact);

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

  parsedVersion = parseVersionName(packageJson.version || '');
  if (!parsedVersion) {
    throw new Error(GET_INVALID_PACKAGE_JSON_VERSION_ERROR(packageJson));
  }
  return parsedVersion;
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
  const parsedBundleVersion = parseVersionName(bundlePackageJson.version || '');
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
  publishRelease()
    .then()
    .catch(error => {
      console.log(red(error));
      process.exit(0);
    });
}
