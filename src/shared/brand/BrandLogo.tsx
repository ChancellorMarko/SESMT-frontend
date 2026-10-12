import styles from './BrandLogo.module.css';

/** The user-selected primary logo, with a real transparent background. */
export function BrandLogo({ tone = 'light', compact = false, className = '' }: {
  tone?: 'light' | 'dark';
  compact?: boolean;
  className?: string;
}) {
  const source = compact ? 'icon.png' : 'logo-principal.png';
  return <img
    className={`${styles.logo} ${compact ? styles.compact : tone === 'dark' ? styles.onDark : ''} ${className}`}
    src={`/brand/ampara/${source}`}
    alt="Ampara SESMT"
    width={compact ? 48 : 240}
    height={compact ? 48 : 97}
    decoding="async"
  />;
}
