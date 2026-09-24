// posts comments to a GitHub PR for each finding in the review

interface PostReviewCommentInput {
  owner: string;
  repo: string;
  prNumber: number;
  commitId: string;
  filePath: string;
  line: number;
  body: string;
  token: string;
}

export async function postReviewComment({
  owner,
  repo,
  prNumber,
  commitId,
  filePath,
  line,
  body,
  token,
}: PostReviewCommentInput): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      body,
      commit_id: commitId,
      path: filePath,
      line,
      side: "RIGHT", // "RIGHT" = the new version of the file, matching our validator's line numbers
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub API error posting comment ${res.status}: ${errBody}`);
  }
}
