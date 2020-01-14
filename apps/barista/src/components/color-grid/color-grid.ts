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

import { Component, Input, AfterContentInit } from '@angular/core';
import { DtColors } from '@dynatrace/barista-components/theming';

@Component({
  selector: 'ba-color-grid',
  templateUrl: 'color-grid.html',
  styleUrls: ['color-grid.scss'],
})
export class BaColorGrid implements AfterContentInit {
  @Input()
  set color(value: string) {
    this._colorname = value.toUpperCase();
  }

  /** @internal name of the colorgroup */
  _colorname: string;

  /** @internal name of all colors that should be displayed */
  _allSelectedColors;

  ngAfterContentInit(): void {
    this._allSelectedColors = Object.keys(DtColors)
      .map((color): string | undefined => {
        const parts = color.split('_');

        if (
          parts[0] === this._colorname ||
          (this._colorname === 'GRAY' && parts[0] === 'WHITE')
        ) {
          return color;
        }

        return;
      })
      .filter(Boolean);
  }
}
