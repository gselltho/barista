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
  executeCommand,
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
import { npmPublish } from './npm/npm-client';
import { parseVersionName, Version, determineVersion } from './parse-version';
import { promptConfirmReleasePublish } from './prompts';
import { shouldRelease } from './release-check';
import { promises as fs, existsSync } from 'fs';
import {
  BUNDLE_VERSION_ERROR,
  NO_TOKENS_PROVIDED_ERROR,
  NO_VALID_RELEASE_BRANCH_ERROR,
} from './release-errors';
import { createReleaseTag, pushReleaseTag } from './tagging';
import {
  verifyPassingGithubStatus,
  verifyLocalCommitsMatchUpstream,
  verifyNoUncommittedChanges,
} from './git';
import { tap, switchMap, map } from 'rxjs/operators';

// load the environment variables from the .env file in your workspace
dotenvConfig();

/** The root of the barista git repo where the git commands should be executed */
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();

const BUNDLE_NAME = 'barista-components.tar.gz';

/**
 * The function to publish a release -
 * requires user interaction/input through command line prompts.
 */
export async function publishRelease(workspaceRoot: string): Promise<void> {
  /** The temporary folder where the dist should be unpacked */
  const TAR_DESTINATION = join(workspaceRoot, 'tmp');
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
  const gitClient = new GitClient(workspaceRoot);

  // Octokit API instance that can be used to make Github API calls.
  const githubApi = new OctokitApi();

  // determine version for the check whether we should release from this branch
  const version = await determineVersion(workspaceRoot);

  // // verify if we should release
  // if (!shouldRelease(gitClient, version)) {
  //   throw new Error(NO_VALID_RELEASE_BRANCH_ERROR);
  // }
  // const currentBranch = gitClient.getCurrentBranch();

  // // check that the build was successful
  // await verifyPassingGithubStatus(gitClient, githubApi, currentBranch);

  // // verify un-committed changes
  // verifyNoUncommittedChanges(gitClient);

  // // verify local commits match upstream
  // verifyLocalCommitsMatchUpstream(gitClient, currentBranch);

  // # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #
  // #
  // #  D O W N L O A D
  // #  ---------------
  // #  Download builded components library from our CI to release this version.
  // #
  // # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # # #

  const relaseCommit = 'd8614c3e19ec19992a21de367aa27aaee4427448'; // = gitClient.getLocalCommitSha('HEAD')
  // the location where the artifact should be downloaded to
  const packedArtifactFile = join(TAR_DESTINATION, 'components.tar.gz');

  // creating the destination folder for the artifact
  await executeCommand(`rm -rf ${TAR_DESTINATION}`);

  await fs.mkdir(TAR_DESTINATION, { recursive: true });

  // request build id for commit on remote
  const circleArtifact = await circleCiApi
    .getArtifactUrlForBranch(relaseCommit)
    .pipe(
      map(artifacts => artifacts[0]),
      switchMap(artifact =>
        circleCiApi.downloadArtifact(artifact, packedArtifactFile),
      ),
    )
    .toPromise();

  console.log(
    `tar -xzf ${packedArtifactFile} -C ${join(TAR_DESTINATION, 'components')}`,
  );
  // unpack the downloaded artifact
  // await executeCommand(`tar -xzf ${packedArtifactFile} -C ${join(TAR_DESTINATION, 'components')}`);

  // return;

  // // download the tar file
  // await downloadFile(TAR_DESTINATION, circleArtifact[0].url);
  // const extractedPath = join(TAR_DESTINATION, 'extracted');
  // // extract tar file
  // await extractTarFile(extractedPath, BUNDLE_NAME);

  // // check release bundle (verify version in package.json)
  // await verifyBundle(version, extractedPath);

  // // extract release notes
  // const releaseNotes = extractReleaseNotes(
  //   CHANGELOG_FILE_NAME,
  //   version.format(),
  // );
  // const tagName = version.format();
  // // create release tag
  // createReleaseTag(tagName, releaseNotes, gitClient);

  // // push release tag to github
  // pushReleaseTag(tagName, gitClient);

  // // safety net - confirm publish again
  // await promptConfirmReleasePublish();

  // // confirm npm publish
  // publishPackageToNpm('DUMMY_PATH');

  // console.log(green(bold(`  ✓   Published successfully`)));

  // // publish TADA!🥳
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

// /** Entry-point for the create release script. */
// if (require.main === module) {
publishRelease(WORKSPACE_ROOT)
  .then()
  .catch(error => {
    console.log(red(error));
    // deliberately set to 0 so we don't have the error stacktrace in the console
    process.exit(0);
  });
// }
