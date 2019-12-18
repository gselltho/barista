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

import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { AsyncSubject, Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { BaLocationService } from './location.service';

import { environment } from '../environments/environment';
import {
  BaPageBuilderContentResult,
  BaLayoutType,
  BaSearchPageContent,
} from '@dynatrace/barista-components/barista-definitions';

const CONTENT_PATH_PREFIX = 'data/';

/**
 * CODE COPIED FROM: 'https://github.com/angular/angular/blob/master/aio/src/app/documents/document.service.ts' and modified
 */

@Injectable()
export class BaPageService {
  /**
   * Caches pages once they have been loaded.
   */
  private _cache = new Map<string, Observable<BaPageBuilderContentResult>>();

  /**
   * The current page that should be displayed.
   */
  currentPage: Observable<BaPageBuilderContentResult>;

  constructor(private http: HttpClient, location: BaLocationService) {
    // Whenever the URL changes we try to get the appropriate doc
    this.currentPage = location.currentPath$.pipe(
      switchMap(path => this._getPage(path)),
    );

    // Populate the cache with the search page so that it is always available.
    this._cache.set(
      'search',
      of({
        layout: BaLayoutType.Search,
        title: 'Search results',
      } as BaSearchPageContent),
    );
  }

  /**
   * Gets page from cache.
   * @param url - path to page
   */
  private _getPage(url: string): Observable<BaPageBuilderContentResult> {
    const id = url || 'index';
    if (!this._cache.has(id)) {
      this._cache.set(id, this._fetchPage(id));
    }
    return this._cache.get(id)!;
  }

  /**
   * Fetches page from data source.
   * @param id - page id (path).
   */
  private _fetchPage(id: string): Observable<BaPageBuilderContentResult> {
    const requestPath = `${environment.dataHost}${CONTENT_PATH_PREFIX}${id}.json`;
    const subject = new AsyncSubject<BaPageBuilderContentResult>();

    this.http
      .get<BaPageBuilderContentResult>(requestPath, { responseType: 'json' })
      .subscribe(subject);

    return subject.asObservable();
  }
}
