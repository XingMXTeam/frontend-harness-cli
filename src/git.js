import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function isGitRepo(root) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

/** A recorded SHA only counts if this command can resolve it in the actual repo. */
export function verifySha(root, sha) {
  if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  const r = spawnSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], { cwd: root, encoding: 'utf8' });
  return r.status === 0;
}

export function headSha(root) {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function changedFiles(root) {
  const out = new Set();
  for (const args of [['diff', '--name-only', 'HEAD'], ['diff', '--name-only', '--cached'], ['ls-files', '--others', '--exclude-standard']]) {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status === 0) r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).forEach((f) => out.add(f));
  }
  return [...out];
}

export function resolveFromRoot(root, p) {
  return path.isAbsolute(p) ? p : path.join(root, p);
}
