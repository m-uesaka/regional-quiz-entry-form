import {describe, expect, it, vi} from 'vitest';
import {load} from './+page.server';

const {loadPortalRegions} = vi.hoisted(() => ({loadPortalRegions: vi.fn()}));
vi.mock('$lib/server/portal-regions', () => ({loadPortalRegions}));

// The reading and grouping are `loadPortalRegions()`'s, tested with it; this
// only checks the page hands its `fetch` over and serves what comes back.
describe('portal +page.server load', () => {
  it("serves the regions read with the page's fetch", async () => {
    const regions = [
      {
        regionSlug: 'tokyo',
        regionName: '東京',
        allowsDualEntry: false,
        tournaments: [],
      },
    ];
    loadPortalRegions.mockResolvedValue(regions);
    const fetchImpl = (async () => new Response()) as typeof fetch;

    const result = await load({fetch: fetchImpl} as Parameters<typeof load>[0]);

    expect(loadPortalRegions).toHaveBeenCalledWith(fetchImpl);
    expect(result).toEqual({regions});
  });
});
