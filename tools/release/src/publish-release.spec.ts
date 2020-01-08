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

import { vol } from 'memfs';

import { GitClient } from './git/git-client';
import * as OctokitApi from '@octokit/rest';
import {
  PackageJson,
  determineVersion,
  verifyGithubStatus,
  verifyLocalCommitsMatchUpstream,
} from './publish-release';
import {
  GET_INVALID_PACKAGE_JSON_VERSION_ERROR,
  GET_UNSUCCESSFUL_GITHUB_STATUS_ERROR,
  GET_LOCAL_DOES_NOT_MATCH_UPSTREAM,
  CHANGELOG_PARSE_ERROR,
} from './release-errors';
import { getFixture } from './testing/get-fixture';
import { shouldRelease } from './release-check';
import { Version } from './parse-version';
import { extractReleaseNotes } from './extract-release-notes';

beforeEach(() => {
  process.chdir('/');
  vol.reset();
});

afterEach(() => {
  jest.clearAllMocks();
});

test('Should throw an error when no package.json is found', async () => {
  expect.assertions(1);
  try {
    await determineVersion(process.cwd());
  } catch (err) {
    expect(err.message).toBe('Error while parsing json file at /package.json');
  }
});

test('Should throw an error if the package.json contains an invalid version', async () => {
  const packageJson: PackageJson = { version: 'x.x.x' };
  vol.fromJSON({
    '/package.json': JSON.stringify(packageJson),
  });

  expect.assertions(1);

  try {
    await determineVersion(process.cwd());
  } catch (err) {
    expect(err.message).toBe(
      GET_INVALID_PACKAGE_JSON_VERSION_ERROR(packageJson),
    );
  }
});

test('Should return false if branch is not a valid release branch', async () => {
  jest
    .spyOn(GitClient.prototype, 'getCurrentBranch')
    .mockImplementation(() => 'some-branch');

  jest
    .spyOn(GitClient.prototype, 'getLastCommit')
    .mockImplementation(() => '1234');

  expect(
    shouldRelease(new GitClient(process.cwd()), new Version(4, 15, 3)),
  ).toBe(false);
});

test('Should throw an error when the github status is not successful', async () => {
  const localCommitSha = '1234';
  jest
    .spyOn(GitClient.prototype, 'getLocalCommitSha')
    .mockImplementation(() => localCommitSha);

  const errorResponse = {
    data: { state: 'error' },
  } as OctokitApi.Response<OctokitApi.ReposGetCombinedStatusForRefResponse>;

  const octokitApi = new OctokitApi();
  jest
    .spyOn(octokitApi.repos, 'getCombinedStatusForRef')
    .mockImplementation(() => Promise.resolve(errorResponse));

  expect.assertions(1);

  try {
    await verifyGithubStatus(new GitClient(process.cwd()), octokitApi);
  } catch (err) {
    expect(err.message).toBe(
      GET_UNSUCCESSFUL_GITHUB_STATUS_ERROR(localCommitSha),
    );
  }
});

test('Should throw an error when the local branch does not match the upstream', async () => {
  jest
    .spyOn(GitClient.prototype, 'getRemoteCommitSha')
    .mockImplementation(() => 'xxxx');

  jest
    .spyOn(GitClient.prototype, 'getLocalCommitSha')
    .mockImplementation(() => '1234');

  const localBranch = 'master';

  expect.assertions(1);
  try {
    verifyLocalCommitsMatchUpstream(new GitClient(process.cwd()), localBranch);
  } catch (err) {
    expect(err.message).toBe(GET_LOCAL_DOES_NOT_MATCH_UPSTREAM(localBranch));
  }
});

test('Should throw an error when the changelog could not be parsed for the release notes', async () => {
  vol.fromJSON({
    'CHANGELOG.md': getFixture('CHANGELOG-invalid.md'),
  });
  expect.assertions(1);

  try {
    extractReleaseNotes('CHANGELOG.md', '4.15.1');
  } catch (err) {
    expect(err.message).toBe(CHANGELOG_PARSE_ERROR);
  }
});
