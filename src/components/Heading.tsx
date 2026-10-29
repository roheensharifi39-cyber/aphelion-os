import { useSyncExternalStore, type HTMLAttributes } from 'react';
import TextEngine from 'spring-text-engine';

const query = '(prefers-reduced-motion: reduce)';
const subscribe = (notify: () => void) => {
  const media = matchMedia(query);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
export function Heading({ as: Tag = 'h2', children, ...props }: HTMLAttributes<HTMLHeadingElement> & { as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' }) {
  const reduced = useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => true);
  if (reduced) return <Tag {...props}>{children}</Tag>;
  return <TextEngine {...props} tag={Tag} mode="once" wordOut={{ opacity: 0, scale: 1.4, filter: 'blur(6px)' }} wordIn={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} wordConfig={{ tension: 200, friction: 24 }} wordStagger={55}>{children}</TextEngine>;
}
