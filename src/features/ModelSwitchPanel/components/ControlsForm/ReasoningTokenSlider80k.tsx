import { Flexbox, InputNumber } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useMemo } from 'react';
import useMergeState from 'use-merge-value';

const Kibi = 1024;
const MAX_VALUE = 80 * Kibi; // 81920

// Linear marks (in kibi units) with equal spacing
const MARK_VALUES = [1, 2, 4, 8, 16, 32, 64, 80];

interface ReasoningTokenSlider80kProps {
  defaultValue?: number;
  onChange?: (value: number) => void;
  value?: number;
}

const ReasoningTokenSlider80k = memo<ReasoningTokenSlider80kProps>(
  ({ value, onChange, defaultValue }) => {
    const [token, setTokens] = useMergeState(0, {
      defaultValue,
      onChange,
      value,
    });

    const [sliderValue, setSliderValue] = useMergeState(0, {
      defaultValue: typeof defaultValue === 'undefined' ? 0 : defaultValue / Kibi,
      value: typeof value === 'undefined' ? 0 : value / Kibi,
    });

    const marks = MARK_VALUES.reduce(
      (acc, v) => {
        acc[v] = `${v}k`;
        return acc;
      },
      {} as Record<number, string>,
    );

    const step = useMemo(() => {
      const current = token ?? 0;

      if (current <= Kibi) return 128;

      if (current < 8 * Kibi) return Kibi;

      return 4 * Kibi;
    }, [token]);

    return (
      <Flexbox horizontal align={'center'} gap={12} paddingInline={'4px 0'}>
        <Flexbox flex={1} style={{ minWidth: 200, maxWidth: 320 }}>
          <Slider
            marks={marks}
            max={80}
            min={1}
            step={null}
            tooltip={{ open: false }}
            value={sliderValue}
            onChange={(v) => {
              setSliderValue(v);
              setTokens(Math.min(v * Kibi, MAX_VALUE));
            }}
          />
        </Flexbox>
        <div>
          <InputNumber
            changeOnWheel
            max={MAX_VALUE}
            min={0}
            step={step}
            style={{ width: 80 }}
            value={token}
            onChange={(e) => {
              if (!e && e !== 0) return;
              const clampedValue = Math.min(Math.round(e as number), MAX_VALUE);
              setTokens(clampedValue);
              setSliderValue(clampedValue / Kibi);
            }}
          />
        </div>
      </Flexbox>
    );
  },
);

export default ReasoningTokenSlider80k;
