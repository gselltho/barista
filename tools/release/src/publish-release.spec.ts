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
import { PublishReleaseTask, PackageJson } from './publish-release';
import {
  NO_VALID_RELEASE_BRANCH_MSG,
  getUnsucessfulGithubStatusError,
  getInvalidPackageJsonVersionError,
  UNCOMMITED_CHANGES_ERROR_MSG,
  getLocalDoesNotMatchUpstreamError,
  CHANGELOG_PARSE_ERROR_MSG,
} from './release-errors';
import { getFixture } from './testing/get-fixture';

let publishReleaseTask: PublishReleaseTask;

beforeEach(() => {
  process.chdir('/');
  vol.reset();
  publishReleaseTask = new PublishReleaseTask('.');
});

afterEach(() => {
  jest.clearAllMocks();
});

test('Should throw an error when no package.json is found', async () => {
  expect.assertions(1);

  try {
    await publishReleaseTask.run();
  } catch (err) {
    expect(err.message).toBe('Error while parsing json file at package.json');
  }
});

test('Should throw an error if the package.json contains an invalid version', async () => {
  const packageJson: PackageJson = { version: 'x.x.x' };
  vol.fromJSON({
    '/package.json': JSON.stringify(packageJson),
  });

  expect.assertions(1);

  try {
    await publishReleaseTask.run();
  } catch (err) {
    expect(err.message).toBe(
      getInvalidPackageJsonVersionError(packageJson).message,
    );
  }
});

test('Should throw an error if the branch is not a valid release branch', async () => {
  const packageJson: PackageJson = { version: '1.2.3' };
  vol.fromJSON({
    '/package.json': JSON.stringify(packageJson),
  });

  expect.assertions(1);

  jest
    .spyOn(GitClient.prototype, 'getCurrentBranch')
    .mockImplementation(() => 'some-branch');

  jest
    .spyOn(GitClient.prototype, 'getLastCommit')
    .mockImplementation(() => '1234');

  try {
    await publishReleaseTask.run();
  } catch (err) {
    expect(err.message).toBe(NO_VALID_RELEASE_BRANCH_MSG);
  }
});

test('Should throw an error when the github status is not sucessful', async () => {
  const packageJson: PackageJson = { version: '4.15.3' };
  vol.fromJSON({
    '/package.json': JSON.stringify(packageJson),
  });

  jest
    .spyOn(GitClient.prototype, 'getCurrentBranch')
    .mockImplementation(() => '4.15.x');

  jest
    .spyOn(GitClient.prototype, 'getLastCommit')
    .mockImplementation(() => 'chore: Bump version to 4.15.3 w/ changelog');

  const localCommitSha = '1234';
  jest
    .spyOn(GitClient.prototype, 'getLocalCommitSha')
    .mockImplementation(() => localCommitSha);

  const errorResponse = {
    data: { state: 'error' },
  } as OctokitApi.Response<OctokitApi.ReposGetCombinedStatusForRefResponse>;

  jest
    .spyOn(publishReleaseTask.githubApi.repos, 'getCombinedStatusForRef')
    .mockImplementation(() => Promise.resolve(errorResponse));

  expect.assertions(1);

  try {
    await publishReleaseTask.run();
  } catch (err) {
    expect(err.message).toBe(
      getUnsucessfulGithubStatusError(localCommitSha).message,
    );
  }
});

test('Should throw an error when uncommited changes are detected locally', async () => {
  const packageJson: PackageJson = { version: '4.15.3' };
  vol.fromJSON({
    '/package.json': JSON.stringify(packageJson),
  });

  jest
    .spyOn(GitClient.prototype, 'getCurrentBranch')
    .mockImplementation(() => '4.15.x');

  jest
    .spyOn(GitClient.prototype, 'getLastCommit')
    .mockImplementation(() => 'chore: Bump version to 4.15.3 w/ changelog');

  const localCommitSha = '1234';
  jest
    .spyOn(GitClient.prototype, 'getLocalCommitSha')
    .mockImplementation(() => localCommitSha);

  const successResponse = {
    data: { state: 'success' },
  } as OctokitApi.Response<OctokitApi.ReposGetCombinedStatusForRefResponse>;

  jest
    .spyOn(publishReleaseTask.githubApi.repos, 'getCombinedStatusForRef')
    .mockImplementation(() => Promise.resolve(successResponse));

  jest
    .spyOn(GitClient.prototype, 'hasUncommittedChanges')
    .mockImplementation(() => true);

  expect.assertions(1);

  try {
    await publishReleaseTask.run();
  } catch (err) {
    expect(err.message).toBe(UNCOMMITED_CHANGES_ERROR_MSG);
  }
});

