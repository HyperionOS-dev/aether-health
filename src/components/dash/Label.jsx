export default function Label({ className = "", children }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground ${className}`}>
      {children}
    </p>
  );
}