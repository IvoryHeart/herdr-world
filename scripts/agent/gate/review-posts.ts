import {
  reviewerResults,
  type Post,
} from "../../../server/src/sources/pullRequestDetail";
import { git } from "./git";

/**
 * A review posted after a push can carry the submission head as its native
 * metadata. Keep the explicit reviewed commit only when git proves it older.
 * This never carries a review forward: the gate's copy rule still does that.
 */
export function reviewedPosts(
  number: number,
  posts: Post[],
  commits: { oid: string; at: number }[],
  head: string,
  mirror: string,
): Post[] {
  return posts.map((post) => {
    if (
      typeof post.commit !== "string" ||
      !/^[0-9a-f]{40}$/iu.test(post.commit)
    )
      return post;
    const [bound] = reviewerResults(number, [post], commits, head);
    if (!bound?.reviewer || bound.commit || bound.outcome !== "unknown")
      return post;
    const [explicit] = reviewerResults(
      number,
      [{ ...post, commit: undefined }],
      commits,
      head,
    );
    if (
      !explicit?.reviewer ||
      !explicit.commit ||
      explicit.outcome === "unknown"
    )
      return post;
    if (
      git(mirror, ["merge-base", "--is-ancestor", explicit.commit, post.commit])
        .code !== 0
    )
      return post;
    return { ...post, commit: explicit.commit };
  });
}
