import {describe, expect, it} from 'vitest';
import type {StaffLoginResponse} from '@regional-quiz/shared';
import {staffLandingPath, staffLoginPath} from './staff-login';

const GENERAL: StaffLoginResponse = {
  ok: true,
  role: 'general',
  regionSlug: null,
  tournamentType: null,
};

const REGIONAL: StaffLoginResponse = {
  ok: true,
  role: 'regional',
  regionSlug: 'tokyo',
  tournamentType: 'saikyoi',
};

describe('staffLoginPath', () => {
  it('carries the requested page as redirectTo', () => {
    expect(staffLoginPath(new URL('http://localhost/staff/dashboard'))).toBe(
      '/staff/login?redirectTo=%2Fstaff%2Fdashboard',
    );
  });

  it('keeps the query string of the requested page', () => {
    expect(
      staffLoginPath(
        new URL('http://localhost/staff/tokyo/saikyoi/entries?q=1'),
      ),
    ).toBe(
      '/staff/login?redirectTo=%2Fstaff%2Ftokyo%2Fsaikyoi%2Fentries%3Fq%3D1',
    );
  });
});

describe('staffLandingPath', () => {
  it('sends general staff to the cross-region dashboard', () => {
    expect(staffLandingPath(GENERAL, null)).toBe('/staff/dashboard');
  });

  it("sends regional staff to their own tournament's entry list", () => {
    expect(staffLandingPath(REGIONAL, null)).toBe(
      '/staff/tokyo/saikyoi/entries',
    );
  });

  it('has nowhere to send regional staff with no tournament assigned', () => {
    expect(
      staffLandingPath(
        {...REGIONAL, regionSlug: null, tournamentType: null},
        null,
      ),
    ).toBeNull();
  });

  it('honours the page the staff member was originally aiming at', () => {
    expect(staffLandingPath(GENERAL, '/staff/tokyo/saikyoi/entries')).toBe(
      '/staff/tokyo/saikyoi/entries',
    );
  });

  it('refuses a redirect that would leave the site', () => {
    expect(staffLandingPath(GENERAL, 'https://evil.example/staff/')).toBe(
      '/staff/dashboard',
    );
    expect(staffLandingPath(GENERAL, '//evil.example/staff/')).toBe(
      '/staff/dashboard',
    );
    expect(staffLandingPath(GENERAL, '/\\evil.example')).toBe(
      '/staff/dashboard',
    );
  });

  it('refuses a redirect outside the staff screens', () => {
    expect(staffLandingPath(GENERAL, '/mypage')).toBe('/staff/dashboard');
  });

  it('hands general staff back an /admin screen they were aiming at', () => {
    // `routes/admin/+layout.server.ts` bounces anonymous visitors through
    // this login, so `/admin/*` has to survive the round trip.
    expect(staffLandingPath(GENERAL, '/admin/regions')).toBe('/admin/regions');
  });

  it('sends regional staff home instead of to an /admin screen', () => {
    expect(staffLandingPath(REGIONAL, '/admin/regions')).toBe(
      '/staff/tokyo/saikyoi/entries',
    );
  });

  it('refuses a redirect back to the login screen itself', () => {
    expect(staffLandingPath(GENERAL, '/staff/login')).toBe('/staff/dashboard');
    expect(
      staffLandingPath(GENERAL, '/staff/login?redirectTo=%2Fstaff%2F'),
    ).toBe('/staff/dashboard');
  });

  it('hands regional staff back a page within their own tournament', () => {
    expect(
      staffLandingPath(REGIONAL, '/staff/tokyo/saikyoi/entries/entry-1'),
    ).toBe('/staff/tokyo/saikyoi/entries/entry-1');
    expect(staffLandingPath(REGIONAL, '/staff/tokyo/saikyoi/entries?q=1')).toBe(
      '/staff/tokyo/saikyoi/entries?q=1',
    );
  });

  it('sends regional staff home instead of to a 403 they cannot pass', () => {
    // A shared dashboard link, or another region's entry list: honouring
    // either would land the login straight on an error page.
    expect(staffLandingPath(REGIONAL, '/staff/dashboard')).toBe(
      '/staff/tokyo/saikyoi/entries',
    );
    expect(staffLandingPath(REGIONAL, '/staff/osaka/saikyoi/entries')).toBe(
      '/staff/tokyo/saikyoi/entries',
    );
    expect(staffLandingPath(REGIONAL, '/staff/tokyo/abc/entries')).toBe(
      '/staff/tokyo/saikyoi/entries',
    );
  });

  it("does not read a longer slug as being within the staff member's own", () => {
    expect(staffLandingPath(REGIONAL, '/staff/tokyo/saikyoi-2/entries')).toBe(
      '/staff/tokyo/saikyoi/entries',
    );
    expect(
      staffLandingPath(REGIONAL, '/staff/tokyo-west/saikyoi/entries'),
    ).toBe('/staff/tokyo/saikyoi/entries');
  });

  it('has nowhere to send an unassigned regional account, redirect or not', () => {
    expect(
      staffLandingPath(
        {...REGIONAL, regionSlug: null, tournamentType: null},
        '/staff/tokyo/saikyoi/entries',
      ),
    ).toBeNull();
  });
});
