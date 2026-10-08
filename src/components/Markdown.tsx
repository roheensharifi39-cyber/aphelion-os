import { useRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './UI';
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return <div className="code-block"><div className="code-toolbar"><span>CODE / READY TO CRAFT</span><Button icon="copy" variant="ghost" onClick={() => { if (ref.current) void navigator.clipboard.writeText(ref.current.innerText); }}>Copy code</Button></div><pre ref={ref}>{children}</pre></div>;
}
export function Markdown({ children }: { children: string }) { return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock, a: props => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{children}</ReactMarkdown></div>; }
