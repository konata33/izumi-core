import { useRef, type KeyboardEvent } from 'react';

export type FilterStatus = 'all' | 'draft' | 'published';

type StatusFilterProps = {
  disabled?: boolean;
  onValueChange: (value: FilterStatus) => void;
  value: FilterStatus;
};

const options: ReadonlyArray<{ label: string; value: FilterStatus }> = [
  { label: '全部', value: 'all' },
  { label: '草稿', value: 'draft' },
  { label: '已发布', value: 'published' },
];

export function StatusFilter({
  disabled = false,
  onValueChange,
  value,
}: StatusFilterProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectAt(index: number) {
    const option = options[index];
    if (!option) return;
    itemRefs.current[index]?.focus();
    onValueChange(option.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      nextIndex = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      nextIndex = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = options.length - 1;

    if (nextIndex === undefined) return;
    event.preventDefault();
    selectAt(nextIndex);
  }

  return (
    <div
      aria-label="文章状态筛选"
      aria-orientation="horizontal"
      className="mx-status-filter"
      role="radiogroup"
    >
      {options.map((option, index) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            aria-checked={selected}
            className="mx-status-filter-option"
            disabled={disabled}
            role="radio"
            tabIndex={selected ? 0 : -1}
            type="button"
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span>{option.label}</span>
            <span aria-hidden="true" className="mx-status-filter-mark" />
          </button>
        );
      })}
    </div>
  );
}
