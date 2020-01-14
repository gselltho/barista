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

import { readFileSync } from 'fs';
import { CHANGELOG_PARSE_ERROR } from './utils';

export interface ReleaseNotes {
  releaseTitle: string;
  releaseNotes: string;
}

/** Extracts the release notes for a specific release from a given changelog file. */
export function extractReleaseNotes(
  changelogPath: string,
  versionName: string,
): ReleaseNotes {
  const changelogContent = readFileSync(changelogPath, 'utf8');
  const escapedVersion = versionName.replace(/\./g, '\\.');

  // Regular expression that matches the release notes for the given version. Note that we specify
  // the "s" RegExp flag so that the line breaks will be ignored within our regex. We determine the
  // section of a version by starting with the release header which starts with an h2.
  // The end of the section will be matched by just looking for the first
  // subsequent release header.
  const releaseNotesRegex = new RegExp(
    `## (${escapedVersion}) \\(\\d{4}-\\d{2}-\\d{2}\\) ?(.*?)##? \\d+\\.\\d+`,
    's',
  );
  const matches = releaseNotesRegex.exec(changelogContent);
  if (matches) {
    // TODO extract release notes and populate the tag via the github api
    return {
      releaseTitle: matches[1],
      releaseNotes: matches[2].trim(),
    };
  } else {
    throw new Error(CHANGELOG_PARSE_ERROR);
  }
}
