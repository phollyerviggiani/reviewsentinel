import "dotenv/config";

// goal: prove scoped GitHub token can actually pull a PR diff.
// usage: npm run fetch-diff -- <pr_number>

const owner = process.env.GITHUB_TEST_OWNER;
const repo = process.env.GITHUB_TEST_REPO;
const token = process.env.GITHUB_TOKEN;
const prNumber = process.argv[2] ?? "1";

if (!owner || !repo || !token) {
  console.error(
    "Missing env vars. Make sure GITHUB_TEST_OWNER, GITHUB_TEST_REPO, and GITHUB_TOKEN are set in .env"
  );
  process.exit(1);
}

const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

const res = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3.diff", // asking GitHub for the raw diff, not JSON metadata
    "X-GitHub-Api-Version": "2022-11-28",
  },
});

if (!res.ok) {
  console.error(`GitHub API returned ${res.status}: ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}

const diff = await res.text();
console.log(`--- Diff for ${owner}/${repo}#${prNumber} ---\n`);
console.log(diff.slice(0, 2000)); 
console.log(`\n--- (${diff.length} total characters) ---`);
