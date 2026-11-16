export function CapsLogo({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect width="40" height="40" rx="9" fill="#ffffff" />
      <path d="M20 7 6 14l14 7 11-5.5V24h3V14L20 7Z" fill="#142a57" />
      <path d="M11 19.5v6.2c0 2.4 4 4.8 9 4.8s9-2.4 9-4.8v-6.2l-9 4.5-9-4.5Z" fill="#0f8a5f" />
    </svg>
  );
}
