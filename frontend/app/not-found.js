import Link from "next/link";

export const metadata = { title: "Page not found", description: "This page does not exist on silentship." };

export default function NotFound() {
  return (
    <div className="empty not-found">
      <b>Not found.</b> <Link href="/">Back to the changelog</Link>
    </div>
  );
}
