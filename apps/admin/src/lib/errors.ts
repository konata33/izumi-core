import { CoreRequestError } from './core';

function detailsOf(details: unknown): {
  fields?: string[];
  issues?: string[];
  field?: string;
  kind?: string;
} {
  if (!details || typeof details !== 'object') return {};
  const value = details as Record<string, unknown>;
  return {
    fields: Array.isArray(value.fields)
      ? value.fields.filter((field): field is string => typeof field === 'string')
      : undefined,
    issues: Array.isArray(value.issues)
      ? value.issues.filter((issue): issue is string => typeof issue === 'string')
      : undefined,
    field: typeof value.field === 'string' ? value.field : undefined,
    kind: typeof value.kind === 'string' ? value.kind : undefined,
  };
}

export function messageForError(error: unknown): string {
  if (!(error instanceof CoreRequestError)) return '发生了意外错误，请稍后重试。';

  const details = detailsOf(error.details);

  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return '用户名或密码不正确。';
    case 'OWNER_ALREADY_CONFIGURED':
      return '管理员已设置，请登录。';
    case 'POST_PUBLISHING_INCOMPLETE': {
      const fields = details.fields?.map(fieldName).join('、');
      return fields
        ? `发布前请补全：${fields}。`
        : '发布前请补全标题、slug、正文、摘要和栏目。';
    }
    case 'POST_SLUG_CONFLICT':
      return '这个 slug 已被另一篇文章使用，请换一个。';
    case 'POST_NOT_FOUND':
      return '这篇文章不存在，或你已无权访问它。';
    case 'PROFILE_NOT_CONFIGURED':
      return '尚未配置个人资料。填写完整资料后即可保存。';
    case 'PROFILE_FIELD_INVALID':
      return details.field
        ? `${profileFieldName(details.field)}的格式不符合 Core 的要求。`
        : '个人资料字段不符合 Core 的格式要求。';
    case 'PROFILE_LINK_KIND_DUPLICATE':
      return details.kind
        ? `${profileLinkKindName(details.kind)} 只能填写一次。`
        : '同一种个人链接只能填写一次。';
    case 'VALIDATION_ERROR':
      return details.issues?.join('；') || '提交内容不符合 Core 的格式要求。';
    default:
      return error.message || 'Core 未能完成此请求，请稍后重试。';
  }
}

export function fieldName(field: string): string {
  return (
    {
      title: '标题',
      slug: 'slug',
      content: '正文',
      excerpt: '摘要',
      section: '栏目',
    }[field] || field
  );
}

export function profileFieldName(field: string): string {
  return (
    {
      displayName: '显示名称',
      headline: '个人标题',
      bio: '个人简介',
      'avatar.url': '头像地址',
      'avatar.alt': '头像',
      'links.github.url': 'GitHub 地址',
      'links.x.url': 'X 地址',
    }[field] || field
  );
}

export function profileLinkKindName(kind: string): string {
  return { github: 'GitHub', x: 'X' }[kind] || kind;
}
