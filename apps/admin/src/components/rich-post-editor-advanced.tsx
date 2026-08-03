import type { Klass, LexicalNode, SerializedEditorState } from 'lexical';
import {
  BlocksIcon,
  Code2Icon,
  MessageSquareMoreIcon,
  PencilRulerIcon,
} from 'lucide-react';
import {
  type ComponentType,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  HaklexEditorSurface,
  type HaklexEditorSurfaceHandle,
} from '@/components/haklex-editor-surface';

export type AdvancedExtensionGroup = 'ai' | 'canvas' | 'code' | 'light';

type ExtensionBundle = {
  nodes: Array<Klass<LexicalNode>>;
  Plugins?: ComponentType;
  Toolbar?: ComponentType;
};

const extensionLoaders: Record<AdvancedExtensionGroup, () => Promise<ExtensionBundle>> =
  {
    ai: () => import('@/components/rich-post-extension-ai'),
    canvas: () => import('@/components/rich-post-extension-canvas'),
    code: () => import('@/components/rich-post-extension-code'),
    light: () => import('@/components/rich-post-extension-light'),
  };

const groupChoices: Array<{
  group: AdvancedExtensionGroup;
  icon: ComponentType;
  label: string;
}> = [
  { group: 'light', icon: BlocksIcon, label: '内容块' },
  { group: 'code', icon: Code2Icon, label: '代码' },
  { group: 'canvas', icon: PencilRulerIcon, label: '画布' },
  { group: 'ai', icon: MessageSquareMoreIcon, label: '对话' },
];

type AdvancedHaklexEditorProps = {
  autoFocus?: boolean;
  groups: AdvancedExtensionGroup[];
  initialValue: SerializedEditorState;
  invalid?: boolean;
  onChange: (document: SerializedEditorState, plainText: string) => void;
  onEnableGroup: (
    group: AdvancedExtensionGroup,
    currentDocument: SerializedEditorState | null,
  ) => void;
};

const AdvancedHaklexEditor = forwardRef<
  HaklexEditorSurfaceHandle,
  AdvancedHaklexEditorProps
>(function AdvancedHaklexEditor(
  { groups, initialValue, onEnableGroup, ...props },
  ref,
) {
  const surfaceRef = useRef<HaklexEditorSurfaceHandle>(null);
  const [bundles, setBundles] = useState<
    Partial<Record<AdvancedExtensionGroup, ExtensionBundle>>
  >({});
  const groupKey = groups.slice().sort().join(':');

  useImperativeHandle(
    ref,
    () => ({
      focus: () => surfaceRef.current?.focus(),
      getDocument: () => surfaceRef.current?.getDocument() ?? null,
      replaceDocument: (document) => surfaceRef.current?.replaceDocument(document),
    }),
    [],
  );

  useEffect(() => {
    let active = true;
    void Promise.all(
      groups.map(async (group) => [group, await extensionLoaders[group]()] as const),
    ).then((loaded) => {
      if (!active) return;
      setBundles((current) => ({
        ...current,
        ...Object.fromEntries(loaded),
      }));
    });
    return () => {
      active = false;
    };
  }, [groupKey]);

  const loadedBundles = useMemo(
    () => groups.map((group) => bundles[group]).filter(Boolean) as ExtensionBundle[],
    [bundles, groupKey],
  );

  if (loadedBundles.length !== groups.length) {
    return (
      <div className="mx-rich-editor-loading" aria-busy="true">
        正在载入所需内容工具…
      </div>
    );
  }

  const nodes = loadedBundles.flatMap((bundle) => bundle.nodes);

  return (
    <HaklexEditorSurface
      key={groupKey}
      ref={surfaceRef}
      {...props}
      extraNodes={nodes}
      initialValue={initialValue}
      additionalPlugins={
        <>
          {loadedBundles.map((bundle, index) => {
            const Plugins = bundle.Plugins;
            return Plugins ? <Plugins key={`plugins-${groups[index]}`} /> : null;
          })}
        </>
      }
      additionalToolbar={
        <>
          {loadedBundles.map((bundle, index) => {
            const Toolbar = bundle.Toolbar;
            return Toolbar ? <Toolbar key={`toolbar-${groups[index]}`} /> : null;
          })}
          {groupChoices.map(({ group, icon: Icon, label }) => {
            const enabled = groups.includes(group);
            return (
              <button
                key={group}
                aria-pressed={enabled}
                className="mx-rich-tool is-labelled"
                disabled={enabled}
                title={enabled ? `${label}工具已载入` : `载入${label}工具`}
                type="button"
                onClick={() =>
                  onEnableGroup(group, surfaceRef.current?.getDocument() ?? null)
                }
              >
                <Icon />
                <span>{label}</span>
              </button>
            );
          })}
        </>
      }
    />
  );
});

export default AdvancedHaklexEditor;