test('Should throw an error when the local branch does not match the upstream', async () => {
  const packageJson: PackageJson = { version: '4.15.3' };
  vol.fromJSON({
    '/package.json': JSON.stringify(packageJson),
  });

  const localBranch = '4.15.x';
  jest
    .spyOn(GitClient.prototype, 'getCurrentBranch')
    .mockImplementation(() => localBranch);

  jest
    .spyOn(GitClient.prototype, 'getLastCommit')
    .mockImplementation(() => 'chore: Bump version to 4.15.3 w/ changelog');

  const localCommitSha = '1234';
  jest
    .spyOn(GitClient.prototype, 'getLocalCommitSha')
    .mockImplementation(() => localCommitSha);

  const successResponse = {
    data: { state: 'success' },
  } as OctokitApi.Response<OctokitApi.ReposGetCombinedStatusForRefResponse>;

  jest
    .spyOn(publishReleaseTask.githubApi.repos, 'getCombinedStatusForRef')
    .mockImplementation(() => Promise.resolve(successResponse));

  jest
    .spyOn(GitClient.prototype, 'hasUncommittedChanges')
    .mockImplementation(() => false);

  jest
    .spyOn(GitClient.prototype, 'getRemoteCommitSha')
    .mockImplementation(() => '2345');

  expect.assertions(1);

  try {
    await publishReleaseTask.run();
  } catch (err) {
    expect(err.message).toBe(
      getLocalDoesNotMatchUpstreamError(localBranch).message,
    );
  }
});

test('Should throw an error when the changelog could not be parsed for the release notes', async () => {
  const packageJson: PackageJson = { version: '4.15.3' };
  vol.fromJSON({
    '/package.json': JSON.stringify(packageJson),
    '/CHANGELOG.md': getFixture('CHANGELOG-invalid.md'),
  });

  const localBranch = '4.15.x';
  jest
    .spyOn(GitClient.prototype, 'getCurrentBranch')
    .mockImplementation(() => localBranch);

  jest
    .spyOn(GitClient.prototype, 'getLastCommit')
    .mockImplementation(() => 'chore: Bump version to 4.15.3 w/ changelog');

  const localCommitSha = '1234';
  jest
    .spyOn(GitClient.prototype, 'getLocalCommitSha')
    .mockImplementation(() => localCommitSha);

  const successResponse = {
    data: { state: 'success' },
  } as OctokitApi.Response<OctokitApi.ReposGetCombinedStatusForRefResponse>;

  jest
    .spyOn(publishReleaseTask.githubApi.repos, 'getCombinedStatusForRef')
    .mockImplementation(() => Promise.resolve(successResponse));

  jest
    .spyOn(GitClient.prototype, 'hasUncommittedChanges')
    .mockImplementation(() => false);

  jest
    .spyOn(GitClient.prototype, 'getRemoteCommitSha')
    .mockImplementation(() => localCommitSha);

  expect.assertions(1);

  try {
    await publishReleaseTask.run();
  } catch (err) {
    expect(err.message).toBe(CHANGELOG_PARSE_ERROR_MSG);
  }
});

test('Should throw an error when the changelog could not be parsed for the release notes', async () => {
  const packageJson: PackageJson = { version: '4.15.3' };
  vol.fromJSON({
    '/package.json': JSON.stringify(packageJson),
    '/CHANGELOG.md': getFixture('CHANGELOG-invalid.md'),
  });

  const localBranch = '4.15.x';
  jest
    .spyOn(GitClient.prototype, 'getCurrentBranch')
    .mockImplementation(() => localBranch);

  jest
    .spyOn(GitClient.prototype, 'getLastCommit')
    .mockImplementation(() => 'chore: Bump version to 4.15.3 w/ changelog');

  const localCommitSha = '1234';
  jest
    .spyOn(GitClient.prototype, 'getLocalCommitSha')
    .mockImplementation(() => localCommitSha);

  const successResponse = {
    data: { state: 'success' },
  } as OctokitApi.Response<OctokitApi.ReposGetCombinedStatusForRefResponse>;

  jest
    .spyOn(publishReleaseTask.githubApi.repos, 'getCombinedStatusForRef')
    .mockImplementation(() => Promise.resolve(successResponse));

  jest
    .spyOn(GitClient.prototype, 'hasUncommittedChanges')
    .mockImplementation(() => false);

  jest
    .spyOn(GitClient.prototype, 'getRemoteCommitSha')
    .mockImplementation(() => localCommitSha);

  expect.assertions(1);

  try {
    await publishReleaseTask.run();
  } catch (err) {
    expect(err.message).toBe(CHANGELOG_PARSE_ERROR_MSG);
  }
});
