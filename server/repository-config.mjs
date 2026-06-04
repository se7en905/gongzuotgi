export const DEFAULT_GIT_CONFIG = {
  remoteUrl: '',
  defaultBaseBranch: ''
};

export function normalizeGitConfig(input = {}) {
  return {
    remoteUrl: String(input.remoteUrl || DEFAULT_GIT_CONFIG.remoteUrl).trim().replace(/\/+$/, ''),
    defaultBaseBranch: String(input.defaultBaseBranch || DEFAULT_GIT_CONFIG.defaultBaseBranch).trim() || DEFAULT_GIT_CONFIG.defaultBaseBranch
  };
}
