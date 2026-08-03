import {
  OPEN_IMAGE_UPLOAD_DIALOG_COMMAND,
  extractTextContent,
} from '@haklex/rich-editor/commands';
import { RichEditor } from '@haklex/rich-editor';
import { FloatingToolbarPlugin } from '@haklex/rich-plugin-floating-toolbar';
import { FloatingLinkEditorPlugin } from '@haklex/rich-plugin-link-edit';
import { MentionMenuPlugin } from '@haklex/rich-plugin-mention';
import { SlashMenuPlugin } from '@haklex/rich-plugin-slash-menu';
import {
  TableCellResizerPlugin,
  TableRowColumnHandlesPlugin,
} from '@haklex/rich-plugin-table';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  REDO_COMMAND,
  UNDO_COMMAND,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type SerializedEditorState,
} from 'lexical';
import {
  BlocksIcon,
  ImagePlusIcon,
  Redo2Icon,
  SlashIcon,
  Undo2Icon,
} from 'lucide-react';
import {
  forwardRef,
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { core } from '@/lib/core';
import { getSession } from '@/lib/session';
import { richPostCompatibilityNodes } from '@/components/rich-post-compatibility';

import '@haklex/rich-editor/style.css';
import '@haklex/rich-plugin-floating-toolbar/style.css';
import '@haklex/rich-plugin-link-edit/style.css';
import '@haklex/rich-plugin-mention/style.css';
import '@haklex/rich-plugin-slash-menu/style.css';
import '@haklex/rich-plugin-table/style.css';

export type HaklexEditorSurfaceHandle = {
  focus: () => void;
  getDocument: () => SerializedEditorState | null;
  replaceDocument: (document: SerializedEditorState) => void;
};

type HaklexEditorSurfaceProps = {
  additionalPlugins?: ReactNode;
  additionalToolbar?: ReactNode;
  autoFocus?: boolean;
  extraNodes?: Array<Klass<LexicalNode>>;
  initialValue: SerializedEditorState;
  invalid?: boolean;
  onChange: (document: SerializedEditorState, plainText: string) => void;
  onEnableAdvanced?: () => void;
};

function EditorBridge({
  editorRef,
}: {
  editorRef: MutableRefObject<LexicalEditor | null>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);
  return null;
}

function QuietToolbar({
  advanced,
  children,
  onEnableAdvanced,
}: {
  advanced: boolean;
  children?: ReactNode;
  onEnableAdvanced?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(
    () =>
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (value) => {
          setCanUndo(value);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );
  useEffect(
    () =>
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (value) => {
          setCanRedo(value);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor],
  );

  return (
    <div aria-label="正文工具" className="mx-rich-toolbar" role="toolbar">
      <div className="mx-rich-toolbar-group">
        <button
          aria-label="撤销"
          className="mx-rich-tool"
          disabled={!canUndo}
          title="撤销 ⌘Z"
          type="button"
          onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
        >
          <Undo2Icon />
        </button>
        <button
          aria-label="重做"
          className="mx-rich-tool"
          disabled={!canRedo}
          title="重做 ⇧⌘Z"
          type="button"
          onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
        >
          <Redo2Icon />
        </button>
      </div>
      <span aria-hidden="true" className="mx-rich-toolbar-rule" />
      <button
        className="mx-rich-tool is-labelled"
        type="button"
        onClick={() =>
          editor.dispatchCommand(OPEN_IMAGE_UPLOAD_DIALOG_COMMAND, undefined)
        }
      >
        <ImagePlusIcon />
        <span>图片</span>
      </button>
      {!advanced ? (
        <button
          className="mx-rich-tool is-labelled"
          type="button"
          onClick={onEnableAdvanced}
        >
          <BlocksIcon />
          <span>高级块</span>
        </button>
      ) : null}
      {children}
      <span className="mx-rich-toolbar-hint">
        <SlashIcon aria-hidden="true" />
        输入 / 插入内容
      </span>
    </div>
  );
}

export const HaklexEditorSurface = forwardRef<
  HaklexEditorSurfaceHandle,
  HaklexEditorSurfaceProps
>(function HaklexEditorSurface(
  {
    additionalPlugins,
    additionalToolbar,
    autoFocus,
    extraNodes,
    initialValue,
    invalid,
    onChange,
    onEnableAdvanced,
  },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const initialDocument = useMemo(() => initialValue, [initialValue]);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        editorRef.current?.focus(undefined, { defaultSelection: 'rootStart' });
      },
      getDocument() {
        return editorRef.current?.getEditorState().toJSON() ?? null;
      },
      replaceDocument(document) {
        const editor = editorRef.current;
        if (!editor) return;
        editor.setEditorState(editor.parseEditorState(JSON.stringify(document)));
        editor.focus(undefined, { defaultSelection: 'rootEnd' });
      },
    }),
    [],
  );

  async function uploadImage(file: File) {
    const session = getSession();
    if (!session) throw new Error('登录状态已失效。');
    const asset = await core.uploadMedia(session.accessToken, file, {
      alt: file.name,
    });
    return {
      src: asset.url,
      altText: asset.alt || file.name,
      width: asset.width,
      height: asset.height,
      thumbhash: asset.thumbhash,
    };
  }

  async function uploadVideo(
    file: File,
    options?: { onProgress?: (percent: number) => void },
  ) {
    const session = getSession();
    if (!session) throw new Error('登录状态已失效。');
    options?.onProgress?.(0);
    const asset = await core.uploadMedia(session.accessToken, file, {
      alt: file.name,
    });
    options?.onProgress?.(100);
    return { src: asset.url };
  }

  return (
    <div
      aria-invalid={invalid || undefined}
      className={`mx-rich-post-editor${invalid ? ' is-invalid' : ''}`}
    >
      <RichEditor
        autoFocus={autoFocus}
        className="mx-rich-editor"
        contentClassName="mx-rich-content"
        debounceMs={120}
        extraNodes={[...richPostCompatibilityNodes, ...(extraNodes ?? [])]}
        header={
          <QuietToolbar
            advanced={Boolean(extraNodes?.length)}
            onEnableAdvanced={onEnableAdvanced}
          >
            {additionalToolbar}
          </QuietToolbar>
        }
        imageUpload={uploadImage}
        initialValue={initialDocument}
        placeholder="开始写作…"
        theme="dark"
        variant="article"
        videoUpload={uploadVideo}
        onChange={(document) => onChange(document, extractTextContent(document))}
      >
        <EditorBridge editorRef={editorRef} />
        <SlashMenuPlugin />
        <FloatingToolbarPlugin />
        <FloatingLinkEditorPlugin />
        <MentionMenuPlugin />
        <TableCellResizerPlugin />
        <TableRowColumnHandlesPlugin />
        {additionalPlugins}
      </RichEditor>
    </div>
  );
});
