import Link from "next/link";
import PostEditor from "../../components/PostEditor";

export default function NewPost() {
  return (
    <main className="container">
      <div className="page-header">
        <Link href="/" className="back-link">&larr; Back to posts</Link>
        <h1>New Post</h1>
      </div>
      <PostEditor />
    </main>
  );
}
