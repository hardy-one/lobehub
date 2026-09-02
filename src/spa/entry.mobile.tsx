import '../initialize';

import { RouterProvider } from 'react-router/dom';

import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { bootTiming } from '@/libs/bootTiming';
import { createAppRouter } from '@/utils/router';

import { startAppInitialization } from './initialize/bootstrap';
import { registerServiceWorker } from './registerServiceWorker';
import { mobileRoutes } from './router/mobileRouter.config';
import { createSPARoot } from './runtime';
import ThemeColorMeta from './ThemeColorMeta';

bootTiming.mark('bundle-eval');
startAppInitialization();
registerServiceWorker();

const router = createAppRouter(mobileRoutes);

createSPARoot(document.getElementById('root')!).render(
  <NextThemeProvider>
    <ThemeColorMeta />
    <RouterProvider router={router} />
  </NextThemeProvider>,
);
