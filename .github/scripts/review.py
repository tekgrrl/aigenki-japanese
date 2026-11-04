import os
import requests
import sys
import json

# Environment setup
REPO = os.environ.get("REPO")
PR_NUMBER = os.environ.get("PR_NUMBER")
GH_TOKEN = os.environ.get("GH_TOKEN")
MODEL_PROVIDER = os.environ.get("MODEL_PROVIDER", "gemini")

# The identity this script's GH_TOKEN posts as — used to find and dismiss this
# script's own stale reviews, and to avoid treating its own comments as new input.
BOT_LOGIN = "github-actions[bot]"

json_headers = {
    "Authorization": f"Bearer {GH_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

# 1. Fetch the PR Diff
diff_headers = {
    "Authorization": f"Bearer {GH_TOKEN}",
    "Accept": "application/vnd.github.v3.diff",
}
diff_url = f"https://api.github.com/repos/{REPO}/pulls/{PR_NUMBER}"
diff_response = requests.get(diff_url, headers=diff_headers)
diff_response.raise_for_status()
pr_diff = diff_response.text

if not pr_diff.strip():
    print("Empty diff, exiting.")
    sys.exit(0)

# 1b. Fetch existing reviews and inline review-comment threads. Used both to give
# the model the prior discussion (so it can revise its own earlier verdict instead
# of re-litigating a concern that's already been addressed) and, after a fresh
# decision is made, to dismiss this script's own stale CHANGES_REQUESTED reviews.
reviews_url = f"https://api.github.com/repos/{REPO}/pulls/{PR_NUMBER}/reviews"
reviews_response = requests.get(reviews_url, headers=json_headers)
reviews_response.raise_for_status()
existing_reviews = reviews_response.json()

review_comments_url = f"https://api.github.com/repos/{REPO}/pulls/{PR_NUMBER}/comments"
review_comments_response = requests.get(review_comments_url, headers=json_headers)
review_comments_response.raise_for_status()
review_comments = review_comments_response.json()


def format_discussion(reviews, comments):
    lines = []
    for r in reviews:
        author = r.get("user", {}).get("login", "unknown")
        state = r.get("state", "")
        body = (r.get("body") or "").strip()
        if body:
            lines.append(f"- [{state}] {author}: {body}")
    for c in comments:
        author = c.get("user", {}).get("login", "unknown")
        path = c.get("path", "")
        line = c.get("line") or c.get("original_line")
        body = (c.get("body") or "").strip()
        marker = "  reply ->" if c.get("in_reply_to_id") else "-"
        lines.append(f"{marker} {author} on {path}:{line}: {body}")
    return "\n".join(lines) if lines else "(No prior review discussion on this PR.)"


discussion_context = format_discussion(existing_reviews, review_comments)

# 1c. Agreed decisions the owner has already made (REVIEW-NOTES.md at the repo root,
# from the checked-out PR). Kept out of findings so settled points aren't re-raised.
try:
    with open("REVIEW-NOTES.md", encoding="utf-8") as f:
        review_notes = f.read().strip()
except FileNotFoundError:
    review_notes = "(none)"

# 2. The Pragmatic Principal Prompt
prompt = f"""You are a Pragmatic Principal Software Engineer reviewing a Pull Request.
You care deeply about shipping reliable code, preventing security vulnerabilities, and maintaining clean architecture.
However, you are not a pedantic auditor. You allow for stylistic leeway, you understand engineering trade-offs, and you optimize for team velocity.

Review Rules:
1. "APPROVE": The code is solid. It may have minor nits, but nothing that should block a merge.
2. "REQUEST_CHANGES": There is a genuine security vulnerability, a severe logic error, or a major architectural break. Never block a PR for style or minor optimizations.
3. "COMMENT": You just want to leave general feedback without formally approving or blocking.

You are re-evaluating this PR from scratch against its current state — you may be reconsidering a concern you (or a prior run of this same reviewer) already raised. Prior review discussion is included below. If a previously raised concern has since been fixed by a code change, or convincingly explained as not applicable in a reply, do not re-raise it — only request changes for concerns that are genuinely still unresolved.

Prior review discussion on this PR:
{discussion_context}

Agreed decisions (from REVIEW-NOTES.md). These were settled deliberately with the owner: do not raise them as concerns unless this diff breaks their stated intent:
{review_notes}

You MUST respond in raw, valid JSON with no markdown wrapping. Use this exact schema:
{{
  "decision": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "summary": "A brief, pragmatic summary of the PR. No robotic pleasantries.",
  "inline_comments": [
    {{
      "path": "file/path/here.ext",
      "line": 42,
      "body": "Your specific feedback on this line."
    }}
  ]
}}

Note: For inline_comments, strictly use the new line numbers from the right side of the unified diff. If there are no specific inline comments needed, leave the array empty.

Review this diff:
{pr_diff}
"""

# 3. Generate Review Content
raw_ai_text = ""
if MODEL_PROVIDER == "gemini":
    from google import genai

    client = genai.Client()
    response = client.models.generate_content(
        model="gemini-3.8-flash",
        contents=prompt,
    )
    raw_ai_text = response.text

elif MODEL_PROVIDER == "anthropic":
    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-3-7-sonnet-20250219",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    raw_ai_text = response.content[0].text

# 4. Parse AI Response
# Clean up potential markdown wrappers if the LLM disobeys the prompt
if raw_ai_text.startswith("```json"):
    raw_ai_text = (
        raw_ai_text.replace("```json\n", "").replace("```", "").strip()
    )

try:
    ai_review = json.loads(raw_ai_text)
    decision = ai_review.get("decision", "COMMENT")
    summary = ai_review.get("summary", "Automated AI Review summary.")
    inline_comments = ai_review.get("inline_comments", [])
except json.JSONDecodeError:
    decision = "COMMENT"
    summary = (
        f"Error: AI returned malformed response. Raw output:\n\n{raw_ai_text}"
    )
    inline_comments = []

# Format inline comments for GitHub API
github_comments = []
for c in inline_comments:
    if "path" in c and "line" in c and "body" in c:
        github_comments.append(
            {
                "path": c["path"],
                "line": int(c["line"]),
                "side": "RIGHT",
                "body": c["body"],
            }
        )

# 5. Dismiss this script's own stale CHANGES_REQUESTED reviews before posting a
# fresh one, so the PR's mergeability reflects only the current, up-to-date
# verdict — this is the manual "dismiss and explain why" step a human would
# otherwise have to do after a concern is fixed or explained away.
post_headers = json_headers
for r in existing_reviews:
    if r.get("user", {}).get("login") == BOT_LOGIN and r.get("state") == "CHANGES_REQUESTED":
        dismiss_url = f"https://api.github.com/repos/{REPO}/pulls/{PR_NUMBER}/reviews/{r['id']}/dismissals"
        dismiss_response = requests.put(
            dismiss_url,
            headers=post_headers,
            json={"message": "Superseded by a fresh review below, which re-evaluated this PR against the current diff and discussion."},
        )
        if dismiss_response.ok:
            print(f"Dismissed stale CHANGES_REQUESTED review {r['id']}")
        else:
            print(f"Failed to dismiss stale review {r['id']}: {dismiss_response.status_code} {dismiss_response.text}")

# 6. Post the Review
review_url = f"https://api.github.com/repos/{REPO}/pulls/{PR_NUMBER}/reviews"

payload = {
    "body": f"### AI Review (Pragmatic)\n\n{summary}",
    "event": decision,
    "comments": github_comments,
}
print(f"Posting review. Decision: {decision}, inline comments: {len(github_comments)}")

# Attempt 1: Post with inline comments
response = requests.post(review_url, headers=post_headers, json=payload)

# If GitHub rejects the payload (usually due to hallucinated line numbers out of diff bounds)
if response.status_code == 422 and github_comments:
    print(
        f"GitHub rejected inline comments (likely invalid line numbers): {response.text}. "
        "Falling back to summary only."
    )

    # Roll the inline comments into the main body so the feedback isn't lost
    fallback_body = (
        payload["body"]
        + "\n\n**Inline Feedback (Line numbers may be approximate):**\n"
    )
    for c in github_comments:
        fallback_body += f"- `{c['path']}` (Line {c['line']}): {c['body']}\n"

    payload["body"] = fallback_body
    payload["comments"] = []  # Clear the inline comments

    # Attempt 2: Post without inline comments
    response = requests.post(review_url, headers=post_headers, json=payload)

# A review event that would self-approve/self-block this PR (e.g. the reviewing
# identity happens to match the PR author) is rejected by GitHub's API — fall
# back to a plain COMMENT rather than losing the review entirely.
if response.status_code == 422 and payload["event"] != "COMMENT":
    print(
        f"GitHub rejected event='{payload['event']}' (likely a self-review restriction): "
        f"{response.text}. Falling back to a COMMENT-type review."
    )
    payload["event"] = "COMMENT"
    response = requests.post(review_url, headers=post_headers, json=payload)

if not response.ok:
    print(f"Final review submission failed: {response.status_code} {response.text}")

response.raise_for_status()
print(f"Review submitted successfully. Decision: {decision}")
