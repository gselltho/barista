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

import { join } from 'path';
import { GET_INVALID_PACKAGE_JSON_VERSION_ERROR } from './release-errors';
import {
  PackageJson,
  tryJsonParse,
} from '@dynatrace/barista-components/tools/shared';

/**
 * Regular expression that matches version names and
 * the individual version segments.
 */
const versionNameRegex = /^(\d+)\.(\d+)\.(\d+)?$/;

export class Version {
  constructor(
    /** Major version number */
    public major: number,
    /** Minor version number */
    public minor: number,
    /** Patch version number */
    public patch: number,
  ) {}

  /** Serializes the version info into a string formatted version name. */
  format(): string {
    return serializeVersion(this);
  }

  clone(): Version {
    return new Version(this.major, this.minor, this.patch);
  }

  equals(other: Version): boolean {
    return (
      this.major === other.major &&
      this.minor === other.minor &&
      this.patch === other.patch
    );
  }
}

/**
 * Parses the specified version and returns an object that
 * represents the individual version segments.
 */
export function parseVersionName(version: string): Version | null {
  const matches = version.match(versionNameRegex);
  return matches
    ? new Version(Number(matches[1]), Number(matches[2]), Number(matches[3]))
    : null;
}

/** Serializes the specified version into a string. */
export function serializeVersion(newVersion: Version): string {
  const { major, minor, patch } = newVersion;

  return `${major}.${minor}.${patch}`;
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
