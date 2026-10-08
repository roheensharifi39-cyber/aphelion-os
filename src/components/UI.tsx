import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { PixelIcon, type IconName } from './PixelIcon';
export function Button({ children, icon, variant = 'stone', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; variant?: 'stone' | 'green' | 'ghost' | 'danger' }) {
  return <button type="button" className={`mc-button ${variant} ${className}`} {...props}>{icon && <PixelIcon name={icon} size={14} />}{children}</button>;
}
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'green' | 'peach' | 'blue' | 'gold' | 'muted' }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function SectionHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) { return <div className="section-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>{children}</div>; }
export function ErrorNote({ text }: { text: string }) { return text ? <div className="error-note" role="alert"><PixelIcon name="bolt" size={14} />{text}</div> : null; }
