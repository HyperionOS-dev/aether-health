export default function Card({ className = "", children }) {
  return <div className={`rounded-2xl border border-hairline bg-card p-5 ${className}`}>{children}</div>;
}