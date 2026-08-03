import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $applyNodeReplacement,
  $getNodeByKey,
  $insertNodes,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  DecoratorNode,
} from 'lexical';
import { FileInputIcon } from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from 'react';

export type SerializedPostReferenceNode = Spread<
  {
    postId: string;
  },
  SerializedLexicalNode
>;

function PostReferenceEditor({
  editor,
  nodeKey,
  postId,
}: {
  editor: LexicalEditor;
  nodeKey: NodeKey;
  postId: string;
}) {
  if (!editor.isEditable()) {
    return (
      <span className="mx-post-reference is-static">
        <FileInputIcon aria-hidden="true" />
        <span>
          <strong>站内文章</strong>
          <span>{postId || '引用不可用'}</span>
        </span>
      </span>
    );
  }

  function changePostId(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value.replace(/\s/gu, '');
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isPostReferenceNode(node)) node.setPostId(value);
    });
  }

  return (
    <span className="mx-post-reference">
      <FileInputIcon aria-hidden="true" />
      <span>
        <strong>站内文章</strong>
        <input
          aria-label="被引用文章 ID"
          placeholder="粘贴文章 ID"
          spellCheck={false}
          value={postId}
          onChange={changePostId}
        />
      </span>
    </span>
  );
}

export class PostReferenceNode extends DecoratorNode<ReactElement> {
  __postId: string;

  static getType(): string {
    return 'post-reference';
  }

  static clone(node: PostReferenceNode): PostReferenceNode {
    return new PostReferenceNode(node.__postId, node.__key);
  }

  static importJSON(serializedNode: SerializedPostReferenceNode): PostReferenceNode {
    return $createPostReferenceNode(serializedNode.postId);
  }

  constructor(postId: string, key?: NodeKey) {
    super(key);
    this.__postId = postId;
  }

  createDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'mx-post-reference-shell';
    return element;
  }

  updateDOM(): false {
    return false;
  }

  exportJSON(): SerializedPostReferenceNode {
    return {
      ...super.exportJSON(),
      postId: this.__postId,
      type: 'post-reference',
      version: 1,
    };
  }

  getTextContent(): string {
    return this.__postId ? `[站内文章：${this.__postId}]` : '[站内文章]';
  }

  setPostId(postId: string): void {
    this.getWritable().__postId = postId;
  }

  decorate(editor: LexicalEditor): ReactElement {
    return (
      <PostReferenceEditor
        editor={editor}
        nodeKey={this.__key}
        postId={this.__postId}
      />
    );
  }
}

export function $createPostReferenceNode(postId = ''): PostReferenceNode {
  return $applyNodeReplacement(new PostReferenceNode(postId));
}

export function $isPostReferenceNode(
  node: LexicalNode | null | undefined,
): node is PostReferenceNode {
  return node instanceof PostReferenceNode;
}

export function PostReferenceToolbarButton() {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [postId, setPostId] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  function insert() {
    const normalized = postId.trim();
    if (!normalized) return;
    editor.update(() => {
      $insertNodes([$createPostReferenceNode(normalized)]);
    });
    setPostId('');
    close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="mx-rich-tool is-labelled"
        type="button"
        onClick={() => setOpen(true)}
      >
        <FileInputIcon />
        <span>站内文章</span>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="post-reference-title"
        className="mx-reference-dialog"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => setOpen(false)}
      >
        <div className="mx-reference-dialog-content">
          <p className="mx-page-kicker">内部关联</p>
          <h2 id="post-reference-title">引用一篇已发布文章</h2>
          <p>粘贴目标文章 ID。发布时 Core 会确认目标仍可公开访问。</p>
          <label htmlFor="post-reference-id">文章 ID</label>
          <input
            autoFocus
            id="post-reference-id"
            className="mx-control"
            placeholder="例如：01J…"
            spellCheck={false}
            value={postId}
            onChange={(event) => setPostId(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.nativeEvent.isComposing || event.key !== 'Enter') return;
              event.preventDefault();
              insert();
            }}
          />
          <div className="mx-reference-dialog-actions">
            <button className="mx-button is-secondary" type="button" onClick={close}>
              取消
            </button>
            <button
              className="mx-button is-primary"
              disabled={!postId.trim()}
              type="button"
              onClick={insert}
            >
              插入引用
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
