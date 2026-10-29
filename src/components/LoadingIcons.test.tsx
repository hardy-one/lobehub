/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TopicStatusIcon from '@/features/AgentTasks/AgentTaskDetail/TopicStatusIcon';

import RingLoadingIcon from './RingLoading';
import StopLoadingIcon from './StopLoading';

// The icon chain imports @lobehub/ui, which pulls in the app store graph that
// needs a working indexedDB; the store hooks are out of scope here, and the
// same stub is used by AssistantGroup/components/Group.test.tsx.
vi.mock('@/store/chat', () => ({ useChatStore: (selector: any) => selector({}) }));

// SMIL <animateTransform> rewrites the `transform` presentation attribute on
// an SVG child every frame. Each mounted icon then re-runs style recalc + SVG
// layout on the main thread — measured at ~100/s per sidebar entry with a
// running topic, invisible to CSS animation audits and getAnimations().
// The spin now lives on a CSS animation.
describe('loading spinner icons', () => {
  it('renders no SMIL animateTransform', () => {
    for (const Icon of [RingLoadingIcon, StopLoadingIcon]) {
      const { container } = render(<Icon />);

      expect(container.querySelector('animateTransform')).toBeNull();
      expect(container.querySelector('svg')).toBeTruthy();
    }
  });

  it('keeps the stop square outside the rotating layer', () => {
    // The two-layer split is the whole point of the rewrite: rotating the svg
    // root as one piece would spin the center square with the arc.
    const { container } = render(<StopLoadingIcon />);

    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs).toHaveLength(2);

    expect(svgs[0].querySelectorAll('rect')).toHaveLength(1);
    expect(svgs[0].querySelectorAll('path')).toHaveLength(0);
    expect(svgs[1].querySelectorAll('path')).toHaveLength(1);
    expect(svgs[1].querySelectorAll('rect')).toHaveLength(0);
  });

  it('hosts every spin on an HTML span, never on the svg itself', () => {
    // Blink refuses to composite transform animations on SVG elements when the
    // effective zoom (device pixel ratio scaling) is > 1, so an svg-level spin
    // costs a whole-document style recalc every frame (~60/s on-device) instead
    // of running on the compositor. Each icon must therefore wrap its svg in
    // the span that carries the animation — flipping any of these back to
    // animating the svg directly is the regression this asserts against.
    const { container: ring } = render(<RingLoadingIcon />);
    const ringSvg = ring.querySelector('svg')!;
    expect(ringSvg.parentElement?.tagName).toBe('SPAN');
    // The animation class rides on the wrapper span (the svg keeps only paint
    // attributes), so the wrapper carries at least the classes the svg does.
    const ringWrapper = ringSvg.parentElement as HTMLElement;
    expect(ringWrapper.classList.length).toBeGreaterThan(0);
    // The svg must not carry the wrapper's classes: if the animation class
    // ever lands back on the svg, it would appear in both class lists.
    for (const cls of ringWrapper.classList) {
      expect(ringSvg.classList.contains(cls)).toBe(false);
    }

    const { container: stop } = render(<StopLoadingIcon />);
    for (const svg of stop.querySelectorAll('svg')) {
      expect(svg.parentElement?.tagName).toBe('SPAN');
    }

    const { container: running } = render(<TopicStatusIcon size={16} status="running" />);
    const runningSvg = running.querySelector('svg')!;
    expect(runningSvg.parentElement?.tagName).toBe('SPAN');
  });
});
