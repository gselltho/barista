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
import { AxiosBasicCredentials, AxiosRequestConfig } from 'axios';
import { Observable, OperatorFunction } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import {
  CircleArtefact,
  CircleJob,
  CirclePipeline,
  CircleResponse,
  CircleWorkflow,
} from './circle-ci.interface';
import { NodeHTTPClient } from './node-http-client';
import { inspect } from 'util';

const CIRCLE_API_V2 = 'https://circleci.com/api/v2/';
const CIRCLE_PROJECT_SLUG = 'github/dynatrace-oss/barista';
const CIRCLE_STAGE = 'build';
const CIRCLE_WORKFLOW_NAME = 'pr_check';

export const ITEM_NOT_FOUND_ERROR = 'Could not find the item in the list';

export const NO_PIPELINE_FOUND_ERROR = (sha: string) =>
  `There is no pipeline for the provided commit SHA: ${sha}`;
export const WORKFLOW_NOT_FOUND_ERROR = (name: string) =>
  `The workflow with the name: ${name} could not be found!`;
export const JOB_NOT_FOUND_ERROR = (name: string) =>
  `The job with the name: ${name} could not be found!`;
export const SERVER_ERROR = (message: string) =>
  `The server responded with an error: \n${message}`;
export const NO_ARTEFACTS_ERROR = (jobName: string) =>
  `No artefacts found for the provided job ${jobName}!`;

/** Abstract class that should be implemented by a CI provider */
export abstract class ContinuosIntegrationApi {
  /** Axios client used for HTTP requests */
  protected _apiClient: NodeHTTPClient;

  constructor(
    baseUrl: string,
    authentication: AxiosBasicCredentials,
    options: Partial<AxiosRequestConfig> = {},
  ) {
    this._apiClient = new NodeHTTPClient({
      baseURL: baseUrl,
      auth: authentication,
      responseType: 'json',
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    });
  }

  /**
   * Returns an url where an artefact can be downloaded for a branch
   * @param branchName The branch where the artefact should be downloaded
   * @param stage The stage where it was created
   */
  abstract getArtefactUrlForBranch(commitSha: string): Observable<string>;
}

/**
 * Continuos integration provider for Circle ci that can provides
 * an url to download a builded dist for a provided commit sha.
 *
 * This artefact can be downloaded later for releasing.
 *
 * This class is using the version 2 of the circle ci api.
 * https://circleci.com/docs/api/v2/
 */
export class CircleCiApi extends ContinuosIntegrationApi {
  constructor(authToken: string) {
    super(CIRCLE_API_V2, {
      username: authToken,
      password: '', // password has to be empty
    });
  }

  /** Get the download url to the artefact for the provided branch */
  getArtefactUrlForBranch(commitSha: string): Observable<any> {
    return this._getPipeline(commitSha).pipe(
      switchMap(pipeline =>
        this._getWorkflow(pipeline.id, CIRCLE_WORKFLOW_NAME),
      ),
      switchMap(workflow => this._getJob(workflow.id, CIRCLE_STAGE)),
      switchMap(job => this._getArtefacts(job)),
    );
  }

  /** Retrieves all the pipelines in the project */
  private _getPipeline(commitSha: string): Observable<CirclePipeline> {
    return this._apiClient
      .get<CircleResponse<CirclePipeline>>(
        `project/${CIRCLE_PROJECT_SLUG}/pipeline`,
      )
      .pipe(
        tap(response => {
          if (!response.items.length) {
            throw Error(NO_PIPELINE_FOUND_ERROR(commitSha));
          }
        }),
        filterResponse<CirclePipeline>(
          pipeline => pipeline.vcs.revision === commitSha,
          NO_PIPELINE_FOUND_ERROR(commitSha),
        ),
      );
  }

  /** Retrieves a workflow from a pipeline with a provided name */
  private _getWorkflow(
    pipelineId: string,
    workflowName: string,
  ): Observable<CircleWorkflow> {
    return this._apiClient
      .get<CircleResponse<CircleWorkflow>>(`pipeline/${pipelineId}/workflow`)
      .pipe(
        filterResponse<CircleWorkflow>(
          workflow => workflow.name === workflowName,
          WORKFLOW_NOT_FOUND_ERROR(workflowName),
        ),
      );
  }

  /** Retrieves a Job by a workflow id and a jobname */
  private _getJob(workflowId: string, jobName: string): Observable<CircleJob> {
    return this._apiClient
      .get<CircleResponse<CircleJob>>(`workflow/${workflowId}/job`)
      .pipe(
        filterResponse<CircleJob>(
          job => job.name === jobName,
          JOB_NOT_FOUND_ERROR(jobName),
        ),
      );
  }

  /** Get a list of artifacts for a provided job number */
  private _getArtefacts(job: CircleJob): Observable<CircleArtefact[]> {
    return this._apiClient
      .get<CircleResponse<CircleArtefact>>(
        `/project/${CIRCLE_PROJECT_SLUG}/${job.job_number}/artifacts`,
      )
      .pipe(
        map(response => response.items),
        tap(artefacts => {
          if (!artefacts || !artefacts.length) {
            throw new Error(NO_ARTEFACTS_ERROR(job.name));
          }
        }),
      );
  }
}

/**
 * @internal
 * Custom operator that filters for an item in an circle Response
 * and throws an error if nothing was found
 */
export function filterResponse<T>(
  filterFunction: (item: T) => boolean,
  error?: string,
): OperatorFunction<CircleResponse<T>, T> {
  return input$ =>
    input$.pipe(
      map(response => {
        const item = response.items.find(filterFunction);
        if (!item) {
          throw new Error(error || ITEM_NOT_FOUND_ERROR);
        }
        return item;
      }),
    );
}
