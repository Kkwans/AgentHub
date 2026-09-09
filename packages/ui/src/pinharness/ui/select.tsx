import * as RadixSelect from '@radix-ui/react-select';
import { CaretDownIcon } from '@phosphor-icons/react/CaretDown';
import { CheckIcon } from '@phosphor-icons/react/Check';
import type * as React from 'react';
import { Fragment } from 'react';

import { cn } from './cn.js';

export interface PinSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  group?: string;
}

export interface SelectProps {
  value?: string;
  onValueChange: (value: string) => void;
  options: PinSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}

const EMPTY_OPTION_VALUE = '__agenthub_select_empty__';

/**
 * PinHarness Select 基座（Radix UI），保留受控值、分组、描述和键盘语义。
 * 领域页面只传入已经翻译的 options，不把供应商类型带进共享包。
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = '请选择',
  disabled,
  className,
  id,
  ariaLabel,
  ariaDescribedBy,
  ariaInvalid,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  'aria-required': required,
}: SelectProps) {
  const hasEmptyOption = options.some((option) => option.value === '');
  const radixValue = value === '' && hasEmptyOption ? EMPTY_OPTION_VALUE : value || undefined;

  return (
    <RadixSelect.Root
      {...(radixValue === undefined ? {} : { value: radixValue })}
      onValueChange={(nextValue) =>
        onValueChange(nextValue === EMPTY_OPTION_VALUE ? '' : nextValue)
      }
      {...(disabled === undefined ? {} : { disabled })}
    >
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={describedBy ?? ariaDescribedBy}
        aria-invalid={invalid ?? ariaInvalid}
        aria-required={required}
        className={cn(
          'input-base flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-[16px] outline-none transition-shadow duration-[var(--motion-fast)] ease-[var(--ease-standard)] data-[placeholder]:text-[hsl(var(--placeholder-foreground))] focus:ring-2 focus:ring-[hsl(var(--ring))]/30 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 sm:text-[length:var(--text-base)]',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <CaretDownIcon className="h-3.5 w-3.5 opacity-60" aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={5}
          className="z-[100] max-h-72 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1 shadow-[var(--shadow-lg)] animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1"
        >
          <RadixSelect.Viewport>
            {options.map((option, index) => {
              const showGroupLabel = !!option.group && options[index - 1]?.group !== option.group;
              const item = (
                <RadixSelect.Item
                  value={option.value || EMPTY_OPTION_VALUE}
                  {...(option.disabled === undefined ? {} : { disabled: option.disabled })}
                  className="group relative flex cursor-pointer select-none items-center rounded-[var(--radius-md)] px-3 py-2.5 text-[length:var(--text-sm)] text-[hsl(var(--foreground))] outline-none transition-colors duration-[var(--motion-fast)] data-[highlighted]:bg-[hsl(var(--surface-muted))] data-[state=checked]:bg-[hsl(var(--primary-soft))]/45 data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
                >
                  <span className="min-w-0 flex-1 pr-7">
                    <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                    {option.description ? (
                      <span className="mt-0.5 block truncate text-xs leading-4 text-[hsl(var(--foreground-muted))]">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  <span className="absolute right-3 flex h-5 w-5 items-center justify-center text-[hsl(var(--primary))] opacity-0 transition-opacity group-data-[state=checked]:opacity-100">
                    <RadixSelect.ItemIndicator>
                      <CheckIcon className="h-4 w-4" weight="bold" aria-hidden />
                    </RadixSelect.ItemIndicator>
                  </span>
                </RadixSelect.Item>
              );

              if (!option.group)
                return <Fragment key={option.value || EMPTY_OPTION_VALUE}>{item}</Fragment>;

              return (
                <RadixSelect.Group key={option.value || EMPTY_OPTION_VALUE}>
                  {showGroupLabel ? (
                    <RadixSelect.Label className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                      {option.group}
                    </RadixSelect.Label>
                  ) : null}
                  {item}
                </RadixSelect.Group>
              );
            })}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
