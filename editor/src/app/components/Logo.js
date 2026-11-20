import styles from "./Logo.module.css";

// The app's name as a heading: decorative logo + the word "pebble".
// Size follows the heading's font-size (the mark is 1.35em tall).
export default function Logo({ className = "" }) {
  return (
    <h1 className={`${styles.logo} ${className}`.trim()}>
      <img
        className={styles.mark}
        src="/pebble-logo.png"
        alt=""
        width={134}
        height={96}
      />
      pebble
    </h1>
  );
}
