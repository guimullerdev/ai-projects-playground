// "Is there unregistered work sitting in this repo right now?" — dirty
// worktree, commits ahead of upstream, and stash entries. This is what turns
// an empty day in the gaps panel into an actionable line instead of just
// a red mark (see plan.md § Painel de lacunas).

const path = require('path');
const { execFile } = require('child_process');

function run(repoPath, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoPath, ...args], { maxBuffer: 1024 * 1024 * 8 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

const AUTHOR_DATE_RE = /^(\d{4}-\d{2}-\d{2})T/;

function parseCommitLines(stdout) {
  if (!stdout) return [];
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, ad, msg] = line.split('\t');
      const m = AUTHOR_DATE_RE.exec(ad || '');
      return { hash, date: m ? m[1] : null, msg };
    });
}

/**
 * Pending work for one repo: dirty files (+ oldest mtime, as a proxy for
 * "since when"), commits ahead of the upstream branch, and stash entries.
 * Every field degrades to empty/null rather than throwing — a repo with no
 * upstream, or not a repo at all, just reports "nothing pending" on that axis.
 */
async function getRepoPendingWork(repoPath) {
  const fs = require('fs');
  const repo = path.basename(repoPath);

  const [statusOut, unpushedOut, stashOut] = await Promise.all([
    run(repoPath, ['status', '--porcelain']),
    run(repoPath, ['log', '@{u}..HEAD', '--pretty=format:%H%x09%ad%x09%s', '--date=iso-strict']),
    run(repoPath, ['stash', 'list', '--date=iso-strict', '--pretty=format:%H%x09%ad%x09%gs']),
  ]);

  const dirtyFiles = statusOut ? statusOut.split('\n').filter(Boolean) : [];
  let oldestDirtyDate = null;
  for (const line of dirtyFiles) {
    // porcelain quotes paths with spaces/special chars in double quotes —
    // strip them so the mtime lookup below hits the real file.
    let file = line.slice(3).trim();
    if (file.startsWith('"') && file.endsWith('"')) file = file.slice(1, -1);
    // a rename shows as "old -> new"; the mtime we want is the new path.
    const arrow = file.indexOf(' -> ');
    if (arrow !== -1) file = file.slice(arrow + 4);
    try {
      const stat = fs.statSync(path.join(repoPath, file));
      const d = stat.mtime.toISOString().slice(0, 10);
      if (!oldestDirtyDate || d < oldestDirtyDate) oldestDirtyDate = d;
    } catch {
      // file deleted/renamed/unreadable — skip, dirty count still reflects it
    }
  }

  const unpushedCommits = parseCommitLines(unpushedOut);
  const stashes = parseCommitLines(stashOut);

  return {
    repo,
    repoPath,
    dirtyCount: dirtyFiles.length,
    oldestDirtyDate,
    unpushedCommits,
    stashes,
    hasPending: dirtyFiles.length > 0 || unpushedCommits.length > 0 || stashes.length > 0,
  };
}

async function getPendingForRepos(repoPaths) {
  const results = await Promise.all(repoPaths.map((p) => getRepoPendingWork(p)));
  return results.filter((r) => r.hasPending);
}

module.exports = { getRepoPendingWork, getPendingForRepos };
