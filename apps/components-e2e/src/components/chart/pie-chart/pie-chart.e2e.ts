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

// import { Selector } from 'testcafe';

fixture('Pie chart').page('http://localhost:4200/chart/pie');
// const pieChart = Selector('.pie-chart .highcharts-point');
// const tooltip = Selector('.dt-chart-tooltip-overlay');

// removed E2E test because e2e testing highcharts is hell
// test('Pie charts having tooltips', async (testController: TestController) => {
//   await testController.wait(500);
//   await testController.hover(pieChart);
//   await testController.wait(1000);
//   await testController.expect(await tooltip.exists).ok();
// });
