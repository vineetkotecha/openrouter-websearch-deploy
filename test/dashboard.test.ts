import {describe,it,expect} from 'vitest';
import {dashboardHtml} from '../src/server/dashboard.js';
describe('operations dashboard',()=>{it('has no search form and its inline script parses',()=>{expect(dashboardHtml).not.toMatch(/Run search|id="query"|id="provider"/);expect(dashboardHtml).toMatch(/Operations/);const code=dashboardHtml.split('<script>')[1]?.split('</script>')[0];expect(code).toBeTruthy();expect(()=>new Function(code)).not.toThrow()})});
