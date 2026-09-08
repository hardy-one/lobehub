import type { CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const QWEN_REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

type QwenReasoningEffort = (typeof QWEN_REASONING_EFFORT_LEVELS)[number];

export type QwenReasoningEffortSliderProps = CreatedLevelSliderProps<QwenReasoningEffort>;

const QwenReasoningEffortSlider = createLevelSliderComponent<QwenReasoningEffort>({
  configKey: 'qwenReasoningEffort',
  defaultValue: 'medium',
  levels: QWEN_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default QwenReasoningEffortSlider;
