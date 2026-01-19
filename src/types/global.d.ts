import type { LobeCustomStylish, LobeCustomToken } from '@lobehub/ui';
import 'antd-style';
import { type AntdToken } from 'antd-style/lib/types/theme';

declare module 'antd-style' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  export interface CustomToken extends LobeCustomToken {}
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  export interface CustomStylish extends LobeCustomStylish {}
}

declare module 'styled-components' {
  export interface DefaultTheme extends AntdToken, LobeCustomToken {}
}

declare global {
  interface Window {
    lobeEnv?: {
      darwinMajorVersion?: number;
    };
    __lobeLastInteraction?: {
      actionable?: {
        className?: string;
        dataAttrs?: Record<string, string | true>;
        href?: string;
        id?: string;
        name?: string;
        role?: string;
        tag: string;
        type?: string;
      };
      pathInfo?: Array<{
        className?: string;
        dataAttrs?: Record<string, string | true>;
        href?: string;
        id?: string;
        name?: string;
        role?: string;
        tag: string;
        type?: string;
      }>;
      path?: string;
      target?: {
        className?: string;
        dataAttrs?: Record<string, string | true>;
        id?: string;
        name?: string;
        role?: string;
        tag: string;
      };
      time: number;
      type: string;
      x?: number;
      y?: number;
    };
  }
}
