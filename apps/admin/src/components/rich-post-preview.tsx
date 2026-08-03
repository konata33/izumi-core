import { composeRenderer, type RichRendererModule } from '@haklex/rich-compose';
import { alertModule } from '@haklex/rich-compose/modules/alert';
import { bannerModule } from '@haklex/rich-compose/modules/banner';
import { imageModule } from '@haklex/rich-compose/modules/image';
import { linkCardModule } from '@haklex/rich-compose/modules/link-card';
import { mentionModule } from '@haklex/rich-compose/modules/mention';
import { rubyModule } from '@haklex/rich-compose/modules/ruby';
import { videoModule } from '@haklex/rich-compose/modules/video';
import { useQuery } from '@tanstack/react-query';
import type { SerializedEditorState } from 'lexical';
import { useEffect, useMemo, useState } from 'react';

import {
  PostReferenceProvider,
  PostReferenceStaticNode,
  type ResolvedPostReference,
} from '@/components/post-reference-static-node';
import {
  richPostBuiltinNodeOverrides,
  richPostCompatibilityModule,
} from '@/components/rich-post-compatibility';
import {
  type PreviewExtensionGroup,
  previewRequirementsForDocument,
} from '@/components/rich-post-preview-groups';
import { core } from '@/lib/core';

type PreviewExtensionBundle = { modules: RichRendererModule[] };

const extensionLoaders: Record<
  PreviewExtensionGroup,
  () => Promise<PreviewExtensionBundle>
> = {
  ai: () => import('@/components/rich-post-preview-extension-ai'),
  canvas: () => import('@/components/rich-post-preview-extension-canvas'),
  code: () => import('@/components/rich-post-preview-extension-code'),
  diagram: () => import('@/components/rich-post-preview-extension-diagram'),
  light: () => import('@/components/rich-post-preview-extension-light'),
};

const baseModules: RichRendererModule[] = [
  alertModule,
  bannerModule,
  imageModule,
  linkCardModule,
  mentionModule,
  rubyModule,
  videoModule,
  richPostCompatibilityModule,
  {
    name: 'izumi-post-reference',
    nodes: [PostReferenceStaticNode],
  },
];

export default function RichPostPreview({
  document,
  accessToken,
  title,
}: {
  accessToken: string;
  document: SerializedEditorState;
  title: string;
}) {
  const requirements = useMemo(
    () => previewRequirementsForDocument(document),
    [document],
  );
  const groupKey = requirements.groups.join(':');
  const [bundles, setBundles] = useState<
    Partial<Record<PreviewExtensionGroup, PreviewExtensionBundle>>
  >({});
  const [loadFailed, setLoadFailed] = useState(false);
  const referenceQuery = useQuery({
    queryKey: ['post-reference-preview', requirements.postReferenceIds],
    queryFn: ({ signal }) =>
      core.resolvePostReferences(accessToken, requirements.postReferenceIds, signal),
    enabled: requirements.postReferenceIds.length > 0,
  });

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void Promise.all(
      requirements.groups.map(
        async (group) => [group, await extensionLoaders[group]()] as const,
      ),
    )
      .then((loaded) => {
        if (!active) return;
        setBundles((current) => ({
          ...current,
          ...Object.fromEntries(loaded),
        }));
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [groupKey]);

  const references = useMemo<
    ReadonlyMap<string, ResolvedPostReference> | undefined
  >(() => {
    if (requirements.postReferenceIds.length === 0) return new Map();
    if (!referenceQuery.data) return undefined;
    return new Map(
      referenceQuery.data.map((reference) => [
        reference.postId,
        {
          href: core.publicPostUrl(reference.slug),
          slug: reference.slug,
          title: reference.title,
        },
      ]),
    );
  }, [referenceQuery.data, requirements.postReferenceIds.length]);

  const loadedBundles = useMemo(
    () =>
      requirements.groups
        .map((group) => bundles[group])
        .filter(Boolean) as PreviewExtensionBundle[],
    [bundles, groupKey],
  );
  const ready =
    loadedBundles.length === requirements.groups.length && references !== undefined;
  const RichContentRenderer = useMemo(
    () =>
      ready && requirements.unsupportedNodeTypes.length === 0
        ? composeRenderer({
            builtinNodeOverrides: richPostBuiltinNodeOverrides,
            modules: [
              ...baseModules,
              ...loadedBundles.flatMap((bundle) => bundle.modules),
            ],
          })
        : null,
    [groupKey, loadedBundles, ready, requirements.unsupportedNodeTypes.length],
  );

  return (
    <article className="mx-rich-preview">
      <h2>{title.trim() || '未命名文章'}</h2>
      {requirements.unsupportedNodeTypes.length > 0 ? (
        <p className="mx-rich-preview-status" role="alert">
          预览包含当前版本无法安全显示的内容块。
        </p>
      ) : loadFailed ? (
        <p className="mx-rich-preview-status" role="alert">
          高级内容预览载入失败，请稍后重试。
        </p>
      ) : referenceQuery.isError ? (
        <p className="mx-rich-preview-status" role="alert">
          站内文章引用解析失败，请稍后重试。
        </p>
      ) : RichContentRenderer ? (
        <PostReferenceProvider references={references!}>
          <RichContentRenderer
            className="mx-rich-preview-content"
            theme="dark"
            value={document}
            variant="article"
          />
        </PostReferenceProvider>
      ) : (
        <p aria-busy="true" className="mx-rich-preview-status" aria-live="polite">
          正在载入文章内容…
        </p>
      )}
    </article>
  );
}
