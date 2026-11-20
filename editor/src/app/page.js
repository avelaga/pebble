"use client";

import Link from "next/link";
import PostList from "./components/PostList";
import RebuildButton from "./components/RebuildButton";
import ThemeToggle from "./components/ThemeToggle";
import Logo from "./components/Logo";
import { useAuth } from "./components/AuthProvider";

export default function Home() {
  const { logout } = useAuth();

  return (
    <main className="container">
      <div className="header">
        <Logo />
        <div className="header-actions">
          <RebuildButton />
          <Link href="/posts/new" className="new-post-btn">
            + New Post
          </Link>
          <ThemeToggle />
          <button onClick={logout} className="text-btn">
            Log out
          </button>
        </div>
      </div>
      <PostList />
    </main>
  );
}
