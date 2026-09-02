declare module '@khmyznikov/pwa-install/dist/pwa-install.react.js' {
  import type { ComponentType } from 'react';

  interface PWAInstallProps {
    'description'?: string;
    'id'?: string;
    'manifest-url'?: string;
  }

  const PWAInstall: ComponentType<PWAInstallProps>;

  export default PWAInstall;
}
