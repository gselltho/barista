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

import { italic } from 'chalk';

export const NO_TOKENS_PROVIDED_ERROR = `Please ensure that you provide the CIRCLE_CI_TOKEN and the NPM_PUBLISH_TOKEN for the script`;

export const GET_INVALID_PACKAGE_JSON_VERSION_ERROR = packageJson =>
  `Cannot parse current version in ${italic('package.json')}. Please ` +
  `make sure "${packageJson.version}" is a valid Semver version.`;

export const GET_UNSUCCESSFUL_GITHUB_STATUS_ERROR = (commitSha: string) =>
  `The commit "${commitSha}" did not pass all github checks! Aborting...`;

export const GET_LOCAL_DOES_NOT_MATCH_UPSTREAM = (publishBranch: string) =>
  `  ✘ The current branch is not in sync with ` +
  `the remote branch. Please make sure your local branch "${italic(
    publishBranch,
  )}" is up to date.`;

export const NO_VALID_RELEASE_BRANCH_ERROR =
  'We are not on a valid release branch -- aborting release';

export const UNCOMMITED_CHANGES_ERROR =
  'There are changes which are not committed and should be stashed.';

export const CHANGELOG_PARSE_ERROR =
  '  ✘   Could not find release notes in the changelog.';

export const GET_LOCAL_TAG_EXISTS_BUT_NO_BUMP_ERROR = (tagName: string) =>
  `  ✘   Tag "${tagName}" already exists locally, but does not refer ` +
  `to the version bump commit. Please delete the tag if you want to proceed.`;

export const GET_TAG_ALREADY_EXISTS = (tagName: string) =>
  `  ✘   Could not create the "${tagName}" tag.` +
  '    Please make sure there is no existing tag with the same name.';

export const GET_TAG_ALREADY_EXISTS_ON_REMOTE = (tagName: string) =>
  `  ✘   Tag "${tagName}" already exists on the remote, but does not ` +
  `refer to the version bump commit.`;

export const GET_TAG_PUSH_ERROR = (tagName: string) =>
  `  ✘   Could not push the "${tagName}" tag upstream.`;

export const BUNDLE_VERSION_ERROR =
  '  ✘ We detected a mismatch between the version in the package.json from the artifact' +
  'and the version in your current branch. Make sure that the downloaed artifact is the correct one.';
