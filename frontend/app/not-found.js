import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty not-found">
      <b>Not found.</b> <Link href="/">Back to the changelog</Link>
    </div>
  );
}
