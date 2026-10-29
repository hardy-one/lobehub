import { createElement, type ReactElement } from 'react';
import { createBrowserRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import BrandTextLoading from '@/components/Loading/BrandTextLoading';
import { configureSPARuntimeInstrumentation } from '@/spa/runtime';

import { createAppRouter, dynamicElement, dynamicLayout } from './router';

const neverResolves = () => new Promise<{ default: () => null }>(() => {});

const readFallback = (element: ReactElement) =>
  (element as ReactElement<{ fallback: ReactElement }>).props.fallback;

describe('dynamic route helpers', () => {
  it.each([
    ['dynamicLayout', dynamicLayout],
    ['dynamicElement', dynamicElement],
  ])('%s falls back to the brand loading when no fallback is provided', (_, createRouteElement) => {
    expect(readFallback(createRouteElement(neverResolves, 'Test')).type).toBe(BrandTextLoading);
  });

  it.each([
    ['dynamicLayout', dynamicLayout],
    ['dynamicElement', dynamicElement],
  ])('%s suspends on the provided fallback instead', (_, createRouteElement) => {
    const fallback = createElement('div');

    expect(readFallback(createRouteElement(neverResolves, 'Test', { fallback }))).toBe(fallback);
  });
});

describe('createAppRouter', () => {
  it('registers a root hydrate fallback for the first loader-pending paint', () => {
    let capturedRoutes: Parameters<typeof createBrowserRouter>[0] | undefined;
    configureSPARuntimeInstrumentation({
      createBrowserRouter: (...args) => {
        capturedRoutes = args[0];
        return createBrowserRouter(...args);
      },
    });

    createAppRouter([{ element: createElement('div'), path: '/child' }]);

    const root = capturedRoutes![0];
    // The warning fires exactly when no match carries a `HydrateFallback` /
    // `hydrateFallbackElement`; a root one settles the frame every child
    // loader defers.
    expect((root.hydrateFallbackElement as ReactElement).type).toBe(BrandTextLoading);
  });
});
