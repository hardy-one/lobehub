import type { CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

// MiMo accepts none/minimal/low/medium/high/xhigh/max/ultra, but only `none`
// (thinking off) differs from the rest today, so the slider exposes the levels
// that actually change behaviour. Ref: https://mimo.mi.com/docs/zh-CN/api/chat/responses
const MIMO_REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'high'] as const;

type MimoReasoningEffort = (typeof MIMO_REASONING_EFFORT_LEVELS)[number];

export type MimoReasoningEffortSliderProps = CreatedLevelSliderProps<MimoReasoningEffort>;

const MimoReasoningEffortSlider = createLevelSliderComponent<MimoReasoningEffort>({
  configKey: 'mimoReasoningEffort',
  defaultValue: 'high',
  levels: MIMO_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default MimoReasoningEffortSlider;
