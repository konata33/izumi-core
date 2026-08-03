import type { SerializedEditorState } from 'lexical';
import {
  forwardRef,
  lazy,
  Suspense,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  HaklexEditorSurface,
  type HaklexEditorSurfaceHandle,
} from '@/components/haklex-editor-surface';
import type { AdvancedExtensionGroup } from '@/components/rich-post-editor-advanced';
import { documentBeforeExtensionRemount } from '@/lib/editor-state';

const AdvancedHaklexEditor = lazy(
  () => import('@/components/rich-post-editor-advanced'),
);

export type RichPostEditorHandle = {
  focus: () => void;
  replaceDocument: (document: SerializedEditorState) => void;
};

type RichPostEditorProps = {
  autoFocus?: boolean;
  initialValue: SerializedEditorState;
  invalid?: boolean;
  onChange: (document: SerializedEditorState, plainText: string) => void;
};

export const IZUMI_ALLOWED_RICH_MODULES = [
  'haklex-core',
  'chat-snapshot',
  'code-snippet',
  'embed',
  'excalidraw',
  'gallery',
  'nested-doc',
  'post-reference',
] as const;

const groupByNodeType = new Map<string, AdvancedExtensionGroup>([
  ['chat', 'ai'],
  ['code-snippet', 'code'],
  ['embed', 'light'],
  ['excalidraw', 'canvas'],
  ['gallery', 'light'],
  ['nested-doc', 'light'],
  ['post-reference', 'light'],
]);

function extensionGroupsForDocument(
  value: unknown,
  groups = new Set<AdvancedExtensionGroup>(),
): Set<AdvancedExtensionGroup> {
  if (!value || typeof value !== 'object') return groups;
  if ('type' in value && typeof value.type === 'string') {
    const group = groupByNodeType.get(value.type);
    if (group) groups.add(group);
  }
  for (const nested of Object.values(value)) {
    extensionGroupsForDocument(nested, groups);
  }
  return groups;
}

export const RichPostEditor = forwardRef<RichPostEditorHandle, RichPostEditorProps>(
  function RichPostEditor({ autoFocus, initialValue, invalid, onChange }, ref) {
    const editorRef = useRef<HaklexEditorSurfaceHandle>(null);
    const [groups, setGroups] = useState(() =>
      extensionGroupsForDocument(initialValue),
    );
    const groupsRef = useRef(groups);
    groupsRef.current = groups;
    const [latestDocument, setLatestDocument] = useState(initialValue);
    const initialDocument = useMemo(() => latestDocument, [latestDocument]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editorRef.current?.focus(),
        replaceDocument: (document) => {
          setLatestDocument(document);
          const requiredGroups = extensionGroupsForDocument(document);
          const hasMissingGroup = [...requiredGroups].some(
            (group) => !groupsRef.current.has(group),
          );
          setGroups((current) => {
            const next = new Set(current);
            for (const group of requiredGroups) next.add(group);
            return next;
          });
          if (!hasMissingGroup) {
            requestAnimationFrame(() => editorRef.current?.replaceDocument(document));
          }
        },
      }),
      [],
    );

    function handleChange(document: SerializedEditorState, plainText: string) {
      setLatestDocument(document);
      onChange(document, plainText);
    }

    const common = {
      autoFocus,
      initialValue: initialDocument,
      invalid,
      onChange: handleChange,
    };

    if (groups.size > 0) {
      return (
        <Suspense
          fallback={
            <div className="mx-rich-editor-loading" aria-busy="true">
              正在载入高级内容工具…
            </div>
          }
        >
          <AdvancedHaklexEditor
            ref={editorRef}
            {...common}
            groups={[...groups]}
            onEnableGroup={(group, currentDocument) => {
              if (currentDocument) setLatestDocument(currentDocument);
              setGroups((current) => new Set(current).add(group));
            }}
          />
        </Suspense>
      );
    }

    return (
      <HaklexEditorSurface
        ref={editorRef}
        {...common}
        onEnableAdvanced={() => {
          setLatestDocument(
            documentBeforeExtensionRemount(
              latestDocument,
              editorRef.current?.getDocument() ?? null,
            ),
          );
          setGroups(new Set(['light']));
        }}
      />
    );
  },
);

export default RichPostEditor;
