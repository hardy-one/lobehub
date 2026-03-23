import { Flexbox, InputNumber } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useMemo } from 'react';
import useMergeState from 'use-merge-value';

const Kibi = 1024;
const MAX_VALUE = 80 * Kibi; // 81920

const exponent = (num: number) => Math.log2(num);
const powerKibi = (num: number) => Math.round(Math.pow(2, num) * Kibi);

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

    const [powValue, setPowValue] = useMergeState(0, {
      defaultValue: exponent(typeof defaultValue === 'undefined' ? 0 : defaultValue / 1024),
      value: exponent(typeof value === 'undefined' ? 0 : value / Kibi),
    });

    const updateWithPowValue = (value: number) => {
      setPowValue(value);

      setTokens(Math.min(powerKibi(value), MAX_VALUE));
    };

    const updateWithRealValue = (value: number) => {
      const clampedValue = Math.min(Math.round(value), MAX_VALUE);
      setTokens(clampedValue);

      setPowValue(exponent(clampedValue / Kibi));
    };

    const marks = useMemo(() => {
      return {
        [exponent(1)]: '1k',
        [exponent(2)]: '2k',
        [exponent(4)]: '4k',
        [exponent(8)]: '8k',
        [exponent(16)]: '16k',
        [exponent(32)]: '32k',
        [exponent(64)]: '64k',
        [exponent(80)]: '80k',
      };
    }, []);

    const step = useMemo(() => {
      const current = token ?? 0;

      if (current <= Kibi) return 128;

      if (current < 8 * Kibi) return Kibi;

      return 4 * Kibi;
    }, [token]);

    return (
      <Flexbox horizontal align={'center'} gap={12} paddingInline={'4px 0'}>
        <Flexbox flex={1}>
          <Slider
            marks={marks}
            max={exponent(80)}
            min={exponent(1)}
            step={null}
            tooltip={{ open: false }}
            value={powValue}
            onChange={updateWithPowValue}
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
              updateWithRealValue(e as number);
            }}
          />
        </div>
      </Flexbox>
    );
  },
);

export default ReasoningTokenSlider80k;
