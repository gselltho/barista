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

import * as OctokitApi from '@octokit/rest';
import { GitClient } from './git-client';
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from './github-urls';
import { GET_UNSUCCESSFUL_GITHUB_STATUS_ERROR } from '../release-errors';

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
