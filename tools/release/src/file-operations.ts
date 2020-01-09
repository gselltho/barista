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

import { existsSync, createWriteStream, promises as fs } from 'fs';
import { executeCommand } from '../../util/execute-command';
import Axios from 'axios';

/**
 * Downloads a file and writes it to the given destination
 */
export async function downloadFile(
  destination: string,
  url: string,
): Promise<void> {
  const writer = createWriteStream(destination);

  const response = await Axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  response.data.pipe(writer);

  return new Promise((res, reject) => {
    writer.on('finish', res);
    writer.on('error', reject);
  });
}

/** Extracts a tar file to the given destination */
export async function extractTarFile(
  destination: string,
  filePath: string,
  clearDestination: boolean = true,
): Promise<void> {
  if (existsSync(destination) && clearDestination) {
    await fs.rmdir(destination);
  }
  await fs.mkdir(destination, { recursive: true });
  await executeCommand(`tar -xzf ${filePath} -C ${destination}`);
}
