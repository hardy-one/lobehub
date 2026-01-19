'use client';

import { type FC, useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import AgentIdSync from '@/app/[variants]/(main)/agent/_layout/AgentIdSync';
import ChatHeader from '@/app/[variants]/(mobile)/chat/features/ChatHeader';
import MobileContentLayout from '@/components/server/MobileNavLayout';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';

import { styles } from './style';

const Layout: FC = () => {
  useInitAgentConfig();

  useEffect(() => {
    const getDataAttrs = (element: HTMLElement) => {
      const entries = Object.entries(element.dataset || {});
      if (entries.length === 0) return undefined;

      return entries.reduce<Record<string, string | true>>((acc, [key, value]) => {
        acc[key] = value ?? true;
        return acc;
      }, {});
    };

    const getNodeInfo = (element: HTMLElement) => {
      const name = element.getAttribute('aria-label') || element.getAttribute('title') || undefined;
      const className = typeof element.className === 'string' ? element.className : undefined;
      const dataAttrs = getDataAttrs(element);
      const role = element.getAttribute('role') || undefined;
      const href = element instanceof HTMLAnchorElement ? element.getAttribute('href') || undefined : undefined;
      const type = element instanceof HTMLButtonElement ? element.type || undefined : undefined;

      return {
        className: className || undefined,
        dataAttrs,
        href,
        id: element.id || undefined,
        name,
        role,
        tag: element.tagName,
        type,
      };
    };

    const getTargetInfo = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return undefined;
      return getNodeInfo(target);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const composedPath =
        typeof event.composedPath === 'function'
          ? event
              .composedPath()
              .filter((node): node is HTMLElement => node instanceof HTMLElement)
          : [];
      const pathInfo = composedPath.length > 0 ? composedPath.slice(0, 6).map(getNodeInfo) : undefined;
      const actionable = (event.target instanceof HTMLElement
        ? event.target.closest('button, a, [role="button"], [aria-label], [title], [data-testid]')
        : null) as HTMLElement | null;
      const path =
        typeof event.composedPath === 'function'
          ? event
              .composedPath()
              .filter((node): node is HTMLElement => node instanceof HTMLElement)
              .slice(0, 4)
              .map((node) => node.tagName)
              .join('>')
          : undefined;

      window.__lobeLastInteraction = {
        actionable: actionable ? getNodeInfo(actionable) : undefined,
        path: path || undefined,
        pathInfo,
        target: getTargetInfo(event.target),
        time: Date.now(),
        type: event.type,
        x: event.clientX,
        y: event.clientY,
      };
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, []);

  return (
    <>
      <MobileContentLayout className={styles.mainContainer} header={<ChatHeader />}>
        <Outlet />
      </MobileContentLayout>
      <AgentIdSync />
    </>
  );
};

export default Layout;
