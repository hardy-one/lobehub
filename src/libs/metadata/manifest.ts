import { BRANDING_LOGO_URL } from '@lobechat/business-const';
import qs from 'query-string';

import { getCanonicalUrl } from '@/server/utils/url';

const MAX_AGE = 31_536_000;
// Same value as the client dark layout surface, so an installed shell and the app
// inside it agree. Avoids duplicating a full 13-step scale on the server side only
// to read one hex from it.
const COLOR = '#141517';
// The manifest colors are snapshotted into the installed WebAPK shell, so they
// cannot follow the OS theme at runtime. Chrome has not shipped the spec
// `color_scheme_dark` member yet (https://crbug.com/383165202), so both values
// stay dark for now to keep a dark-mode install from falling back to a light
// navigation bar. Once Chrome honours the member, point COLOR at the light value
// and the navigation bar follows the OS theme.
const DARK_COLOR = COLOR;

interface IconItem {
  purpose: 'any' | 'maskable';
  sizes: string;
  url: string;
  version?: number;
}

interface ScreenshotItem {
  form_factor: 'wide' | 'narrow';
  sizes?: string;
  url: string;
  version?: number;
}

export class Manifest {
  public generate({
    color = COLOR,
    darkColor = DARK_COLOR,
    description,
    name,
    id,
    icons,
    screenshots,
  }: {
    color?: string;
    darkColor?: string;
    description: string;
    icons: IconItem[];
    id: string;
    name: string;
    screenshots: ScreenshotItem[];
  }) {
    return {
      background_color: color,
      cache_busting_mode: 'all',
      categories: ['productivity', 'design', 'development', 'education'],
      color_scheme_dark: {
        background_color: darkColor,
        theme_color: darkColor,
      },
      description,
      display: 'standalone',
      display_override: ['tabbed'],
      edge_side_panel: {
        preferred_width: 480,
      },
      handle_links: 'auto',
      icons: icons.map((item) => this._getIcon(item)),
      id,
      immutable: 'true',
      max_age: MAX_AGE,
      name,
      orientation: 'portrait',
      related_applications: [
        {
          platform: 'webapp',
          url: getCanonicalUrl('manifest.webmanifest'),
        },
      ],
      scope: '/',
      screenshots: screenshots.map((item) => this._getScreenshot(item)),
      short_name: name,
      splash_pages: null,
      start_url: '/',
      tab_strip: {
        new_tab_button: {
          url: '/',
        },
      },
      theme_color: color,
    };
  }

  private _getImage = (url: string, version: number = 1) => ({
    cache_busting_mode: 'query',
    immutable: 'true',
    max_age: MAX_AGE,
    src: qs.stringifyUrl({ query: { v: version }, url: BRANDING_LOGO_URL || url }),
  });

  private _getIcon = ({ url, version, sizes, purpose }: IconItem) => ({
    ...this._getImage(url, version),
    purpose,
    sizes,
    type: 'image/png',
  });

  private _getScreenshot = ({ form_factor, url, version, sizes }: ScreenshotItem) => ({
    ...this._getImage(url, version),
    form_factor,
    sizes: sizes || form_factor === 'wide' ? '1280x676' : '640x1138',
    type: 'image/png',
  });
}

export const manifestModule = new Manifest();
