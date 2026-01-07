import { Center, Checkbox, Flexbox, Icon } from '@lobehub/ui';
import { Loader2 } from 'lucide-react';
import { type ReactNode, memo, useState } from 'react';

export interface CheckboxItemProps {
  checked?: boolean;
  /**
   * Whether the checkbox is disabled (cannot be toggled)
   */
  disabled?: boolean;
  hasPadding?: boolean;
  id: string;
  label?: ReactNode;
  onUpdate: (id: string, enabled: boolean) => Promise<void>;
}

const CheckboxItem = memo<CheckboxItemProps>(
  ({ id, onUpdate, label, checked, disabled, hasPadding = true }) => {
    const [loading, setLoading] = useState(false);

    const updateState = async () => {
      if (disabled) return;
      setLoading(true);
      await onUpdate(id, !checked);
      setLoading(false);
    };

    return (
      <Flexbox
        align={'center'}
        gap={24}
        horizontal
        justify={'space-between'}
        onClick={async (e) => {
          e.stopPropagation();
          if (!disabled) updateState();
        }}
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          ...(hasPadding
            ? {
                paddingLeft: 8,
              }
            : {}),
        }}
      >
        {label || id}
        {loading ? (
          <Center width={18}>
            <Icon icon={Loader2} spin />
          </Center>
        ) : (
          <Checkbox
            checked={checked}
            disabled={disabled}
            onClick={async (e) => {
              e.stopPropagation();
              if (!disabled) await updateState();
            }}
          />
        )}
      </Flexbox>
    );
  },
);

export default CheckboxItem;
