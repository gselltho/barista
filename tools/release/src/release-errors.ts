import { PackageJson } from './publish-release';
import { italic } from 'chalk';

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

export function getInvalidPackageJsonVersionError(
  packageJson: PackageJson,
): Error {
  return Error(
    `Cannot parse current version in ${italic('package.json')}. Please ` +
      `make sure "${packageJson.version}" is a valid Semver version.`,
  );
}

export function getUnsucessfulGithubStatusError(commitSha: string): Error {
  return Error(
    `The commit "${commitSha}" did not pass all github checks! Aborting...`,
  );
}

export function getLocalDoesNotMatchUpstreamError(
  publishBranch: string,
): Error {
  return Error(
    `  ✘ The current branch is not in sync with ` +
      `the remote branch. Please make sure your local branch "${italic(
        publishBranch,
      )}" is up to date.`,
  );
}

export const NO_VALID_RELEASE_BRANCH_MSG =
  'We are not on a valid release branch -- aborting release';

export const UNCOMMITED_CHANGES_ERROR_MSG =
  'There are changes which are not committed and should be stashed.';

export const CHANGELOG_PARSE_ERROR_MSG =
  '  ✘   Could not find release notes in the changelog.';

export function getLocalTagAlreadyExistsButDoesNotMatchError(
  tagName: string,
): Error {
  return Error(
    `  ✘   Tag "${tagName}" already exists locally, but does not refer ` +
      `to the version bump commit. Please delete the tag if you want to proceed.`,
  );
}

export function getTagAlreadyExistsError(tagName: string): Error {
  return Error(
    `  ✘   Could not create the "${tagName}" tag.` +
      '    Please make sure there is no existing tag with the same name.',
  );
}

export function getTagAlreadyExistsOnRemoteError(tagName: string): Error {
  return Error(
    `  ✘   Tag "${tagName}" already exists on the remote, but does not ` +
      `refer to the version bump commit.`,
  );
}

export function getTagPushError(tagName: string): Error {
  return Error(`  ✘   Could not push the "${tagName}" tag upstream.`);
}

export const BUNDLE_VERSION_ERROR_MSG =
  '  ✘ We detected a mismatch between the version in the package.json from the artifact' +
  'and the version in your current branch. Make sure that the downloaed artifact is the correct one.';
