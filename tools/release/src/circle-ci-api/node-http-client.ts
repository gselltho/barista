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
  AxiosPromise,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import { Observable, Subscriber } from 'rxjs';

const METHOD_NOT_SUPPORTED_ERROR = 'This method is not supported!';

/**
 * Wrapped axios requests in streams to easily test them
 */
export class NodeHTTPClient {
  /** Axios instance */
  private _httpClient: AxiosInstance;

  constructor(options: Partial<AxiosRequestConfig> = {}) {
    this._httpClient = axios.create(options);
  }

  /** Wrap the request in an observable */
  private _request<T>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    queryParams?: object,
    body?: object,
  ): Observable<T> {
    let request: AxiosPromise<T>;

    switch (method) {
      case 'get':
        request = this._httpClient.get<T>(url, { params: queryParams });
        break;
      case 'post':
        request = this._httpClient.post<T>(url, body, { params: queryParams });
        break;
      case 'put':
        request = this._httpClient.put<T>(url, body, { params: queryParams });
        break;
      case 'patch':
        request = this._httpClient.patch<T>(url, body, { params: queryParams });
        break;
      case 'delete':
        request = this._httpClient.delete(url, { params: queryParams });
        break;
      default:
        throw new Error(METHOD_NOT_SUPPORTED_ERROR);
    }

    return new Observable<T>((subscriber: Subscriber<T>) => {
      request
        .then((response: AxiosResponse<T>) => {
          subscriber.next(response.data);
          subscriber.complete();
        })
        .catch((err: Error) => {
          subscriber.error(err);
          subscriber.complete();
        });
    });
  }

  get<T>(url: string, queryParams?: object) {
    return this._request<T>('get', url, queryParams);
  }

  post<T>(url: string, body: object, queryParams?: object) {
    return this._request<T>('post', url, queryParams, body);
  }

  put<T>(url: string, body: object, queryParams?: object) {
    return this._request<T>('put', url, queryParams, body);
  }

  patch<T>(url: string, body: object, queryParams?: object) {
    return this._request<T>('patch', url, queryParams, body);
  }

  delete(url: string, queryParams?: object) {
    return this._request('delete', url, queryParams);
  }
}
