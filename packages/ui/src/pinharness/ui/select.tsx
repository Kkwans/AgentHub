import * as RadixSelect from '@radix-ui/react-select';
import { CaretDownIcon } from '@phosphor-icons/react/CaretDown';
import { CheckIcon } from '@phosphor-icons/react/Check';
import type * as React from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

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
  /** 打开下拉层时显示轻量筛选输入，保留旧 AgentHub Select 的搜索行为。 */
  searchable?: boolean;
  /** 在有值时提供一个清除项，不嵌套第二个 button，保持 Radix 语义。 */
  clearable?: boolean;
  noResultsLabel?: string;
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
  searchable = false,
  clearable = false,
  noResultsLabel = '没有匹配项',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const hasEmptyOption = options.some((option) => option.value === '');
  const optionsWithClear =
    clearable && value && !hasEmptyOption
      ? [{ value: '', label: '清除选择' }, ...options]
      : options;
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!searchable || !normalized) return optionsWithClear;
    return optionsWithClear.filter((option) =>
      [option.label, option.value, option.description, option.group]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [optionsWithClear, query, searchable]);
  const hasFilteredOptions = filteredOptions.length > 0;
  const radixValue =
    value === '' && (hasEmptyOption || clearable) ? EMPTY_OPTION_VALUE : value || undefined;

  useEffect(() => {
    if (!open || !searchable) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, searchable]);

  return (
    <RadixSelect.Root
      {...(radixValue === undefined ? {} : { value: radixValue })}
      onValueChange={(nextValue) =>
        onValueChange(nextValue === EMPTY_OPTION_VALUE ? '' : nextValue)
      }
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery('');
      }}
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
          {searchable ? (
            <div
              className="border-b border-[hsl(var(--border))]/70 px-2 pb-2 pt-1"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <input
                ref={searchRef}
                value={query}
                role="searchbox"
                aria-label="搜索选项"
                placeholder="搜索选项…"
                className="h-8 w-full rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-muted))]/60 px-2.5 text-sm text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--foreground-faint))] focus:border-[hsl(var(--primary))]/45 focus:ring-2 focus:ring-[hsl(var(--primary))]/15"
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setOpen(false);
                    return;
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    const firstItem = event.currentTarget
                      .closest('[data-radix-select-content]')
                      ?.querySelector<HTMLElement>('[role="option"]:not([data-disabled])');
                    firstItem?.focus();
                    return;
                  }
                  if (event.key === 'Enter' && filteredOptions[0]) {
                    event.preventDefault();
                    onValueChange(filteredOptions[0].value);
                    setOpen(false);
                    setQuery('');
                  }
                }}
              />
            </div>
          ) : null}
          <RadixSelect.Viewport>
            {hasFilteredOptions ? (
              filteredOptions.map((option, index) => {
                const showGroupLabel =
                  !!option.group && filteredOptions[index - 1]?.group !== option.group;
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
              })
            ) : (
              <div className="px-3 py-3 text-center text-xs text-[hsl(var(--foreground-muted))]">
                {noResultsLabel}
              </div>
            )}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
