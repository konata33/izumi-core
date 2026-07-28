import {
  createIzumiClient,
  IzumiRequestError,
  type AuthToken,
  type CreatePostInput,
  type Post,
  type PostList,
  type PostStatus,
  type OwnerProfile,
  type ReplaceProfileInput,
  type UpdatePostInput,
} from '@izumi/sdk';

export type {
  AuthToken,
  OwnerProfile,
  Post,
  PostList,
  PostStatus,
  ReplaceProfileInput,
};
export type PostInput = CreatePostInput;
export { IzumiRequestError as CoreRequestError };

const defaultCoreUrl = import.meta.env.DEV
  ? 'http://localhost:3001'
  : window.location.origin;
const baseUrl = (import.meta.env.VITE_CORE_API_URL || defaultCoreUrl).replace(
  /\/+$/,
  '',
);

function client(accessToken?: string) {
  return createIzumiClient({
    baseUrl,
    getAccessToken: () => accessToken,
  });
}

export const core = {
  setupOwner(input: { email: string; password: string }, setupToken: string) {
    return client().setupOwner(input, setupToken);
  },

  login(input: { email: string; password: string }) {
    return client().loginOwner(input);
  },

  listPosts(
    accessToken: string,
    options: { page: number; size: number; status?: PostStatus },
  ) {
    return client(accessToken).listPosts(options);
  },

  getPost(accessToken: string, id: string) {
    return client(accessToken).getPost(id);
  },

  createPost(accessToken: string, input: PostInput) {
    return client(accessToken).createPost(input);
  },

  updatePost(accessToken: string, id: string, input: UpdatePostInput) {
    return client(accessToken).updatePost(id, input);
  },

  getOwnerProfile(accessToken: string) {
    return client(accessToken).getOwnerProfile();
  },

  replaceProfile(accessToken: string, input: ReplaceProfileInput) {
    return client(accessToken).replaceProfile(input);
  },
};
