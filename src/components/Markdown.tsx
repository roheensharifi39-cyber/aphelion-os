import { Heading } from './Heading';
import { useRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './UI';
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return <div className="code-block"><div className="code-toolbar"><span>CODE / READY TO CRAFT</span><Button icon="copy" variant="ghost" onClick={() => { if (ref.current) void navigator.clipboard.writeText(ref.current.innerText); }}>Copy code</Button></div><pre ref={ref}>{children}</pre></div>;
}
// Stable component types preserve each heading's completed entrance animation as responses stream.
const markdownComponents: Components = {
  pre: CodeBlock,
  h1: ({ children }) => <Heading as="h1">{children}</Heading>,
  h2: ({ children }) => <Heading as="h2">{children}</Heading>,
  h3: ({ children }) => <Heading as="h3">{children}</Heading>,
  h4: ({ children }) => <Heading as="h4">{children}</Heading>,
  h5: ({ children }) => <Heading as="h5">{children}</Heading>,
  h6: ({ children }) => <Heading as="h6">{children}</Heading>,
  a: props => <a {...props} target="_blank" rel="noopener noreferrer" />,
};
export function Markdown({ children }: { children: string }) { return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{children}</ReactMarkdown></div>; }
