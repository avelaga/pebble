import Link from "next/link";
import PostEditor from "../../components/PostEditor";
import ThemeToggle from "../../components/ThemeToggle";

export default function NewPost() {
  return (
    <main className="container">
      <div className="page-header">
        <div className="page-header-row">
          <Link href="/" className="back-link">&larr; Back to posts</Link>
          <ThemeToggle />
        </div>
        <h1>New post</h1>
      </div>
      <PostEditor />
    </main>
  );
}
