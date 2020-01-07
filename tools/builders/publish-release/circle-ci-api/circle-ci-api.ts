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
import axios, {
  AxiosInstance,
  AxiosError,
  AxiosBasicCredentials,
  AxiosRequestConfig,
} from 'axios';
import { URL } from 'url';
import {
  CircleServerError,
  CirclePipeline,
  CircleWorkflow,
  CircleResponse,
  CircleJob,
  CircleArtefact,
} from './circle-ci.interface';

const NO_PIPELINE_FOUND_ERROR = (sha: string) =>
  `There is no pipeline for the provided commit SHA: ${sha}`;
const WORKFLOW_NOT_FOUND_ERROR = (name: string) =>
  `The workflow with the name: ${name} could not be found!`;
const JOB_NOT_FOUND_ERROR = (name: string) =>
  `The job with the name: ${name} could not be found!`;
const SERVER_ERROR = (message: string) =>
  `The server responded with an error: \n${message}`;
const NO_ARTEFACTS_ERROR = (jobName: string) =>
  `No artefacts found for the provided job ${jobName}!`;

/** Abstract class that should be implemented by a CI provider */
export abstract class ContinuosIntegrationApi {
  /** Axios client used for HTTP requests */
  protected _apiClient: AxiosInstance;

  constructor(
    baseUrl: string,
    authentication: AxiosBasicCredentials,
    options: Partial<AxiosRequestConfig> = {},
  ) {
    this._apiClient = axios.create({
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
  abstract getArtefactUrlForBranch(commitSha: string): Promise<string>;
}

const CIRCLE_API_V2 = 'https://circleci.com/api/v2/';
const CIRCLE_PROJECT_SLUG = 'github/dynatrace-oss/barista';
// TODO: lukas.holzer should be build, when the build stage generates an artefact.
const CIRCLE_STAGE = 'unit-test';
const CIRCLE_WORKFLOW_NAME = 'pr_check';

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
  async getArtefactUrlForBranch(commitSha: string): Promise<string> {
    const pipelines = await this._getAllPipelines();
    const branchPipeline = pipelines.find(
      pipeline => pipeline.vcs.revision === commitSha,
    );

    if (!branchPipeline) {
      throw Error(NO_PIPELINE_FOUND_ERROR(commitSha));
    }
    // get the workflow for the pipeline
    const workflow = await this._getWorkflow(
      branchPipeline.id,
      CIRCLE_WORKFLOW_NAME,
    );
    // get the job for the workflow
    const job = await this._getJob(workflow.id, CIRCLE_STAGE);

    // get the artefacts for the job number
    const artefacts = await this._getArtefacts(job.job_number);

    if (!artefacts.length) {
      throw Error(NO_ARTEFACTS_ERROR(job.name));
    }

    return artefacts[0].url;
  }

  /** Retrieves all the pipelines in the project */
  private async _getAllPipelines(): Promise<CirclePipeline[]> {
    try {
      const response = await this._apiClient.get<
        CircleResponse<CirclePipeline>
      >(`project/${CIRCLE_PROJECT_SLUG}/pipeline`);
      return response.data.items;
    } catch (err) {
      checkServerError(err);
    }
  }

  /** Retrieves a workflow from a pipeline with a provided name */
  private async _getWorkflow(
    pipelineId: string,
    workflowName: string,
  ): Promise<CircleWorkflow> {
    try {
      const response = await this._apiClient.get<
        CircleResponse<CircleWorkflow>
      >(`pipeline/${pipelineId}/workflow`);

      const item = response.data.items.find(
        workflow => workflow.name === workflowName,
      );

      if (!item) {
        throw new Error(WORKFLOW_NOT_FOUND_ERROR(workflowName));
      }

      return item;
    } catch (err) {
      checkServerError(err);
    }
  }

  /** Retrieves a Job by a workflow id and a jobname */
  private async _getJob(
    workflowId: string,
    jobName: string,
  ): Promise<CircleJob> {
    try {
      const response = await this._apiClient.get<CircleResponse<CircleJob>>(
        `workflow/${workflowId}/job`,
      );

      const item = response.data.items.find(job => job.name === jobName);

      if (!item) {
        throw new Error(JOB_NOT_FOUND_ERROR(jobName));
      }

      return item;
    } catch (err) {
      checkServerError(err);
    }
  }

  /** Get a list of artifacts for a provided job number */
  private async _getArtefacts(
    jobNumber: number | string,
  ): Promise<CircleArtefact[]> {
    try {
      const response = await this._apiClient.get<
        CircleResponse<CircleArtefact>
      >(`/project/${CIRCLE_PROJECT_SLUG}/${jobNumber}/artifacts`);

      return response.data.items;
    } catch (err) {
      checkServerError(err);
    }
  }
}

/** Check if the error is an axios server error otherwise throw the error */
function checkServerError(err: any): void {
  if (err && err.response) {
    const axiosError = err as AxiosError<CircleServerError>;
    throw new Error(SERVER_ERROR(axiosError.message));
  }

  throw err;
}
