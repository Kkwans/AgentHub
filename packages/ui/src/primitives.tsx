import { Button, Select, Switch, type ButtonProps, type SelectProps } from '@mantine/core';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

export type AhButtonProps = ButtonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color' | 'style' | 'size'> & {
    children: ReactNode;
  };

export function AhButton({ children, ...props }: AhButtonProps) {
  return (
    <Button radius="md" {...props}>
      {children}
    </Button>
  );
}

export function AhSelect({ label, description, ...props }: SelectProps) {
  return (
    <Select label={label} description={description} searchable clearable radius="md" {...props} />
  );
}

export function AhSwitch({ label, description, ...props }: ComponentProps<typeof Switch>) {
  return <Switch label={label} description={description} color="aurora" {...props} />;
}

export interface AhChoiceOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function AhChoiceSelect({
  options,
  onValueChange,
  ...props
}: Omit<SelectProps, 'data' | 'onChange'> & {
  label: string;
  options: AhChoiceOption[];
  onValueChange?: (value: string) => void;
}) {
  return (
    <AhSelect
      {...props}
      data={options.map((option) => ({
        value: option.value,
        label: option.description ? `${option.label} · ${option.description}` : option.label,
        ...(option.disabled === undefined ? {} : { disabled: option.disabled }),
      }))}
      onChange={(value) => {
        if (value !== null) onValueChange?.(value);
      }}
    />
  );
}
