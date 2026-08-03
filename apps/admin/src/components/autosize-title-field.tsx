import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
} from 'react';

type AutosizeTitleFieldProps = {
  autoFocus?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
  onMoveToContent: () => void;
  value: string;
};

function withoutLineBreaks(value: string) {
  return value.replace(/\r\n?|\n/gu, ' ');
}

export function AutosizeTitleField({
  autoFocus = false,
  invalid = false,
  onChange,
  onMoveToContent,
  value,
}: AutosizeTitleFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useLayoutEffect(resize, [resize, value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    const container = textarea?.parentElement;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [resize]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.key !== 'Enter') return;
    event.preventDefault();
    onMoveToContent();
  }

  return (
    <textarea
      ref={textareaRef}
      id="post-title"
      aria-invalid={invalid || undefined}
      autoComplete="off"
      autoFocus={autoFocus}
      className="mx-write-title"
      name="title"
      placeholder="输入标题…"
      required
      rows={1}
      value={value}
      wrap="soft"
      onChange={(event) => onChange(withoutLineBreaks(event.target.value))}
      onKeyDown={handleKeyDown}
    />
  );
}
