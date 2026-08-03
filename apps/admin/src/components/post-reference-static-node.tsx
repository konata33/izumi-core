import {
  $applyNodeReplacement,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  DecoratorNode,
} from 'lexical';
import { FileInputIcon } from 'lucide-react';
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

export type ResolvedPostReference = {
  href: string;
  slug: string;
  title: string;
};

const PostReferenceContext = createContext<ReadonlyMap<string, ResolvedPostReference>>(
  new Map(),
);

export function PostReferenceProvider({
  children,
  references,
}: {
  children: ReactNode;
  references: ReadonlyMap<string, ResolvedPostReference>;
}) {
  return (
    <PostReferenceContext.Provider value={references}>
      {children}
    </PostReferenceContext.Provider>
  );
}

export function ResolvedPostReferenceView({ postId }: { postId: string }) {
  const reference = useContext(PostReferenceContext).get(postId);
  if (!reference) {
    return (
      <span className="mx-post-reference is-static is-unavailable">
        <FileInputIcon aria-hidden="true" />
        <span>
          <strong>引用不可用</strong>
          <span>目标文章未发布或已下线</span>
        </span>
      </span>
    );
  }

  return (
    <a
      aria-label={`打开已发布文章：${reference.title}`}
      className="mx-post-reference is-static"
      href={reference.href}
      rel="noreferrer"
      target="_blank"
    >
      <FileInputIcon aria-hidden="true" />
      <span>
        <strong>{reference.title}</strong>
        <span>/{reference.slug} · 公开快照</span>
      </span>
    </a>
  );
}

export type SerializedPostReferenceStaticNode = Spread<
  {
    postId: string;
  },
  SerializedLexicalNode
>;

export class PostReferenceStaticNode extends DecoratorNode<ReactElement> {
  __postId: string;

  static getType(): string {
    return 'post-reference';
  }

  static clone(node: PostReferenceStaticNode): PostReferenceStaticNode {
    return new PostReferenceStaticNode(node.__postId, node.__key);
  }

  static importJSON(
    serializedNode: SerializedPostReferenceStaticNode,
  ): PostReferenceStaticNode {
    return $createPostReferenceStaticNode(serializedNode.postId);
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

  exportJSON(): SerializedPostReferenceStaticNode {
    return {
      ...super.exportJSON(),
      postId: this.__postId,
      type: 'post-reference',
      version: 1,
    };
  }

  getTextContent(): string {
    return '[站内文章引用]';
  }

  decorate(): ReactElement {
    return <ResolvedPostReferenceView postId={this.__postId} />;
  }
}

export function $createPostReferenceStaticNode(postId = ''): PostReferenceStaticNode {
  return $applyNodeReplacement(new PostReferenceStaticNode(postId));
}

export function $isPostReferenceStaticNode(
  node: LexicalNode | null | undefined,
): node is PostReferenceStaticNode {
  return node instanceof PostReferenceStaticNode;
}
